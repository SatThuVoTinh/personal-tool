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
import unicodedata
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Mapping

import yaml

from .markdown_adapter import TAG_TO_TOPIC

PDF_CONTENT_DOMAIN = b"zink:knowledge:pdf-content:v1"
PROCESSING_IDENTITY_SCHEMA_VERSION = 1
MAX_SIDECAR_BYTES = 64 * 1024
# F-440 (R9-L09-4): the PDF ceiling is enforced where the file is READ, so
# discovery stats before hashing instead of reading a whole oversized PDF and
# meeting the build path's ceiling afterwards. The build path carries the same
# value; `test_pdf_foundation` pins the two together.
MAX_PDF_BYTES = 512 * 1024 * 1024
_EMBED = re.compile(r"!\[\[([^\]]+)\]\]")
_H1 = re.compile(r"^ {0,3}#(?!#)[ \t]+(.+?)[ \t]*$", re.MULTILINE)
_TAG = re.compile(r"(?<![\\\w/])#([\w-]+)", re.UNICODE)
_FENCE_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})(?:[^\r\n]*)$")


class PdfFoundationError(ValueError):
    """A safe, public foundation-validation failure."""

    def __init__(self, code: str, source_path: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.source_path = source_path


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


def parse_pdf_sidecar(
    vault_root: Path,
    sidecar_path: Path,
    *,
    pdf_basename_targets: Mapping[str, tuple[str, ...]] | None = None,
) -> PdfSidecar:
    """Validate the strict M4 sidecar contract before any database mutation."""

    try:
        supplied_relative = sidecar_path.relative_to(vault_root).as_posix()
    except ValueError as error:
        raise PdfFoundationError("PDF_SIDECAR_OUTSIDE_DISCOVERY_ROOT") from error
    sidecar_relative = canonical_vault_path(vault_root, supplied_relative)
    if not sidecar_relative.startswith(("02. Books/", "03. Papers/")):
        raise PdfFoundationError("PDF_SIDECAR_OUTSIDE_DISCOVERY_ROOT")
    # M10/T2-R21: stat BEFORE reading. The length check used to run after
    # `read_bytes()` had already materialised the whole file, so the 64 KiB cap
    # bounded nothing about memory: a large sidecar was fully resident first.
    # This mirrors the PDF path, which checks `before_pdf.size` before hashing.
    if sidecar_path.stat().st_size > MAX_SIDECAR_BYTES:
        raise PdfFoundationError("PDF_SIDECAR_TOO_LARGE")
    raw = sidecar_path.read_bytes()
    if len(raw) > MAX_SIDECAR_BYTES:
        raise PdfFoundationError("PDF_SIDECAR_TOO_LARGE")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise PdfFoundationError("PDF_SIDECAR_INVALID_UTF8") from error

    frontmatter, body = _split_frontmatter(text)
    if frontmatter.strip():
        try:
            metadata = yaml.safe_load(frontmatter)
        except yaml.YAMLError as error:
            raise PdfFoundationError("PDF_SIDECAR_INVALID_SOURCE") from error
        if not isinstance(metadata, dict):
            raise PdfFoundationError("PDF_SIDECAR_INVALID_SOURCE")
    visible_body = _visible_markdown(body)
    headings = _H1.findall(visible_body)
    if len(headings) > 1:
        raise PdfFoundationError("PDF_SIDECAR_H1_INVALID")
    title = (
        headings[0].strip()
        if headings
        else unicodedata.normalize("NFC", PurePosixPath(sidecar_relative).stem)
    )
    pdf_embeds = _visible_pdf_embeds(visible_body)
    if len(pdf_embeds) != 1:
        raise PdfFoundationError("PDF_SIDECAR_EMBED_INVALID")
    target = pdf_embeds[0].strip()
    if not target or "|" in target or "#" in target or "://" in target:
        raise PdfFoundationError("PDF_SIDECAR_EMBED_INVALID")
    normalized_target = target.replace("\\", "/")
    basename_only = "/" not in normalized_target
    if basename_only:
        basename_targets = (
            pdf_basename_targets
            if pdf_basename_targets is not None
            else _build_pdf_basename_targets(vault_root)
        )
        matches = basename_targets.get(normalized_target, ())
        if len(matches) != 1:
            raise PdfFoundationError("PDF_SOURCE_PATH_INVALID")
        target = matches[0]
    source_path = canonical_vault_path(vault_root, target, require_pdf=True)
    if not basename_only and not source_path.startswith(("02. Books/", "03. Papers/", "Archives/")):
        raise PdfFoundationError("PDF_SIDECAR_EMBED_INVALID")
    source_file = validated_vault_regular_file(vault_root, source_path, require_pdf=True)
    # F-440 (R9-L09-4): stat BEFORE hashing, exactly as the sidecar check
    # above does. The only PDF ceiling used to live in the build path, so
    # discovery read and digested an oversized file in full first.
    if source_file.stat().st_size > MAX_PDF_BYTES:
        raise PdfFoundationError("PDF_FILE_TOO_LARGE")
    raw_tags = tuple(f"#{tag}" for tag in _TAG.findall(visible_body))
    canonical_topics = tuple(dict.fromkeys(TAG_TO_TOPIC[tag] for tag in raw_tags if tag in TAG_TO_TOPIC))
    if not canonical_topics:
        raise PdfFoundationError("REQUIRED_TOPIC_TAG_MISSING")
    return PdfSidecar(
        sidecar_path=sidecar_relative,
        source_path=source_path,
        title=title,
        canonical_topics=canonical_topics,
        tags=tuple(sorted({unicodedata.normalize("NFC", tag[1:]).casefold() for tag in raw_tags})),
        pdf_digest=sha256_file(source_file),
        sidecar_digest=hashlib.sha256(raw).hexdigest(),
    )


def discover_pdf_sidecars(vault_root: Path) -> tuple[PdfSidecar, ...]:
    """Discover visible-PDF-embed sidecars under the two approved roots."""

    discovered: list[PdfSidecar] = []
    targets: dict[str, str] = {}
    basename_targets: dict[str, tuple[str, ...]] | None = None
    resolved_vault = vault_root.resolve(strict=True)
    for root_name in ("02. Books", "03. Papers"):
        root = resolved_vault / root_name
        if not root.exists():
            continue
        _assert_no_link_or_reparse(resolved_vault, root)
        for sidecar in sorted(root.rglob("*.md")):
            # M10/T2-R21: check oversize sidecars by STAT, before any read. An
            # omitted sidecar would make its still-present PDF look stale during
            # incremental publication, so preserve its safe source path in the
            # discovery error and let the lifecycle fail the run without deletes.
            if sidecar.stat().st_size > MAX_SIDECAR_BYTES:
                try:
                    sidecar_path = sidecar.relative_to(resolved_vault).as_posix()
                except ValueError as error:
                    raise PdfFoundationError("PDF_SIDECAR_OUTSIDE_DISCOVERY_ROOT") from error
                raise PdfFoundationError("PDF_SIDECAR_TOO_LARGE", sidecar_path)
            raw = sidecar.read_bytes()
            recognition_text = raw.decode("utf-8", errors="ignore")
            try:
                _, recognition_body = _split_frontmatter(recognition_text)
            except PdfFoundationError:
                recognition_body = recognition_text
            pdf_embeds = _visible_pdf_embeds(_visible_markdown(recognition_body))
            if len(pdf_embeds) != 1:
                continue
            normalized_target = pdf_embeds[0].strip().replace("\\", "/")
            if "/" not in normalized_target and basename_targets is None:
                basename_targets = _build_pdf_basename_targets(resolved_vault)
            item = parse_pdf_sidecar(
                resolved_vault,
                sidecar,
                pdf_basename_targets=basename_targets,
            )
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
        return "", text
    lines = text.splitlines(keepends=True)
    for index, line in enumerate(lines[1:], 1):
        if line.rstrip("\r\n") == "---":
            return "".join(lines[1:index]), "".join(lines[index + 1 :])
    raise PdfFoundationError("PDF_SIDECAR_INVALID_SOURCE")


def _visible_pdf_embeds(visible_markdown: str) -> list[str]:
    return [
        value
        for value in _EMBED.findall(visible_markdown)
        if value.split("|", 1)[0].split("#", 1)[0].strip().lower().endswith(".pdf")
    ]


def _build_pdf_basename_targets(vault_root: Path) -> dict[str, tuple[str, ...]]:
    root = vault_root.resolve(strict=True)
    targets: dict[str, list[str]] = {}
    pending = [root]
    while pending:
        directory = pending.pop()
        try:
            entries = sorted(os.scandir(directory), key=lambda entry: entry.name)
        except OSError as error:
            raise PdfFoundationError("PDF_SOURCE_PATH_INVALID") from error
        child_directories: list[Path] = []
        for entry in entries:
            candidate = Path(entry.path)
            try:
                info = entry.stat(follow_symlinks=False)
            except OSError as error:
                raise PdfFoundationError("PDF_SOURCE_PATH_INVALID") from error
            attributes = getattr(info, "st_file_attributes", 0)
            if (
                entry.is_symlink()
                or stat.S_ISLNK(info.st_mode)
                or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
            ):
                continue
            if stat.S_ISDIR(info.st_mode):
                child_directories.append(candidate)
                continue
            if stat.S_ISREG(info.st_mode) and candidate.suffix.lower() == ".pdf":
                relative = candidate.relative_to(root).as_posix()
                targets.setdefault(candidate.name, []).append(relative)
        pending.extend(reversed(child_directories))
    return {name: tuple(sorted(paths)) for name, paths in targets.items()}


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
        # M10/T2-R23: same ordering defect as markdown_adapter. Inline code
        # is stripped first, so an opener inside a backtick span cannot be
        # mistaken for a real comment. Proven by execution: a sidecar with
        # 'Start `<!--` marker.` yielded an empty body, so its
        # `![[Book.pdf]]` embed was never seen and the PDF never indexed.
        without_code = _strip_inline_code(line)
        without_comments, in_comment = _strip_html_comments(without_code, in_comment)
        visible.append(without_comments + newline)
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
