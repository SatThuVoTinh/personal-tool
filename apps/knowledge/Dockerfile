FROM ghcr.io/astral-sh/uv:0.12.0@sha256:606e70c71c852d03f611b1e56a195d08648507018a7057fab82c4974c4eae105 AS uv

FROM python:3.13.14-slim-bookworm@sha256:de572b33eae61a53675a87bbd02b5e365df7b6b2b06c9276124e965cec08c452 AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

COPY --from=uv /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

# The PDF model stack is deliberately a separate project and virtual
# environment.  Do not merge this lock into the parent M3 runtime: it has a
# different, security-audited tokenizers/Transformers closure.
COPY pdf-runtime/pyproject.toml pdf-runtime/uv.lock pdf-runtime/requirements.txt /opt/pdf-runtime/
WORKDIR /opt/pdf-runtime
RUN uv export --frozen --no-dev --no-emit-project --no-header \
      --format requirements.txt --emit-index-url \
      --output-file /tmp/pdf-requirements.lock.txt && \
    cmp /tmp/pdf-requirements.lock.txt requirements.txt && \
    uv sync --locked --no-dev --no-install-project && \
    chmod -R g+rX,o-rwx,a-w /opt/pdf-runtime
COPY pdf-runtime/src/zink_pdf_runtime/download_models.py /tmp/download_pdf_models.py
RUN /opt/pdf-runtime/.venv/bin/python /tmp/download_pdf_models.py \
      --output-dir /opt/pdf-artifacts && \
    find /opt/pdf-artifacts -type d -exec chmod 0550 {} + && \
    find /opt/pdf-artifacts -type f -exec chmod 0440 {} +
COPY pdf-runtime/src /opt/pdf-runtime/src
RUN uv sync --locked --no-dev && \
    chmod -R g+rX,o-rwx,a-w \
      /opt/pdf-runtime/src \
      /opt/pdf-runtime/.venv/lib/python3.13/site-packages/_editable_impl_zink_knowledge_pdf_runtime.pth \
      /opt/pdf-runtime/.venv/lib/python3.13/site-packages/zink_knowledge_pdf_runtime-*.dist-info

WORKDIR /app

ADD --checksum=sha256:69564b696052886ed0ac63fa393e928384e0f8caada38c1f4864a9bfbf379c15 \
    https://huggingface.co/BAAI/bge-reranker-v2-m3/resolve/953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e/tokenizer.json \
    /app/artifacts/tokenizer.json

RUN echo "69564b696052886ed0ac63fa393e928384e0f8caada38c1f4864a9bfbf379c15  /app/artifacts/tokenizer.json" | sha256sum --check --strict

FROM builder AS reranker-export

RUN uv venv /opt/reranker-venv && \
    uv pip install --python /opt/reranker-venv/bin/python \
      --index https://download.pytorch.org/whl/cpu \
      "torch==2.8.0" \
      "transformers==5.14.1" \
      "onnx==1.18.0" \
      "onnxruntime==1.27.0" \
      "ml-dtypes==0.5.3"

RUN install -d /app/app
COPY app/__init__.py /app/app/__init__.py
COPY app/markdown_adapter.py /app/app/markdown_adapter.py
COPY app/reranker_contract.py /app/app/reranker_contract.py
COPY scripts/export_reranker.py /app/export_reranker.py
RUN install -d /opt/reranker-source
ADD https://huggingface.co/BAAI/bge-reranker-v2-m3/resolve/953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e/config.json /opt/reranker-source/config.json
ADD --checksum=sha256:d9e3e081faff1eefb84019509b2f5558fd74c1a05a2c7db22f74174fcedb5286 \
    https://huggingface.co/BAAI/bge-reranker-v2-m3/resolve/953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e/model.safetensors \
    /opt/reranker-source/model.safetensors
RUN /opt/reranker-venv/bin/python /app/export_reranker.py

FROM reranker-export AS test

