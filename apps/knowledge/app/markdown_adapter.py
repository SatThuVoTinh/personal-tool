from __future__ import annotations

import hashlib
import os
import re
import stat
import unicodedata
from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import yaml
from tokenizers import Encoding, Tokenizer

TARGET_CHARS = 1500
MAX_CHARS = 2000
QUERY_MAX_TOKENS = 256
PAIR_MAX_TOKENS = 1024
PAIR_SPECIAL_TOKENS_EXPECTED = 4
MAX_RETRIEVAL_TOKENS = 764
ARTIFACT_SHA256_EXPECTED = (
    "69564b696052886ed0ac63fa393e928384e0f8caada38c1f4864a9bfbf379c15"
)
QUERY_BUDGET_FIXTURE = " ".join(["a"] * QUERY_MAX_TOKENS)

TOPIC_TAGS: tuple[tuple[str, str], ...] = (
    ("AI", "#ai"),
    ("Data", "#data"),
    ("Cloud", "#cloud"),
    ("Machine Learning", "#machinelearning"),
    ("Logistics", "#logistics"),
    ("Supply Chain", "#supplychain"),
    ("Material Science", "#materialscience"),
    ("Agricultural Science", "#agriculturalscience"),
    ("Economic", "#economic"),
    ("Natural Science", "#naturalscience"),
    ("Social Science", "#socialscience"),
    ("English", "#english"),
    ("Chinese", "#chinese"),
)
TOPIC_TO_TAG = dict(TOPIC_TAGS)
TAG_TO_TOPIC = {tag: topic for topic, tag in TOPIC_TAGS}
ERROR_PRECEDENCE = {
    code: index
    for index, code in enumerate(
        (
            "SOURCE_PATH_OUTSIDE_VAULT",
            "SOURCE_LINK_NOT_ALLOWED",
            "SOURCE_READ_FAILED",
            "UNSUPPORTED_TOPIC",
            "INVALID_UTF8",
            "MALFORMED_FRONTMATTER",
            "REQUIRED_TOPIC_TAG_MISSING",
            "EMPTY_INDEXABLE_CONTENT",
            "HEADING_CONTEXT_TOO_LARGE",
            "OVERSIZED_FENCED_BLOCK",
        )
    )
}

_ATX_HEADING = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$")
_SETEXT = re.compile(r"^ {0,3}(=+|-+)[ \t]*$")
_FENCE_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?。！？])\s+")


@dataclass(frozen=True)
class MarkdownValidationError:
    source_path: str
    code: str
    detail: str


@dataclass(frozen=True)
class MarkdownSegment:
    chunk_ordinal: int
    text: str
    heading_text: str
    heading_path: tuple[str, ...]
    retrieval_text: str
    line_start: int
    line_end: int
    content_token_count: int
    retrieval_token_count: int


@dataclass(frozen=True)
class MarkdownSource:
    source_path: str
    sha256: str
    mime_type: str
    title: str
    primary_topic: str
    canonical_topics: tuple[str, ...]
    tags: tuple[str, ...]
    segments: tuple[MarkdownSegment, ...]


@dataclass(frozen=True)
class MarkdownScanResult:
    succeeded: bool
    discovered_count: int
    valid_source_count: int
    sources: tuple[MarkdownSource, ...]
    errors: tuple[MarkdownValidationError, ...]


@dataclass(frozen=True)
class _Block:
    text: str
    heading_path: tuple[str, ...]
    line_start: int
    line_end: int
    fenced: bool = False


