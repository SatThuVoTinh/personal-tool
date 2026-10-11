from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Iterable

MAX_ERROR_ENTRIES = 50
_SAFE_ERROR_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
_MAX_SOURCE_PATH_LENGTH = 1024
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

    def as_dict(self) -> dict[str, str | None]:
        return {"code": self.code, "source_path": self.source_path}


def serialize_errors(errors: Iterable[SafeRunError]) -> str:
    unique = {_sanitize_error(error) for error in errors}
    ordered = sorted(unique, key=lambda item: (item[0] or "", item[1]))
    return json.dumps(
        {
            "errors": [
                SafeRunError(code=code, source_path=source_path).as_dict()
                for source_path, code in ordered[:MAX_ERROR_ENTRIES]
            ],
            "total_error_count": len(ordered),
            "truncated": len(ordered) > MAX_ERROR_ENTRIES,
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
            or truncated != (total > len(entries))
            or (truncated and len(entries) != MAX_ERROR_ENTRIES)
        ):
            return fallback
        safe_entries = []
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {"code", "source_path"}:
                return fallback
            code = entry.get("code")
            source_path = entry.get("source_path")
            if not _is_safe_code(code) or not _is_safe_source_path(source_path):
                return fallback
            safe_entries.append({"code": code, "source_path": source_path})
        expected_order = sorted(
            safe_entries, key=lambda entry: (entry["source_path"] or "", entry["code"])
        )
        if safe_entries != expected_order or len(
            {(entry["source_path"], entry["code"]) for entry in safe_entries}
        ) != len(safe_entries):
            return fallback
        return {"errors": safe_entries, "total_error_count": total, "truncated": truncated}
    except (TypeError, ValueError, KeyError):
        return fallback


def _sanitize_error(error: SafeRunError) -> tuple[str | None, str]:
    code = error.code if _is_safe_code(error.code) else "UNSAFE_ERROR_REDACTED"
    source_path = error.source_path if _is_safe_source_path(error.source_path) else None
    return source_path, code


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