COPY app ./app
# F-547 (R10-T05-4): the runner resolves the published migration digests from
# this carrier, because the build context is apps/knowledge/ and cannot reach
# docs/. tests/m12-t2.2-a4-migration-digest.test.mjs pins it byte-identical to
# the contract at docs/contracts/knowledgebase-migration-digests.json.
COPY contracts ./contracts
COPY migrations ./migrations
COPY pdf-runtime/pyproject.toml pdf-runtime/uv.lock pdf-runtime/requirements.txt ./pdf-runtime/
COPY pdf-runtime/src ./pdf-runtime/src
COPY tests ./tests
ENV KNOWLEDGE_TOKENIZER_PATH=/app/artifacts/tokenizer.json
# F-313 (R7-E2-04): the directory has ONE authoritative runner. The image
# stage used `unittest discover`, which cannot import the seven modules that
# import the test framework at module level, so the image lane reported an
# import error instead of the suite and the two runners disagreed about what
# the directory contains. The image lane now runs the SAME pytest invocation
# the CI lane runs, against the same pinned tokenizer, and the collected-set
# floor in `tests/conftest.py` applies here too.
RUN uv sync --locked && uv run --no-sync python -m pytest tests -q

FROM python:3.13.14-slim-bookworm@sha256:de572b33eae61a53675a87bbd02b5e365df7b6b2b06c9276124e965cec08c452 AS runtime

ARG KNOWLEDGE_IMAGE_REVISION=unverified
LABEL org.opencontainers.image.revision=$KNOWLEDGE_IMAGE_REVISION

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN addgroup --system knowledge && \
    adduser --system --ingroup knowledge knowledge && \
    install -d -o knowledge -g knowledge -m 0555 /app/artifacts && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      libgl1=1.6.0-1 \
      tesseract-ocr=5.3.0-2 \
      tesseract-ocr-eng=1:4.1.0-2 \
      tesseract-ocr-vie=1:4.1.0-2 \
      tesseract-ocr-chi-sim=1:4.1.0-2 && \
    rm -rf /var/lib/apt/lists/* && \
    install -d -o knowledge -g knowledge -m 0700 /tmp/pdf-runtime

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder --chown=root:knowledge /opt/pdf-runtime /opt/pdf-runtime
COPY --from=builder --chown=root:knowledge /opt/pdf-artifacts /opt/pdf-artifacts
COPY --chown=root:knowledge --chmod=0440 uv.lock /app/uv.lock
COPY --from=builder --chown=knowledge:knowledge --chmod=0444 /app/artifacts/tokenizer.json /app/artifacts/tokenizer.json
COPY --from=reranker-export --chown=knowledge:knowledge --chmod=0444 /app/runtime-artifacts/ /app/artifacts/
COPY app ./app
# F-547 (R10-T05-4): the runner resolves the published migration digests from
# this carrier, because the build context is apps/knowledge/ and cannot reach
# docs/. tests/m12-t2.2-a4-migration-digest.test.mjs pins it byte-identical to
# the contract at docs/contracts/knowledgebase-migration-digests.json.
COPY contracts ./contracts
COPY migrations ./migrations

RUN /opt/pdf-runtime/.venv/bin/python -m zink_pdf_runtime.manifest \
      --artifacts /opt/pdf-artifacts \
      --lock /opt/pdf-runtime/uv.lock \
      --tesseract /usr/bin/tesseract \
      --tessdata /usr/share/tesseract-ocr/5/tessdata \
      --output /opt/pdf-artifacts/manifest.json && \
    test -s /opt/pdf-artifacts/manifest.json && \
    chown root:knowledge /opt/pdf-artifacts/manifest.json && \
    chmod 0440 /opt/pdf-artifacts/manifest.json

ENV PATH="/app/.venv/bin:$PATH" \
    KNOWLEDGE_TOKENIZER_PATH=/app/artifacts/tokenizer.json \
    KNOWLEDGE_PDF_RUNTIME_ENABLED=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

USER knowledge

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
