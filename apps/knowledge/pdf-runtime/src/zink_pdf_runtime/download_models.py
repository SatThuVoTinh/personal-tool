"""Download only the M4 PDF models at immutable Hugging Face revisions."""

from __future__ import annotations

import argparse
from pathlib import Path

from huggingface_hub import snapshot_download


MODEL_REVISIONS = {
    "docling-project/docling-layout-heron": "8f39ad3c0b4c58e9c2d2c84a38465abf757272d8",
    "docling-project/docling-layout-heron-onnx": "40bde044036bb181c130ddf6c51792187268748f",
    "docling-project/docling-models": "fc0f2d45e2218ea24bce5045f58a389aed16dc23",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for repo_id, revision in MODEL_REVISIONS.items():
        snapshot_download(
            repo_id=repo_id,
            revision=revision,
            local_dir=args.output_dir / repo_id.replace("/", "--"),
        )


if __name__ == "__main__":
    main()
