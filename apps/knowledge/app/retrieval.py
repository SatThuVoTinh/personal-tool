from __future__ import annotations

import asyncio
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
        self._released = True
        await self._limiter._release()


class SearchCapacityLimiter:
    """A two-slot, no-queue limiter with cancellation-safe leases."""

    def __init__(self, capacity: int = 2) -> None:
        self._capacity = capacity
        self._held = 0
        self._lock = asyncio.Lock()

    async def try_acquire(self) -> SearchLease | None:
        async with self._lock:
            if self._held >= self._capacity:
                return None
            self._held += 1
            return SearchLease(self)

    async def _release(self) -> None:
        async with self._lock:
            if self._held <= 0:
                raise RuntimeError("SEARCH_LEASE_UNDERFLOW")
            self._held -= 1


def normalize_filters(
    primary_topic: str | None, tags_all: list[str] | None, path_prefix: str | None
) -> SearchFilters:
    topic = primary_topic.strip() if primary_topic is not None else None
    if topic is not None and topic not in TOPIC_TO_TAG:
        raise SearchValidationError("INVALID_SEARCH_REQUEST")
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
    merged: dict[str, dict[str, object]] = {}
    for rank, candidate in enumerate(dense, start=1):
        item = merged.setdefault("%s" % candidate.id, {"candidate": candidate})
        item["dense_rank"] = rank
        item["candidate"] = candidate
    for rank, candidate in enumerate(fts, start=1):
        item = merged.setdefault("%s" % candidate.id, {"candidate": candidate})
        item["fts_rank"] = rank
        previous = item["candidate"]
        if isinstance(previous, SearchCandidate):
            item["candidate"] = replace(previous, fts_score=candidate.fts_score)
    fused: list[FusedCandidate] = []
    for item in merged.values():
        dense_rank = item.get("dense_rank")
        fts_rank = item.get("fts_rank")
        ranks = [rank for rank in (dense_rank, fts_rank) if isinstance(rank, int)]
        assert ranks
        rrf_score = sum(1.0 / (RRF_K + rank) for rank in ranks)
        fused.append(
            FusedCandidate(
                candidate=item["candidate"],  # type: ignore[arg-type]
                dense_rank=dense_rank if isinstance(dense_rank, int) else None,
                fts_rank=fts_rank if isinstance(fts_rank, int) else None,
                rrf_score=rrf_score,
                best_branch_rank=min(ranks),
            )
        )
    fused.sort(key=lambda item: (-item.rrf_score, item.best_branch_rank, item.candidate.id))
    return fused[:MAX_FUSED_CANDIDATES]


def render_citation(title: str, source_path: str, line_start: int, line_end: int) -> str:
    escaped_title = title.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")
    encoded_path = quote(source_path, safe="/")
    return f"[{escaped_title}](<{encoded_path}>) (lines {line_start}-{line_end})"
