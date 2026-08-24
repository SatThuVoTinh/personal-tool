"""Build a runtime-verifiable supply-chain manifest inside the Linux image."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
import subprocess
import tomllib
from pathlib import Path

from .download_models import MODEL_REVISIONS


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", required=True, type=Path)
    parser.add_argument("--lock", required=True, type=Path)
    parser.add_argument("--tesseract", required=True, type=Path)
    parser.add_argument("--tessdata", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    artifact_digests = _tree_digests(args.artifacts)
    for language in ("eng", "vie", "chi_sim"):
        path = args.tessdata / f"{language}.traineddata"
        artifact_digests[f"tessdata/{language}.traineddata"] = _sha256(path)
    artifact_digests["tesseract"] = _sha256(args.tesseract)
    manifest = {
        "artifact_digests": dict(sorted(artifact_digests.items())),
        "distribution_versions": _installed_distribution_versions(),
        "model_artifact_revisions": dict(sorted(MODEL_REVISIONS.items())),
        "locked_distribution_hashes": _locked_distribution_hashes(args.lock),
        "hashed_requirements_digest": _sha256(args.lock.parent / "requirements.txt"),
        "pdf_runtime_lock_digest": _sha256(args.lock),
        "protocol_version": "zink:pdf-runtime-protocol:v1",
        "runner_code_digest": _tree_digest(Path(__file__).parent),
        "tesseract_binary_name": args.tesseract.name,
        "tesseract_version": _tesseract_version(args.tesseract),
        "tessdata_source_revision": _debian_package_revisions(),
    }
    args.output.write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )


def _tree_digests(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): _sha256(path)
        for path in sorted(root.rglob("*"))
        if path.is_file() and path.name != "manifest.json"
    }


def _installed_distribution_versions() -> dict[str, str]:
    versions: dict[str, str] = {}
    for distribution in importlib.metadata.distributions():
        raw_name = distribution.metadata.get("Name")
        if not isinstance(raw_name, str) or not raw_name:
            raise ValueError("installed distribution has no name")
        name = re.sub(r"[-_.]+", "-", raw_name).casefold()
        if name in versions and versions[name] != distribution.version:
            raise ValueError("duplicate installed distribution identity")
        versions[name] = distribution.version
    return dict(sorted(versions.items()))


def _tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for relative, value in _tree_digests(root).items():
        encoded = relative.encode("utf-8")
        digest.update(len(encoded).to_bytes(4, "big"))
        digest.update(encoded)
        digest.update(bytes.fromhex(value))
    return digest.hexdigest()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _tesseract_version(executable: Path) -> str:
    completed = subprocess.run(
        [str(executable), "--version"], check=True, capture_output=True, text=True, timeout=10
    )
    return (completed.stdout or completed.stderr).splitlines()[0]


def _locked_distribution_hashes(lock_path: Path) -> dict[str, list[str]]:
    with lock_path.open("rb") as handle:
        lock = tomllib.load(handle)
    result: dict[str, list[str]] = {}
    for package in lock.get("package", []):
        if not isinstance(package, dict):
            raise ValueError("invalid lock package")
        name, version = package.get("name"), package.get("version")
        if not isinstance(name, str) or not isinstance(version, str):
            raise ValueError("invalid lock identity")
        hashes: list[str] = []
        source = package.get("sdist")
        if isinstance(source, dict) and isinstance(source.get("hash"), str):
            hashes.append(source["hash"])
        for wheel in package.get("wheels", []):
            if isinstance(wheel, dict) and isinstance(wheel.get("hash"), str):
                hashes.append(wheel["hash"])
        if hashes:
            result[f"{name}=={version}"] = sorted(set(hashes))
    return dict(sorted(result.items()))


def _debian_package_revisions() -> dict[str, str]:
    packages = ("tesseract-ocr", "tesseract-ocr-eng", "tesseract-ocr-vie", "tesseract-ocr-chi-sim")
    completed = subprocess.run(
        ["dpkg-query", "-W", "-f=${Package}=${Version}\\n", *packages],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return dict(line.split("=", 1) for line in completed.stdout.splitlines())


if __name__ == "__main__":
    main()
