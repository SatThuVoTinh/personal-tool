from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    database_host: str
    database_port: int
    database_name: str
    database_user: str
    database_password: str
    ollama_url: str
    embedding_model: str
    embedding_dimensions: int
    advisory_lock_key: int
    migration_directory: Path
    vault_root: Path
    tokenizer_path: Path
    reranker_model_path: Path = Path("/app/artifacts/model.int8.onnx")
    reranker_manifest_path: Path = Path("/app/artifacts/reranker-manifest.json")
    pdf_runtime_enabled: bool = False
    pdf_runtime_python: Path = Path("/opt/pdf-runtime/.venv/bin/python")
    pdf_runtime_lock_path: Path = Path("/opt/pdf-runtime/uv.lock")
    pdf_runtime_manifest_path: Path = Path("/opt/pdf-artifacts/manifest.json")
    pdf_runtime_artifacts_path: Path = Path("/opt/pdf-artifacts")
    pdf_runtime_temp_root: Path = Path("/tmp/pdf-runtime")
    pdf_tesseract_binary: Path = Path("/usr/bin/tesseract")
    pdf_tessdata_path: Path = Path("/usr/share/tesseract-ocr/5/tessdata")
    acceptance_backup_barrier_dir: Path | None = None

    @classmethod
    def from_environment(cls) -> "Settings":
        database_password = os.environ.get("KNOWLEDGE_DATABASE_PASSWORD", "")
        if not database_password:
            raise RuntimeError("KNOWLEDGE_DATABASE_PASSWORD is required.")

        return cls(
            database_host=os.environ.get("KNOWLEDGE_DATABASE_HOST", "postgres").strip(),
            database_port=int(os.environ.get("KNOWLEDGE_DATABASE_PORT", "5432")),
            database_name=os.environ.get("KNOWLEDGE_DATABASE_NAME", "postgres").strip(),
            database_user=os.environ.get("KNOWLEDGE_DATABASE_USER", "postgres").strip(),
            database_password=database_password,
            ollama_url=os.environ.get(
                "KNOWLEDGE_OLLAMA_URL", "http://host.docker.internal:11434"
            ).rstrip("/"),
            embedding_model=os.environ.get(
                "KNOWLEDGE_EMBEDDING_MODEL", "bge-m3:latest"
            ).strip(),
            embedding_dimensions=int(
                os.environ.get("KNOWLEDGE_EMBEDDING_DIMENSIONS", "1024")
            ),
            advisory_lock_key=int(
                os.environ.get("KNOWLEDGE_INDEX_ADVISORY_LOCK_KEY", "741212391041002")
            ),
            migration_directory=Path(
                os.environ.get(
                    "KNOWLEDGE_MIGRATION_DIRECTORY",
                    str(Path(__file__).resolve().parents[1] / "migrations"),
                )
            ),
            vault_root=Path(os.environ.get("KNOWLEDGE_VAULT_ROOT", "/vault")),
            tokenizer_path=Path(
                os.environ.get("KNOWLEDGE_TOKENIZER_PATH", "/app/artifacts/tokenizer.json")
            ),
            reranker_model_path=Path(
                os.environ.get("KNOWLEDGE_RERANKER_MODEL_PATH", "/app/artifacts/model.int8.onnx")
            ),
            reranker_manifest_path=Path(
                os.environ.get("KNOWLEDGE_RERANKER_MANIFEST_PATH", "/app/artifacts/reranker-manifest.json")
            ),
            pdf_runtime_enabled=os.environ.get("KNOWLEDGE_PDF_RUNTIME_ENABLED", "0") == "1",
            pdf_runtime_python=Path(
                os.environ.get("KNOWLEDGE_PDF_RUNTIME_PYTHON", "/opt/pdf-runtime/.venv/bin/python")
            ),
            pdf_runtime_lock_path=Path(
                os.environ.get("KNOWLEDGE_PDF_RUNTIME_LOCK", "/opt/pdf-runtime/uv.lock")
            ),
            pdf_runtime_manifest_path=Path(
                os.environ.get("KNOWLEDGE_PDF_RUNTIME_MANIFEST", "/opt/pdf-artifacts/manifest.json")
            ),
            pdf_runtime_artifacts_path=Path(
                os.environ.get("KNOWLEDGE_PDF_RUNTIME_ARTIFACTS", "/opt/pdf-artifacts")
            ),
            pdf_runtime_temp_root=Path(
                os.environ.get("KNOWLEDGE_PDF_RUNTIME_TEMP_ROOT", "/tmp/pdf-runtime")
            ),
            pdf_tesseract_binary=Path(
                os.environ.get("KNOWLEDGE_PDF_TESSERACT_BINARY", "/usr/bin/tesseract")
            ),
            pdf_tessdata_path=Path(
                os.environ.get("KNOWLEDGE_PDF_TESSDATA_PATH", "/usr/share/tesseract-ocr/5/tessdata")
            ),
            acceptance_backup_barrier_dir=(
                Path(os.environ["KNOWLEDGE_ACCEPTANCE_BACKUP_BARRIER_DIR"])
                if os.environ.get("KNOWLEDGE_ACCEPTANCE_BACKUP_BARRIER_DIR")
                else None
            ),
        )
