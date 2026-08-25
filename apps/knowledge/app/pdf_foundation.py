"""M4 PDF source, identity, and runtime-manifest primitives.

This module intentionally contains no Docling, Transformers, or Torch import.
The parent runtime owns source validation, canonical identities, and all
publication decisions; the isolated child only receives already validated
inputs through the narrow protocol in :mod:`app.pdf_runtime`.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Mapping

import yaml

from .markdown_adapter import TAG_TO_TOPIC

PDF_CONTENT_DOMAIN = b"zink:knowledge:pdf-content:v1"
PROCESSING_IDENTITY_SCHEMA_VERSION = 1
MAX_SIDECAR_BYTES = 64 * 1024
_EMBED = re.compile(r"!\[\[([^\]]+)\]\]")
_H1 = re.compile(r"^ {0,3}#(?!#)[ \t]+(.+?)[ \t]*$", re.MULTILINE)
_TAG = re.compile(r"(?<![\\\w/])#([\w-]+)", re.UNICODE)
_FENCE_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})(?:[^\r\n]*)$")


class PdfFoundationError(ValueError):
    """A safe, public foundation-validation failure."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class PdfSidecar:
    sidecar_path: str
    source_path: str
    title: str
    canonical_topics: tuple[str, ...]
    tags: tuple[str, ...]
    pdf_digest: str
    sidecar_digest: str