class TokenBudget:
    def __init__(self, tokenizer_path: Path) -> None:
        digest = hashlib.sha256(tokenizer_path.read_bytes()).hexdigest()
        if digest != ARTIFACT_SHA256_EXPECTED:
            raise RuntimeError("TOKENIZER_ARTIFACT_MISMATCH")

        self.__tokenizer = Tokenizer.from_file(str(tokenizer_path))
        self.__tokenizer.no_truncation()
        self.__tokenizer.no_padding()
        if self.__tokenizer.truncation is not None:
            raise RuntimeError("TOKENIZER_TRUNCATION_ENABLED")
        if self.__tokenizer.padding is not None:
            raise RuntimeError("TOKENIZER_PADDING_ENABLED")
        actual_special_tokens = self.__tokenizer.num_special_tokens_to_add(is_pair=True)
        if actual_special_tokens != PAIR_SPECIAL_TOKENS_EXPECTED:
            raise RuntimeError("TOKENIZER_PAIR_SPECIAL_TOKEN_MISMATCH")
        if (
            PAIR_MAX_TOKENS - QUERY_MAX_TOKENS - actual_special_tokens
            != MAX_RETRIEVAL_TOKENS
        ):
            raise RuntimeError("TOKEN_BUDGET_INVARIANT_FAILED")
        if self.count(QUERY_BUDGET_FIXTURE) != QUERY_MAX_TOKENS:
            raise RuntimeError("QUERY_BUDGET_FIXTURE_INVALID")

    def count(self, text: str) -> int:
        return len(self.__tokenizer.encode(text, add_special_tokens=False).ids)

    def encode_pair(self, query: str, retrieval_text: str) -> Encoding:
        """Encode one reranker pair without truncation or padding.

        Indexing uses ``pair_count`` with a fixed 256-token query fixture.  The
        search path must additionally validate the *actual* query before a
        batch is manually padded for ONNX Runtime.
        """
        return self.__tokenizer.encode(
            query,
            pair=retrieval_text,
            add_special_tokens=True,
        )

    def pair_count_for_query(self, query: str, retrieval_text: str) -> int:
        return len(self.encode_pair(query, retrieval_text).ids)

    @property
    def pad_token_id(self) -> int:
        # ``no_padding`` above deliberately leaves no active padding policy.
        # The serialized tokenizer still exposes the canonical pad token.
        pad_id = self.__tokenizer.token_to_id("<pad>")
        if pad_id is None:
            raise RuntimeError("TOKENIZER_PAD_TOKEN_MISSING")
        return pad_id

    def pair_count(self, retrieval_text: str) -> int:
        encoding = self.__tokenizer.encode(
            QUERY_BUDGET_FIXTURE,
            pair=retrieval_text,
            add_special_tokens=True,
        )
        return len(encoding.ids)

    def offsets(self, text: str) -> tuple[tuple[int, int], ...]:
        encoding = self.__tokenizer.encode(text, add_special_tokens=False)
        return tuple((start, end) for start, end in encoding.offsets if end > start)

    def fits(self, retrieval_text: str) -> bool:
        return self.count(retrieval_text) <= MAX_RETRIEVAL_TOKENS and self.pair_count(
            retrieval_text
        ) <= PAIR_MAX_TOKENS


def render_retrieval_text(heading_path: Iterable[str], text: str) -> str:
    heading_context = " > ".join(heading_path)
    return f"{heading_context}\n\n{text}" if heading_context else text


