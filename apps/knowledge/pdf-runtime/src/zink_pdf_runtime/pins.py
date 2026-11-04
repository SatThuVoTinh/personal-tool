"""The PDF runtime's supply-chain pin literals.

F-548 (R10-T05-5 / R10-L08-2): the same requirements-artifact digest was
re-declared by the image-side guard and by the parent test, and each copy
satisfied its own assertion. The digest now lives here; the guard imports it,
and the parent lane imports this module by path and checks every remaining
carrier against it.
"""

from __future__ import annotations

EXPECTED_HASHED_REQUIREMENTS_SHA256 = (
    "9ec325c8142e1dcae25dd510daa604454526ad9b364f505b9914aed3505f8556"
)
