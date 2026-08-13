from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Iterable

MAX_ERROR_ENTRIES = 50


@dataclass(frozen=True)
class SafeRunError:
    code: str
    source_path: str | None = None

    def as_dict(self) -> dict[str, str | None]:
        return {"code": self.code, "source_path": self.source_path}


def serialize_errors(errors: Iterable[SafeRunError]) -> str:
    unique = {(error.source_path, error.code) for error in errors}
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
        entries = payload["errors"]
        total = payload["total_error_count"]
        truncated = payload["truncated"]
        if (
            not isinstance(entries, list)
            or not isinstance(total, int)
            or total < len(entries)
            or not isinstance(truncated, bool)
            or len(entries) > MAX_ERROR_ENTRIES
        ):
            return fallback
        safe_entries = []
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("code"), str):
                return fallback
            source_path = entry.get("source_path")
            if source_path is not None and not isinstance(source_path, str):
                return fallback
            safe_entries.append({"code": entry["code"], "source_path": source_path})
        return {"errors": safe_entries, "total_error_count": total, "truncated": truncated}
    except (TypeError, ValueError, KeyError):
        return fallback
