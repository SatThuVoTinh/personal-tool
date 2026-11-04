from __future__ import annotations

import unicodedata
from dataclasses import dataclass, replace
from urllib.parse import quote

from .database import SearchCandidate
from .markdown_adapter import CANONICAL_SLUG_TO_TOPIC, TOPIC_TO_TAG

RRF_K = 60
MAX_BRANCH_CANDIDATES = 40
MAX_FUSED_CANDIDATES = 80
MAX_RERANK_CANDIDATES = 20

# F-116 (R5-E02-01): the scope a caller asks for is a scope. `namespace`,
# `subtopic`, `secondary_topics` and `capability` were DECLARED on the
# request, accepted under `extra="forbid"` (so an unknown key was refused)
# and then ignored by every query, so an answer scoped to a namespace was
# really corpus-wide and the owner cited content from another namespace
# believing it was governed.
#
# The Knowledgebase's own vocabulary is the canonical topic table: a source
# carries `primary_topic` and `canonical_topics`. A namespace that names one
# of those topics narrows the result set to it. `core` is the Zink Tools
# knowledge-tool contract's default namespace and means the default,
# unscoped corpus. A namespace that names no topic of the corpus matches
# NOTHING -- fail closed, so a scope can never widen into the whole corpus.
UNSCOPED_NAMESPACE = "core"
# The empty topic matches no segment: it is how "this scope names nothing
# the corpus carries" is expressed in the query, where a NULL parameter is
# how "no scope" is expressed.
NO_MATCH_TOPIC = ""


class SearchValidationError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class SearchFilters:
    primary_topic: str | None
    tags_all: tuple[str, ...]
    path_prefix: str | None
    # F-116 (R5-E02-01): the namespace scope and the secondary topics, both
    # expressed in the corpus's own canonical topics.
    namespace_topic: str | None
    canonical_topics_all: tuple[str, ...]


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
    primary_topic: str | None,
    tags_all: list[str] | None,
    path_prefix: str | None,
    namespace: str | None = None,
    secondary_topics: list[str] | None = None,
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
    return SearchFilters(
        topic,
        tuple(sorted(normalized_tags)),
        _normalize_path_prefix(path_prefix),
        normalize_namespace(namespace),
        normalize_secondary_topics(secondary_topics),
    )


def refuse_unhonourable_scope(subtopic: str | None, capability: str | None) -> None:
    """Refuse a scope this service has no dimension for.

    F-116 (R5-E02-01): `subtopic` and `capability` name dimensions the
    Knowledgebase does not have -- the corpus is partitioned by canonical
    topic, not by a topic subdivision and not by a skill capability.
    Answering them with the whole corpus is the defect this row is about, so
    they are refused instead.
    """

    for value in (subtopic, capability):
        if value is not None and value.strip():
            raise SearchValidationError("INVALID_SEARCH_REQUEST")


def normalize_namespace(namespace: str | None) -> str | None:
    """The corpus topic a namespace names.

    F-116 (R5-E02-01): `None` is the unscoped corpus. A namespace that
    names a topic of the corpus narrows to it. A namespace that names none
    narrows to nothing, because a scope that cannot be honoured must never
    be answered with the whole corpus.
    """

    if namespace is None:
        return None
    value = unicodedata.normalize("NFC", namespace.strip())
    if not value:
        return None
    if value.casefold() == UNSCOPED_NAMESPACE:
        return None
    topic = _canonical_topic(value)
    return topic if topic is not None else NO_MATCH_TOPIC


def normalize_secondary_topics(secondary_topics: list[str] | None) -> tuple[str, ...]:
    """The canonical topics a segment must ALSO carry.

    F-116 (R5-E02-01): an empty list is no scope at all. A topic that
    names nothing the corpus carries narrows to nothing, for the same
    reason a namespace does.
    """

    if not secondary_topics:
        return ()
    topics: list[str] = []
    for value in secondary_topics:
        if not isinstance(value, str):
            raise SearchValidationError("INVALID_SEARCH_REQUEST")
        candidate = unicodedata.normalize("NFC", value.strip())
        if not candidate:
            raise SearchValidationError("INVALID_SEARCH_REQUEST")
        topic = _canonical_topic(candidate)
        topics.append(topic if topic is not None else NO_MATCH_TOPIC)
    return tuple(dict.fromkeys(topics))


def _canonical_topic(value: str) -> str | None:
    """The corpus topic a spelling names, or None when it names none."""

    lowered = value.casefold()
    dashed = lowered.replace("_", "-")
    for candidate in (value, lowered, dashed):
        topic = CANONICAL_SLUG_TO_TOPIC.get(candidate)
        if topic is not None:
            return topic
    for candidate in (value, lowered, dashed):
        if candidate in TOPIC_TO_TAG:
            return candidate
    return None


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
