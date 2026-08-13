from __future__ import annotations

import json
import unittest

from app.run_errors import MAX_ERROR_ENTRIES, SafeRunError, deserialize_errors, serialize_errors


class RunErrorsTests(unittest.TestCase):
    def test_model_drift_is_a_run_level_error(self) -> None:
        error = SafeRunError("EMBEDDING_MODEL_DRIFT")
        self.assertIsNone(error.source_path)

    def test_serialization_deduplicates_sorts_and_truncates(self) -> None:
        z_path = "01. Knowledge/AI/z.md"
        a_path = "01. Knowledge/AI/a.md"
        errors = [SafeRunError("Z", z_path), SafeRunError("A", None), SafeRunError("Z", z_path)]
        errors.extend(SafeRunError(f"E{index:03d}", a_path) for index in range(60))
        payload = json.loads(serialize_errors(errors))
        self.assertEqual(payload["total_error_count"], 62)
        self.assertTrue(payload["truncated"])
        self.assertEqual(len(payload["errors"]), MAX_ERROR_ENTRIES)
        self.assertEqual(payload["errors"][0], {"code": "A", "source_path": None})

    def test_legacy_failure_detail_is_redacted(self) -> None:
        payload = deserialize_errors("password=not-safe")
        self.assertEqual(payload["errors"][0]["code"], "LEGACY_FAILURE_DETAIL")
        self.assertNotIn("password", str(payload))

    def test_safe_json_round_trip(self) -> None:
        payload = deserialize_errors(serialize_errors([SafeRunError("X", "01. Knowledge/AI/x.md")]))
        self.assertEqual(payload["errors"], [{"code": "X", "source_path": "01. Knowledge/AI/x.md"}])

    def test_unsafe_values_are_redacted_before_persistence(self) -> None:
        serialized = serialize_errors(
            [SafeRunError("password=secret", "../../database.env")]
        )
        self.assertNotIn("password", serialized)
        self.assertNotIn("database.env", serialized)
        self.assertEqual(
            json.loads(serialized)["errors"],
            [{"code": "UNSAFE_ERROR_REDACTED", "source_path": None}],
        )

    def test_noncanonical_or_nondeterministic_json_is_treated_as_legacy(self) -> None:
        unsafe_payloads = (
            '{"errors":[{"code":"X","source_path":"../secret"}],"total_error_count":1,"truncated":false}',
            '{"errors":[{"code":"Z","source_path":null},{"code":"A","source_path":null}],"total_error_count":2,"truncated":false}',
            '{"errors":[],"total_error_count":1,"truncated":false}',
        )
        for detail in unsafe_payloads:
            with self.subTest(detail=detail):
                payload = deserialize_errors(detail)
                self.assertEqual(payload["errors"][0]["code"], "LEGACY_FAILURE_DETAIL")
