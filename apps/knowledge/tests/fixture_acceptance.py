from __future__ import annotations

import json
from pathlib import Path

from app.markdown_adapter import MarkdownVaultScanner, TokenBudget


budget = TokenBudget(Path("/app/artifacts/tokenizer.json"))
result = MarkdownVaultScanner(budget).scan_vault(Path("/vault"))
print(
    json.dumps(
        {
            "succeeded": result.succeeded,
            "discovered_count": result.discovered_count,
            "valid_source_count": result.valid_source_count,
            "source_count": len(result.sources),
            "error_count": len(result.errors),
            "first_line_start": (
                result.sources[0].segments[0].line_start if result.sources else None
            ),
        }
    )
)