class MarkdownVaultScanner:
    def __init__(self, token_budget: TokenBudget) -> None:
        self._token_budget = token_budget

    def scan_vault(
        self, vault_root: Path, *, include_valid_sources_on_error: bool = False
    ) -> MarkdownScanResult:
        try:
            vault_root_resolved = vault_root.resolve(strict=True)
            knowledge_root = vault_root_resolved / "01. Knowledge"
            if not knowledge_root.is_dir():
                raise OSError
            candidates, discovery_errors = self._discover_candidates(
                vault_root_resolved, knowledge_root
            )
        except (OSError, RuntimeError):
            error = MarkdownValidationError(
                source_path="",
                code="VAULT_ROOT_INVALID",
                detail="The configured Vault root or 01. Knowledge directory is invalid.",
            )
            return MarkdownScanResult(False, 0, 0, (), (error,))

        valid_sources: list[MarkdownSource] = []
        errors: list[MarkdownValidationError] = list(discovery_errors)
        for candidate in candidates:
            source, source_errors = self._validate_source(
                vault_root_resolved, knowledge_root, candidate
            )
            errors.extend(source_errors)
            if source is not None and not source_errors:
                valid_sources.append(source)

        errors = self._sort_and_deduplicate_errors(errors)
        if errors:
            return MarkdownScanResult(
                False,
                len(candidates),
                len(valid_sources),
                tuple(valid_sources) if include_valid_sources_on_error else (),
                tuple(errors),
            )
        return MarkdownScanResult(
            True,
            len(candidates),
            len(valid_sources),
            tuple(valid_sources),
            (),
        )

    def _discover_candidates(
        self, vault_root: Path, knowledge_root: Path
    ) -> tuple[list[Path], list[MarkdownValidationError]]:
        candidates: list[Path] = []
        errors: list[MarkdownValidationError] = []
        pending = [knowledge_root]
        while pending:
            directory = pending.pop()
            try:
                entries = sorted(os.scandir(directory), key=lambda entry: entry.name)
            except OSError:
                relative = directory.relative_to(vault_root).as_posix()
                errors.append(self._error(relative, "SOURCE_READ_FAILED"))
                continue
            for entry in entries:
                path = Path(entry.path)
                relative = path.relative_to(vault_root).as_posix()
                if self._is_link_like_entry(entry):
                    if path.suffix == ".md":
                        candidates.append(path)
                    else:
                        errors.append(self._error(relative, "SOURCE_LINK_NOT_ALLOWED"))
                    continue
                try:
                    if entry.is_dir(follow_symlinks=False):
                        pending.append(path)
                    elif entry.is_file(follow_symlinks=False) and path.suffix == ".md":
                        candidates.append(path)
                except OSError:
                    errors.append(self._error(relative, "SOURCE_READ_FAILED"))
        candidates.sort(key=lambda path: path.relative_to(vault_root).as_posix())
        return candidates, errors

    @staticmethod
    def _is_link_like_entry(entry: os.DirEntry[str]) -> bool:
        try:
            if entry.is_symlink():
                return True
            is_junction = getattr(entry, "is_junction", None)
            if is_junction is not None and is_junction():
                return True
            metadata = entry.stat(follow_symlinks=False)
        except OSError:
            return False
        attributes = getattr(metadata, "st_file_attributes", 0)
        reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        return bool(reparse_flag and attributes & reparse_flag)

    def _validate_source(
        self, vault_root: Path, knowledge_root: Path, candidate: Path
    ) -> tuple[MarkdownSource | None, list[MarkdownValidationError]]:
        try:
            source_path = candidate.relative_to(vault_root).as_posix()
        except ValueError:
            source_path = candidate.name
            return None, [self._error(source_path, "SOURCE_PATH_OUTSIDE_VAULT")]

        if self._has_link_component(knowledge_root, candidate):
            return None, [self._error(source_path, "SOURCE_LINK_NOT_ALLOWED")]

        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(vault_root)
        except (OSError, RuntimeError, ValueError):
            return None, [self._error(source_path, "SOURCE_PATH_OUTSIDE_VAULT")]

        try:
            raw_bytes = candidate.read_bytes()
        except OSError:
            return None, [self._error(source_path, "SOURCE_READ_FAILED")]

        errors: list[MarkdownValidationError] = []
        try:
            content = raw_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            errors.append(self._error(source_path, "INVALID_UTF8"))
            return None, errors

        lines = content.splitlines()
        content_start, frontmatter_error = self._frontmatter_end(lines)
        if frontmatter_error:
            errors.append(self._error(source_path, "MALFORMED_FRONTMATTER"))
            return None, errors

        title, raw_tags, blocks = self._parse_blocks(lines, content_start)
        canonical_topics = tuple(
            TAG_TO_TOPIC[raw_tag] for raw_tag in raw_tags if raw_tag in TAG_TO_TOPIC
        )
        if not canonical_topics:
            errors.append(self._error(source_path, "REQUIRED_TOPIC_TAG_MISSING"))

        segments, segmentation_errors = self._segment_blocks(source_path, blocks)
        errors.extend(segmentation_errors)
        if not segments and not segmentation_errors:
            errors.append(self._error(source_path, "EMPTY_INDEXABLE_CONTENT"))

        if errors:
            return None, errors

        primary_topic = canonical_topics[0]
        normalized_tags = tuple(
            sorted(
                {
                    unicodedata.normalize("NFC", raw_tag[1:]).casefold()
                    for raw_tag in raw_tags
                }
            )
        )
        return (
            MarkdownSource(
                source_path=source_path,
                sha256=hashlib.sha256(raw_bytes).hexdigest(),
                mime_type="text/markdown",
                title=title or candidate.stem,
                primary_topic=primary_topic,
                canonical_topics=canonical_topics,
                tags=normalized_tags,
                segments=segments,
            ),
            [],
        )

    @staticmethod
    def _has_link_component(root: Path, candidate: Path) -> bool:
        current = root
        relative = candidate.relative_to(root)
        for component in relative.parts:
            current = current / component
            try:
                metadata = os.lstat(current)
            except OSError:
                return False
            if stat.S_ISLNK(metadata.st_mode):
                return True
            attributes = getattr(metadata, "st_file_attributes", 0)
            reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
            if reparse_flag and attributes & reparse_flag:
                return True
            is_junction = getattr(current, "is_junction", None)
            if is_junction is not None and is_junction():
                return True
        return False

    @staticmethod
    def _frontmatter_end(lines: list[str]) -> tuple[int, bool]:
        if not lines or lines[0] != "---":
            return 0, False
        try:
            closing = lines.index("---", 1)
        except ValueError:
            return 0, True
        try:
            document = yaml.safe_load("\n".join(lines[1:closing]))
        except yaml.YAMLError:
            return 0, True
        if document is not None and not isinstance(document, dict):
            return 0, True
        return closing + 1, False

    def _parse_blocks(
        self, lines: list[str], start_index: int
    ) -> tuple[str, tuple[str, ...], list[_Block]]:
        title = ""
        raw_tags: list[str] = []
        seen_raw_tags: set[str] = set()
        blocks: list[_Block] = []
        heading_levels: list[str] = []
        paragraph: list[tuple[int, str]] = []
        in_comment = False
        index = start_index

        def flush_paragraph() -> None:
            if not paragraph:
                return
            text = "\n".join(value for _, value in paragraph).strip()
            if text:
                blocks.append(
                    _Block(
                        text=text,
                        heading_path=tuple(heading_levels),
                        line_start=paragraph[0][0],
                        line_end=paragraph[-1][0],
                    )
                )
            paragraph.clear()

        while index < len(lines):
            line_number = index + 1
            line = lines[index]
            fence_match = _FENCE_OPEN.match(line)
            if (
                fence_match
                and fence_match.group(1).startswith("`")
                and "`" in fence_match.group(2)
            ):
                fence_match = None
            if fence_match and not in_comment:
                flush_paragraph()
                fence = fence_match.group(1)
                fence_character = fence[0]
                fence_length = len(fence)
                fenced_lines = [(line_number, line)]
                index += 1
                while index < len(lines):
                    fenced_line = lines[index]
                    fenced_lines.append((index + 1, fenced_line))
                    closing = re.match(
                        rf"^ {{0,3}}{re.escape(fence_character)}{{{fence_length},}}[ \t]*$",
                        fenced_line,
                    )
                    index += 1
                    if closing:
                        break
                blocks.append(
                    _Block(
                        text="\n".join(value for _, value in fenced_lines),
                        heading_path=tuple(heading_levels),
                        line_start=fenced_lines[0][0],
                        line_end=fenced_lines[-1][0],
                        fenced=True,
                    )
                )
                continue

            visible, in_comment = self._strip_html_comments(line, in_comment)
            atx = _ATX_HEADING.match(visible)
            if atx:
                flush_paragraph()
                level = len(atx.group(1))
                heading = re.sub(r"[ \t]+#+[ \t]*$", "", atx.group(2)).strip()
                heading_levels[level - 1 :] = [heading]
                if level == 1 and not title:
                    title = heading
                index += 1
                continue

            if (
                visible.strip()
                and index + 1 < len(lines)
                and not in_comment
                and (setext := _SETEXT.match(lines[index + 1]))
            ):
                flush_paragraph()
                level = 1 if setext.group(1).startswith("=") else 2
                heading = visible.strip()
                heading_levels[level - 1 :] = [heading]
                if level == 1 and not title:
                    title = heading
                index += 2
                continue

            without_code = self._strip_inline_code(visible)
            tag_matches = self._extract_tags(without_code)
            line_tags = [raw_tag for raw_tag, _, _ in tag_matches]
            for raw_tag in line_tags:
                if raw_tag not in seen_raw_tags:
                    raw_tags.append(raw_tag)
                    seen_raw_tags.add(raw_tag)
            tagless_parts: list[str] = []
            tag_cursor = 0
            for _, tag_start, tag_end in tag_matches:
                tagless_parts.append(without_code[tag_cursor:tag_start])
                tag_cursor = tag_end
            tagless_parts.append(without_code[tag_cursor:])
            tagless = "".join(tagless_parts)
            if line_tags and not tagless.strip():
                flush_paragraph()
            elif not visible.strip():
                flush_paragraph()
            else:
                paragraph.append((line_number, visible))
            index += 1

        flush_paragraph()
        return title, tuple(raw_tags), blocks

    @staticmethod
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

    @staticmethod
    def _strip_inline_code(line: str) -> str:
        output: list[str] = []
        cursor = 0
        while cursor < len(line):
            if line[cursor] != "`":
                output.append(line[cursor])
                cursor += 1
                continue
            run_end = cursor
            while run_end < len(line) and line[run_end] == "`":
                run_end += 1
            delimiter_length = run_end - cursor
            closing = MarkdownVaultScanner._find_backtick_run(
                line, run_end, delimiter_length
            )
            if closing < 0:
                output.append(line[cursor:run_end])
                cursor = run_end
                continue
            output.append(" " * (closing + delimiter_length - cursor))
            cursor = closing + delimiter_length
        return "".join(output)

    @staticmethod
    def _find_backtick_run(line: str, start: int, expected_length: int) -> int:
        cursor = start
        while cursor < len(line):
            opening = line.find("`", cursor)
            if opening < 0:
                return -1
            end = opening
            while end < len(line) and line[end] == "`":
                end += 1
            if end - opening == expected_length:
                return opening
            cursor = end
        return -1

    @staticmethod
    def _extract_tags(text: str) -> list[tuple[str, int, int]]:
        matches: list[tuple[str, int, int]] = []
        cursor = 0
        while cursor < len(text):
            if text[cursor] != "#":
                cursor += 1
                continue
            if cursor > 0 and (text[cursor - 1] == "\\" or text[cursor - 1].isalnum() or text[cursor - 1] in "_/"):
                cursor += 1
                continue
            end = cursor + 1
            if end >= len(text) or not MarkdownVaultScanner._is_tag_start(text[end]):
                cursor += 1
                continue
            end += 1
            while end < len(text) and MarkdownVaultScanner._is_tag_continue(text[end]):
                end += 1
            matches.append((text[cursor:end], cursor, end))
            cursor = end
        return matches

    @staticmethod
    def _is_tag_start(character: str) -> bool:
        category = unicodedata.category(character)
        return character == "_" or category[0] in {"L", "N"}

    @staticmethod
    def _is_tag_continue(character: str) -> bool:
        category = unicodedata.category(character)
        return character in "_/-" or category[0] in {"L", "M", "N"}

    def _segment_blocks(
        self, source_path: str, blocks: list[_Block]
    ) -> tuple[tuple[MarkdownSegment, ...], list[MarkdownValidationError]]:
        errors: list[MarkdownValidationError] = []
        atoms: list[_Block] = []
        for block in blocks:
            if not self._heading_has_room(block.heading_path):
                errors.append(self._error(source_path, "HEADING_CONTEXT_TOO_LARGE"))
                continue
            if block.fenced:
                retrieval_text = render_retrieval_text(block.heading_path, block.text)
                if len(block.text) > MAX_CHARS or not self._token_budget.fits(
                    retrieval_text
                ):
                    errors.append(self._error(source_path, "OVERSIZED_FENCED_BLOCK"))
                else:
                    atoms.append(block)
                continue
            atoms.extend(self._split_prose_block(block))

        segments: list[MarkdownSegment] = []
        current: list[_Block] = []
        for atom in atoms:
            if atom.fenced:
                if current:
                    segments.append(self._build_segment(len(segments), current))
                    current = []
                segments.append(self._build_segment(len(segments), [atom]))
                continue
            if current and current[0].heading_path != atom.heading_path:
                segments.append(self._build_segment(len(segments), current))
                current = []
            candidate = current + [atom]
            if current and len(self._join_blocks(current)) >= TARGET_CHARS:
                segments.append(self._build_segment(len(segments), current))
                current = [atom]
            elif current and not self._blocks_fit(candidate):
                segments.append(self._build_segment(len(segments), current))
                current = [atom]
            else:
                current = candidate
        if current:
            segments.append(self._build_segment(len(segments), current))
        return tuple(segments), self._sort_and_deduplicate_errors(errors)

    def _split_prose_block(self, block: _Block) -> list[_Block]:
        if self._block_fits(block):
            return [block]
        pieces = self._pieces_with_lines(block, _SENTENCE_BOUNDARY)
        output: list[_Block] = []
        for piece in pieces:
            if self._block_fits(piece):
                output.append(piece)
                continue
            output.extend(self._split_by_words(piece))
        return output

    def _split_by_words(self, block: _Block) -> list[_Block]:
        words = list(re.finditer(r"\S+", block.text))
        if not words:
            return []
        word_ends = [word.end() for word in words]
        output: list[_Block] = []
        start = 0
        while start < len(words):
            best: int | None = None
            character_start = words[start].start()
            low = start
            high = bisect_right(word_ends, character_start + MAX_CHARS) - 1
            while low <= high:
                end = (low + high) // 2
                text = block.text[character_start : words[end].end()]
                candidate = _Block(
                    text,
                    block.heading_path,
                    self._line_for_offset(block, character_start),
                    self._line_for_offset(block, words[end].end() - 1),
                )
                if self._block_fits(candidate):
                    best = end
                    low = end + 1
                else:
                    high = end - 1
            if best is None:
                word = words[start]
                output.extend(
                    self._split_by_token_offsets(
                        _Block(
                            block.text[word.start() : word.end()],
                            block.heading_path,
                            self._line_for_offset(block, word.start()),
                            self._line_for_offset(block, word.end() - 1),
                        )
                    )
                )
                start += 1
                continue
            text = block.text[words[start].start() : words[best].end()]
            output.append(
                _Block(
                    text,
                    block.heading_path,
                    self._line_for_offset(block, words[start].start()),
                    self._line_for_offset(block, words[best].end() - 1),
                )
            )
            start = best + 1
        return output

    def _split_by_token_offsets(self, block: _Block) -> list[_Block]:
        offsets = self._token_budget.offsets(block.text)
        if not offsets:
            return []

        output: list[_Block] = []
        start = 0
        while start < len(offsets):
            candidate: _Block | None = None
            best_end = start
            low = start + 1
            high = min(start + MAX_RETRIEVAL_TOKENS, len(offsets))
            while low <= high:
                end = (low + high) // 2
                character_start = offsets[start][0]
                character_end = offsets[end - 1][1]
                proposed = _Block(
                    block.text[character_start:character_end],
                    block.heading_path,
                    self._line_for_offset(block, character_start),
                    self._line_for_offset(block, character_end - 1),
                )
                if self._block_fits(proposed):
                    candidate = proposed
                    best_end = end
                    low = end + 1
                else:
                    high = end - 1
            if candidate is None:
                raise RuntimeError("Tokenizer offset cannot fit the retrieval budget.")
            output.append(candidate)
            start = best_end
        return output

    def _pieces_with_lines(self, block: _Block, boundary: re.Pattern[str]) -> list[_Block]:
        pieces: list[_Block] = []
        start = 0
        for match in boundary.finditer(block.text):
            end = match.start()
            if end > start:
                pieces.append(
                    _Block(
                        block.text[start:end].strip(),
                        block.heading_path,
                        self._line_for_offset(block, start),
                        self._line_for_offset(block, end - 1),
                    )
                )
            start = match.end()
        if start < len(block.text):
            pieces.append(
                _Block(
                    block.text[start:].strip(),
                    block.heading_path,
                    self._line_for_offset(block, start),
                    block.line_end,
                )
            )
        return pieces

    @staticmethod
    def _line_for_offset(block: _Block, offset: int) -> int:
        return block.line_start + block.text[:offset].count("\n")

    def _heading_has_room(self, heading_path: tuple[str, ...]) -> bool:
        return self._token_budget.fits(render_retrieval_text(heading_path, "x"))

    def _block_fits(self, block: _Block) -> bool:
        retrieval = render_retrieval_text(block.heading_path, block.text)
        return len(block.text) <= MAX_CHARS and self._token_budget.fits(retrieval)

    def _blocks_fit(self, blocks: list[_Block]) -> bool:
        text = self._join_blocks(blocks)
        retrieval = render_retrieval_text(blocks[0].heading_path, text)
        return len(text) <= MAX_CHARS and self._token_budget.fits(retrieval)

    @staticmethod
    def _join_blocks(blocks: list[_Block]) -> str:
        return "\n\n".join(block.text for block in blocks)

    def _build_segment(
        self, ordinal: int, blocks: list[_Block]
    ) -> MarkdownSegment:
        text = self._join_blocks(blocks)
        heading_path = blocks[0].heading_path
        retrieval_text = render_retrieval_text(heading_path, text)
        return MarkdownSegment(
            chunk_ordinal=ordinal,
            text=text,
            heading_text=heading_path[-1] if heading_path else "",
            heading_path=heading_path,
            retrieval_text=retrieval_text,
            line_start=blocks[0].line_start,
            line_end=blocks[-1].line_end,
            content_token_count=self._token_budget.count(text),
            retrieval_token_count=self._token_budget.count(retrieval_text),
        )

    @staticmethod
    def _error(source_path: str, code: str) -> MarkdownValidationError:
        details = {
            "SOURCE_PATH_OUTSIDE_VAULT": "The source path escapes the configured Vault root.",
            "SOURCE_LINK_NOT_ALLOWED": "Symbolic and link-like source paths are not allowed.",
            "SOURCE_READ_FAILED": "The source could not be read.",
            "UNSUPPORTED_TOPIC": "The source is not under a canonical topic folder.",
            "INVALID_UTF8": "The source is not valid UTF-8.",
            "MALFORMED_FRONTMATTER": "The source frontmatter is malformed.",
            "REQUIRED_TOPIC_TAG_MISSING": "A lowercase canonical native topic tag is missing.",
            "EMPTY_INDEXABLE_CONTENT": "The source has no indexable passage content.",
            "HEADING_CONTEXT_TOO_LARGE": "The heading context leaves no retrieval passage budget.",
            "OVERSIZED_FENCED_BLOCK": "A fenced code block exceeds a hard segment budget.",
        }
        return MarkdownValidationError(source_path, code, details[code])

    @staticmethod
    def _sort_and_deduplicate_errors(
        errors: Iterable[MarkdownValidationError],
    ) -> list[MarkdownValidationError]:
        unique = {(error.source_path, error.code): error for error in errors}
        return sorted(
            unique.values(),
            key=lambda error: (
                error.source_path,
                ERROR_PRECEDENCE.get(error.code, -1),
            ),
        )