def canonical_json_bytes(value: Mapping[str, Any]) -> bytes:
    """Serialize a processing identity with one platform-independent encoding."""

    _assert_canonical_value(value)
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def processing_identity_digest(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def content_identity_digest(
    pdf_digest: str, sidecar_digest: str, processing_digest: str
) -> str:
    """Return the specified raw-digest/U32BE content identity encoding."""

    parts = [
        PDF_CONTENT_DOMAIN,
        *_length_delimited_raw_digests((pdf_digest, sidecar_digest, processing_digest)),
    ]
    return hashlib.sha256(b"".join(parts)).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_vault_path(vault_root: Path, raw_path: str, *, require_pdf: bool = False) -> str:
    """Resolve one Vault-relative path without permitting link/reparse escapes."""

    if not isinstance(raw_path, str) or not raw_path or "\x00" in raw_path:
        raise PdfFoundationError("PDF_SOURCE_PATH_INVALID")
    normalized = raw_path.replace("\\", "/")
    windows = PureWindowsPath(normalized)
    posix = PurePosixPath(normalized)
    if (
        windows.is_absolute()
        or windows.drive
        or normalized.startswith("//")
        or normalized.startswith("/")
        or any(part in {"", ".", ".."} for part in posix.parts)
    ):
        raise PdfFoundationError("PDF_SOURCE_PATH_INVALID")
    if require_pdf and not normalized.lower().endswith(".pdf"):
        raise PdfFoundationError("PDF_SOURCE_PATH_INVALID")

    root = vault_root.resolve(strict=True)
    candidate = root.joinpath(*posix.parts)
    _assert_no_link_or_reparse(root, candidate)
    try:
        resolved = candidate.resolve(strict=True)
        relative = resolved.relative_to(root)
    except (OSError, ValueError) as error:
        raise PdfFoundationError("PDF_SOURCE_PATH_INVALID") from error
    if require_pdf and resolved.suffix.lower() != ".pdf":
        raise PdfFoundationError("PDF_SOURCE_PATH_INVALID")
    return relative.as_posix()


def validated_vault_regular_file(
    vault_root: Path, raw_path: str, *, require_pdf: bool = False
) -> Path:
    """Return a canonical Vault file only when every path component is safe.

    This deliberately repeats the link/reparse validation on every call.  The
    PDF builder uses it at each drift checkpoint rather than trusting a
    pathname that was safe only during initial discovery.
    """

    relative = canonical_vault_path(vault_root, raw_path, require_pdf=require_pdf)
    root = vault_root.resolve(strict=True)
    candidate = root.joinpath(*PurePosixPath(relative).parts)
    _assert_no_link_or_reparse(root, candidate)
    try:
        info = candidate.lstat()
    except OSError as error:
        raise PdfFoundationError("PDF_SOURCE_PATH_INVALID") from error
    attributes = getattr(info, "st_file_attributes", 0)
    if (
        not stat.S_ISREG(info.st_mode)
        or stat.S_ISLNK(info.st_mode)
        or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    ):
        raise PdfFoundationError("PDF_SOURCE_PATH_INVALID")
    return candidate


def parse_pdf_sidecar(vault_root: Path, sidecar_path: Path) -> PdfSidecar:
    """Validate the strict M4 sidecar contract before any database mutation."""

    try:
        supplied_relative = sidecar_path.relative_to(vault_root).as_posix()
    except ValueError as error:
        raise PdfFoundationError("PDF_SIDECAR_OUTSIDE_DISCOVERY_ROOT") from error
    sidecar_relative = canonical_vault_path(vault_root, supplied_relative)
    if not sidecar_relative.startswith(("02. Books/", "03. Papers/")):
        raise PdfFoundationError("PDF_SIDECAR_OUTSIDE_DISCOVERY_ROOT")
    raw = sidecar_path.read_bytes()
    if len(raw) > MAX_SIDECAR_BYTES:
        raise PdfFoundationError("PDF_SIDECAR_TOO_LARGE")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise PdfFoundationError("PDF_SIDECAR_INVALID_UTF8") from error

    frontmatter, body = _split_frontmatter(text)
    if len(re.findall(r"(?m)^zink_source\s*:", frontmatter)) != 1:
        raise PdfFoundationError("PDF_SIDECAR_INVALID_SOURCE")
    try:
        metadata = yaml.safe_load(frontmatter)
    except yaml.YAMLError as error:
        raise PdfFoundationError("PDF_SIDECAR_INVALID_SOURCE") from error
    if not isinstance(metadata, dict) or metadata.get("zink_source") != "pdf":
        raise PdfFoundationError("PDF_SIDECAR_INVALID_SOURCE")
    visible_body = _visible_markdown(body)
    headings = _H1.findall(visible_body)
    if len(headings) != 1:
        raise PdfFoundationError("PDF_SIDECAR_H1_INVALID")
    embeds = _EMBED.findall(visible_body)
    pdf_embeds = [
        value
        for value in embeds
        if value.split("|", 1)[0].split("#", 1)[0].strip().lower().endswith(".pdf")
    ]
    if len(pdf_embeds) != 1:
        raise PdfFoundationError("PDF_SIDECAR_EMBED_INVALID")
    target = pdf_embeds[0].strip()
    if not target or "|" in target or "#" in target or "://" in target:
        raise PdfFoundationError("PDF_SIDECAR_EMBED_INVALID")
    source_path = canonical_vault_path(vault_root, target, require_pdf=True)
    if not source_path.startswith(("02. Books/", "03. Papers/", "Archives/")):
        raise PdfFoundationError("PDF_SIDECAR_EMBED_INVALID")
    tags = tuple(f"#{tag}" for tag in _TAG.findall(visible_body))
    canonical_topics = tuple(dict.fromkeys(TAG_TO_TOPIC[tag] for tag in tags if tag in TAG_TO_TOPIC))
    if not canonical_topics:
        raise PdfFoundationError("REQUIRED_TOPIC_TAG_MISSING")
    return PdfSidecar(
        sidecar_path=sidecar_relative,
        source_path=source_path,
        title=headings[0].strip(),
        canonical_topics=canonical_topics,
        tags=tuple(dict.fromkeys(tags)),
        pdf_digest=sha256_file(vault_root / source_path),
        sidecar_digest=hashlib.sha256(raw).hexdigest(),
    )


def discover_pdf_sidecars(vault_root: Path) -> tuple[PdfSidecar, ...]:
    """Discover only Markdown sidecars under the two approved roots."""

    discovered: list[PdfSidecar] = []
    targets: dict[str, str] = {}
    resolved_vault = vault_root.resolve(strict=True)
    for root_name in ("02. Books", "03. Papers"):
        root = resolved_vault / root_name
        if not root.exists():
            continue
        _assert_no_link_or_reparse(resolved_vault, root)
        for sidecar in sorted(root.rglob("*.md")):
            item = parse_pdf_sidecar(resolved_vault, sidecar)
            prior = targets.setdefault(item.source_path.casefold(), item.sidecar_path)
            if prior != item.sidecar_path:
                raise PdfFoundationError("PDF_DUPLICATE_TARGET")
            discovered.append(item)
    return tuple(discovered)


def _length_delimited_raw_digests(digests: tuple[str, str, str]) -> tuple[bytes, ...]:
    encoded: list[bytes] = []
    for digest in digests:
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise PdfFoundationError("PDF_IDENTITY_INVALID")
        raw = bytes.fromhex(digest)
        encoded.extend((len(raw).to_bytes(4, "big", signed=False), raw))
    return tuple(encoded)


def _assert_canonical_value(value: Any) -> None:
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        raise PdfFoundationError("PDF_IDENTITY_INVALID")
    if isinstance(value, (list, tuple)):
        for item in value:
            _assert_canonical_value(item)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise PdfFoundationError("PDF_IDENTITY_INVALID")
            _assert_canonical_value(item)
        return
    raise PdfFoundationError("PDF_IDENTITY_INVALID")


def _split_frontmatter(text: str) -> tuple[str, str]:
    if not text.startswith("---\n") and not text.startswith("---\r\n"):
        raise PdfFoundationError("PDF_SIDECAR_INVALID_SOURCE")
    lines = text.splitlines(keepends=True)
    for index, line in enumerate(lines[1:], 1):
        if line.rstrip("\r\n") == "---":
            return "".join(lines[1:index]), "".join(lines[index + 1 :])
    raise PdfFoundationError("PDF_SIDECAR_INVALID_SOURCE")


def _visible_markdown(text: str) -> str:
    """Blank fenced/code/comment content before evaluating sidecar semantics."""

    visible: list[str] = []
    fence_character = ""
    fence_length = 0
    in_comment = False
    for raw_line in text.splitlines(keepends=True):
        line = raw_line.rstrip("\r\n")
        newline = raw_line[len(line) :]
        if fence_character:
            if re.fullmatch(
                rf" {{0,3}}{re.escape(fence_character)}{{{fence_length},}}[ \t]*",
                line,
            ):
                fence_character = ""
                fence_length = 0
            visible.append(newline)
            continue
        opening = _FENCE_OPEN.match(line)
        if opening:
            fence_character = opening.group(1)[0]
            fence_length = len(opening.group(1))
            visible.append(newline)
            continue
        without_comments, in_comment = _strip_html_comments(line, in_comment)
        visible.append(_strip_inline_code(without_comments) + newline)
    return "".join(visible)


def _strip_html_comments(line: str, in_comment: bool) -> tuple[str, bool]:
    output: list[str] = []
    cursor = 0
    while cursor < len(line):
        if in_comment:
            closing = line.find("-->", cursor)
            if closing < 0:
                return "".join(output), True
            cursor = closing + 3
            in_comment = False
            continue
        opening = line.find("<!--", cursor)
        if opening < 0:
            output.append(line[cursor:])
            break
        output.append(line[cursor:opening])
        cursor = opening + 4
        in_comment = True
    return "".join(output), in_comment


def _strip_inline_code(line: str) -> str:
    output = list(line)
    cursor = 0
    while cursor < len(line):
        if line[cursor] != "`":
            cursor += 1
            continue
        opening_end = cursor
        while opening_end < len(line) and line[opening_end] == "`":
            opening_end += 1
        delimiter = line[cursor:opening_end]
        closing = line.find(delimiter, opening_end)
        if closing < 0:
            cursor = opening_end
            continue
        output[cursor : closing + len(delimiter)] = " " * (
            closing + len(delimiter) - cursor
        )
        cursor = closing + len(delimiter)
    return "".join(output)


def _assert_no_link_or_reparse(root: Path, candidate: Path) -> None:
    try:
        relative = candidate.relative_to(root)
    except ValueError as error:
        raise PdfFoundationError("PDF_SOURCE_PATH_INVALID") from error
    current = root
    for part in relative.parts:
        current = current / part
        try:
            info = current.lstat()
        except OSError as error:
            raise PdfFoundationError("PDF_SOURCE_PATH_INVALID") from error
        attributes = getattr(info, "st_file_attributes", 0)
        if stat.S_ISLNK(info.st_mode) or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
            raise PdfFoundationError("PDF_SOURCE_LINK_NOT_ALLOWED")
