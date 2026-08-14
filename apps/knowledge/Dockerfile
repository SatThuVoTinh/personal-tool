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

ADD --checksum=sha256:69564b696052886ed0ac63fa393e928384e0f8caada38c1f4864a9bfbf379c15 \
    https://huggingface.co/BAAI/bge-reranker-v2-m3/resolve/953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e/tokenizer.json \
    /app/artifacts/tokenizer.json

RUN echo "69564b696052886ed0ac63fa393e928384e0f8caada38c1f4864a9bfbf379c15  /app/artifacts/tokenizer.json" | sha256sum --check --strict

FROM builder AS reranker-export

COPY app /app/app
COPY scripts/export_reranker.py /app/export_reranker.py
RUN uv venv /opt/reranker-venv && \
    uv pip install --python /opt/reranker-venv/bin/python \
      "torch==2.8.0" "transformers==5.14.1" "onnx==1.18.0" "onnxruntime==1.27.0"

RUN install -d /opt/reranker-source
ADD https://huggingface.co/BAAI/bge-reranker-v2-m3/resolve/953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e/config.json /opt/reranker-source/config.json
ADD --checksum=sha256:d9e3e081faff1eefb84019509b2f5558fd74c1a05a2c7db22f74174fcedb5286 \
    https://huggingface.co/BAAI/bge-reranker-v2-m3/resolve/953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e/model.safetensors \
    /opt/reranker-source/model.safetensors
RUN /opt/reranker-venv/bin/python /app/export_reranker.py

FROM reranker-export AS test

COPY app ./app
COPY tests ./tests
ENV KNOWLEDGE_TOKENIZER_PATH=/app/artifacts/tokenizer.json
RUN uv run --locked --no-sync python -m unittest discover -s tests -v

FROM python:3.13.14-slim-bookworm@sha256:de572b33eae61a53675a87bbd02b5e365df7b6b2b06c9276124e965cec08c452 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN addgroup --system knowledge && \
    adduser --system --ingroup knowledge knowledge && \
    install -d -o knowledge -g knowledge -m 0555 /app/artifacts

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder --chown=knowledge:knowledge --chmod=0444 /app/artifacts/tokenizer.json /app/artifacts/tokenizer.json
COPY --from=reranker-export --chown=knowledge:knowledge --chmod=0444 /app/runtime-artifacts/ /app/artifacts/
COPY app ./app
COPY migrations ./migrations

ENV PATH="/app/.venv/bin:$PATH" \
    KNOWLEDGE_TOKENIZER_PATH=/app/artifacts/tokenizer.json

USER knowledge

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
