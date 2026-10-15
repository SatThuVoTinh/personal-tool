from __future__ import annotations

import unicodedata
from dataclasses import dataclass, replace
from urllib.parse import quote

from .database import SearchCandidate
from .markdown_adapter import TOPIC_TO_TAG

RRF_K = 60
MAX_BRANCH_CANDIDATES = 40
MAX_FUSED_CANDIDATES = 80
MAX_RERANK_CANDIDATES = 20


class SearchValidationError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class SearchFilters:
    primary_topic: str | None
    tags_all: tuple[str, ...]
    path_prefix: str | None


@dataclass(frozen=True)
class FusedCandidate:
    candidate: SearchCandidate
    dense_rank: int | None
    fts_rank: int | None
    rrf_score: float
    best_branch_rank: int


class SearchLease:
    def __init__(self, limiter: "SearchCapacityLimiter") -> None:
        self._limiter = limiter
        self._released = False

    async def release(self) -> None:
        if self._released:
            return
        self._limiter._release()
        self._released = True


class SearchCapacityLimiter:
    """A two-slot, no-queue limiter with cancellation-safe leases."""

    def __init__(self, capacity: int = 2) -> None:
        if capacity < 1:
            raise ValueError("SEARCH_CAPACITY_INVALID")
        self._capacity = capacity
        self._held = 0

    async def try_acquire(self) -> SearchLease | None:
        # This method has no suspension point: check-and-increment is atomic
        # with respect to all request tasks on the service event loop.
        if self._held >= self._capacity:
            return None
        self._held += 1
        return SearchLease(self)

    def _release(self) -> None:
        if self._held <= 0:
            raise RuntimeError("SEARCH_LEASE_UNDERFLOW")
        self._held -= 1


def normalize_filters(
    primary_topic: str | None, tags_all: list[str] | None, path_prefix: str | None
) -> SearchFilters:
    topic = primary_topic.strip() if primary_topic is not None else None
    if topic is not None:
        if topic in TOPIC_TO_TAG:
            pass
        elif topic.lower() in TOPIC_TO_TAG:
            topic = topic.lower()
        elif topic.lower().replace("_", "-") in TOPIC_TO_TAG:
            topic = topic.lower().replace("_", "-")
        else:
            raise SearchValidationError("INVALID_SEARCH_REQUEST")
        from .markdown_adapter import CANONICAL_SLUG_TO_TOPIC
        topic = CANONICAL_SLUG_TO_TOPIC.get(topic, topic)
    normalized_tags: set[str] = set()
    for tag in tags_all or []:
        if not isinstance(tag, str):
            raise SearchValidationError("INVALID_SEARCH_REQUEST")
        value = unicodedata.normalize("NFC", tag.strip()).casefold()
        if value.startswith("#"):
            value = value[1:]
        if not value or any(character.isspace() for character in value):
            raise SearchValidationError("INVALID_SEARCH_REQUEST")
        normalized_tags.add(value)
    return SearchFilters(topic, tuple(sorted(normalized_tags)), _normalize_path_prefix(path_prefix))


def normalize_source_types(source_types: list[str] | None) -> tuple[str, ...]:
    if source_types is None:
        return ("MARKDOWN", "PDF")
    values = set(source_types)
    if not values or not values.issubset({"MARKDOWN", "PDF"}):
        raise SearchValidationError("INVALID_SEARCH_REQUEST")
    return tuple(value for value in ("MARKDOWN", "PDF") if value in values)


def _normalize_path_prefix(value: str | None) -> str | None:
    if value is None:
        return None
    path = unicodedata.normalize("NFC", value.strip()).replace("\\", "/")
    if not path or path.startswith("/") or ":" in path:
        raise SearchValidationError("INVALID_SEARCH_REQUEST")
    parts = path.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise SearchValidationError("INVALID_SEARCH_REQUEST")
    return "/".join(parts)


def fuse_candidates(
    dense: list[SearchCandidate], fts: list[SearchCandidate]
) -> list[FusedCandidate]:
    candidates: dict[str, SearchCandidate] = {}
    dense_ranks: dict[str, int] = {}
    fts_ranks: dict[str, int] = {}
    for rank, candidate in enumerate(dense[:MAX_BRANCH_CANDIDATES], start=1):
        if candidate.id not in dense_ranks:
            dense_ranks[candidate.id] = rank
            candidates[candidate.id] = candidate
    for rank, candidate in enumerate(fts[:MAX_BRANCH_CANDIDATES], start=1):
        if candidate.id in fts_ranks:
            continue
        fts_ranks[candidate.id] = rank
        previous = candidates.get(candidate.id)
        candidates[candidate.id] = (
            candidate
            if previous is None
            else replace(previous, fts_score=candidate.fts_score)
        )
    fused: list[FusedCandidate] = []
    for identifier, candidate in candidates.items():
        dense_rank = dense_ranks.get(identifier)
        fts_rank = fts_ranks.get(identifier)
        ranks = [rank for rank in (dense_rank, fts_rank) if rank is not None]
        rrf_score = sum(1.0 / (RRF_K + rank) for rank in ranks)
        fused.append(
            FusedCandidate(
                candidate=candidate,
                dense_rank=dense_rank,
                fts_rank=fts_rank,
                rrf_score=rrf_score,
                best_branch_rank=min(ranks),
            )
        )
    fused.sort(key=lambda item: (-item.rrf_score, item.best_branch_rank, item.candidate.id))
    return fused[:MAX_FUSED_CANDIDATES]


def render_citation(
    title: str, source_path: str, line_start: int | None, line_end: int | None
) -> str:
    escaped_title = title.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")
    encoded_path = quote(source_path, safe="/")
    # The pair is nullable in the schema, and a PDF row without pages reaches here
    # with it NULL. Printing the values anyway stated a location no record holds,
    # in the one field the owner uses to check an answer's provenance.
    if line_start is None or line_end is None:
        return f"[{escaped_title}](<{encoded_path}>)"
    return f"[{escaped_title}](<{encoded_path}>) (lines {line_start}-{line_end})"


def render_pdf_citation(title: str, source_path: str, page_start: int, page_end: int) -> str:
    escaped_title = title.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")
    encoded_path = quote(source_path, safe="/")
    pages = str(page_start) if page_start == page_end else f"{page_start}-{page_end}"
    return f"[{escaped_title}](<{encoded_path}#page={page_start}>) (pages {pages})"
