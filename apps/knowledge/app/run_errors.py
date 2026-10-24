from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Iterable

MAX_ERROR_ENTRIES = 50
_SAFE_ERROR_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
_MAX_SOURCE_PATH_LENGTH = 1024
# F-550 (R10-T06-2): how much diagnosis one durable run error may carry. The
# PDF child already bounds its own summary to this many characters, so the two
# bounds are one number: `app.pdf_runtime` imports it rather than repeating it.
CHILD_DETAIL_LIMIT = 512
# M11/T1-R1 3.5 (M1): markdown sources live under "01. Knowledge", PDF sources
# under the roots pdf_foundation admits. A PDF failure attributed to
# "02. Books/…" used to be dropped by the sanitizer, so the operator saw an
# unattributed run error.
_SAFE_SOURCE_ROOTS = frozenset(
    {"01. Knowledge", "02. Books", "03. Papers", "Archives"}
)


@dataclass(frozen=True)
class SafeRunError:
    code: str
    source_path: str | None = None
    # F-550 (R10-T06-2): the diagnosis the producer already computed — for a
    # PDF child, the bounded `exit=N; stderr=…` summary. It is a separate
    # member precisely because the code must stay one switchable value; without
    # it an OOM kill and a missing artifact both persisted as
    # `PDF_RUNTIME_FAILED` and the run row could not tell them apart.
    cause: str | None = None

    def as_dict(self) -> dict[str, str | None]:
        return {
            "code": self.code,
            "source_path": self.source_path,
            "cause": self.cause,
        }


def serialize_errors(errors: Iterable[SafeRunError]) -> str:
    """Serialise run errors, counting the errors SUPPLIED.

    F-307 (R7-E1-02): the count used to be the length of the DEDUPLICATED,
    sanitised set, so `total_error_count` was not the number of errors and
    the truncation flag was derived from the reduced list. The count is now
    the number of error objects supplied, and the flag says whether the
    REPORTED list was cut.
    """

    supplied = list(errors)
    unique = {_sanitize_error(error) for error in supplied}
    ordered = sorted(unique, key=lambda item: (item[0] or "", item[1], item[2] or ""))
    return json.dumps(
        {
            "errors": [
                SafeRunError(
                    code=code, source_path=source_path, cause=cause
                ).as_dict()
                for source_path, code, cause in ordered[:MAX_ERROR_ENTRIES]
            ],
            "total_error_count": len(supplied),
            # F-307 (R7-E1-02): the flag reflects the RAW list -- more
            # errors happened than the cap allows to be reported -- not the
            # reduced one.
            "truncated": len(supplied) > MAX_ERROR_ENTRIES,
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def deserialize_errors(detail: str | None) -> dict[str, Any]:
    fallback = {
        "errors": [
            {
                "code": "LEGACY_FAILURE_DETAIL",
                "message": "Legacy failure detail is unavailable.",
                "source_path": None,
            }
        ],
        "total_error_count": 1,
        "truncated": False,
    }
    if not detail:
        return {"errors": [], "total_error_count": 0, "truncated": False}
    try:
        payload = json.loads(detail)
        if not isinstance(payload, dict) or set(payload) != {
            "errors",
            "total_error_count",
            "truncated",
        }:
            return fallback
        entries = payload["errors"]
        total = payload["total_error_count"]
        truncated = payload["truncated"]
        if (
            not isinstance(entries, list)
            or not isinstance(total, int)
            or isinstance(total, bool)
            or total < len(entries)
            or not isinstance(truncated, bool)
            or len(entries) > MAX_ERROR_ENTRIES
            # F-307 (R7-E1-02): the count is the number of errors SUPPLIED
            # and the flag says whether the reported list was cut, so the
            # two are related by the reported list and not by each other.
            or truncated != (total > MAX_ERROR_ENTRIES)
            # A payload that claims errors but reports none (or reports
            # some while claiming none) cannot be produced by the
            # serialiser and is not read as one.
            or (total == 0) != (len(entries) == 0)
        ):
            return fallback
        safe_entries = []
        for entry in entries:
            if not isinstance(entry, dict) or not _entry_keys_allowed(entry):
                return fallback
            code = entry.get("code")
            source_path = entry.get("source_path")
            cause = entry.get("cause")
            if not _is_safe_code(code) or not _is_safe_source_path(source_path):
                return fallback
            if not _is_safe_cause(cause):
                return fallback
            safe_entries.append(
                {"code": code, "source_path": source_path, "cause": cause}
            )
        expected_order = sorted(
            safe_entries,
            key=lambda entry: (
                entry["source_path"] or "",
                entry["code"],
                entry["cause"] or "",
            ),
        )
        if safe_entries != expected_order or len(
            {
                (entry["source_path"], entry["code"], entry["cause"])
                for entry in safe_entries
            }
        ) != len(safe_entries):
            return fallback
        return {"errors": safe_entries, "total_error_count": total, "truncated": truncated}
    except (TypeError, ValueError, KeyError):
        return fallback


def _sanitize_error(error: SafeRunError) -> tuple[str | None, str, str | None]:
    code = error.code if _is_safe_code(error.code) else "UNSAFE_ERROR_REDACTED"
    source_path = error.source_path if _is_safe_source_path(error.source_path) else None
    cause = sanitize_cause(error.cause)
    return source_path, code, cause


def _entry_keys_allowed(entry: dict[str, Any]) -> bool:
    # A run row written before F-550 carries two members; it stays readable
    # rather than collapsing to the legacy-failure fallback.
    return set(entry) in ({"code", "source_path"}, {"code", "source_path", "cause"})


def _is_safe_cause(value: object) -> bool:
    return value is None or (
        isinstance(value, str)
        and value == _scrub_cause(value)
        and 0 < len(value) <= CHILD_DETAIL_LIMIT
    )


def sanitize_cause(value: str | None) -> str | None:
    """Bound and scrub one cause, so it can never carry an unbounded child string.

    F-550 (R10-T06-2) reuses the shape rules `_is_safe_source_path` applies —
    nothing below 0x20, nothing at or above 0x7F, no length beyond the child's
    own bound — but scrubs instead of dropping: the diagnosis is the reason the
    member exists, and an unprintable byte in a stderr tail must not erase it.
    """

    if not isinstance(value, str):
        return None
    scrubbed = _scrub_cause(value)
    return scrubbed or None


def _scrub_cause(value: str) -> str:
    return "".join(
        character if 0x20 <= ord(character) < 0x7F else " " for character in value
    )[:CHILD_DETAIL_LIMIT]


def _is_safe_code(value: object) -> bool:
    return isinstance(value, str) and _SAFE_ERROR_CODE.fullmatch(value) is not None


def _is_safe_source_path(value: object) -> bool:
    if value is None:
        return True
    if not isinstance(value, str) or not value or len(value) > _MAX_SOURCE_PATH_LENGTH:
        return False
    if "\\" in value or value.startswith("/") or any(ord(char) < 32 for char in value):
        return False
    parts = value.split("/")
    return parts[0] in _SAFE_SOURCE_ROOTS and all(
        part not in {"", ".", ".."} for part in parts
    )
