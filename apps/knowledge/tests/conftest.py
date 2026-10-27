"""The collected-set floor of the Knowledgebase Python lane.

F-212 (R5-E09-04): the lane's whole reporting configuration was
`pytest tests -q`, and the recorded evidence was a bare pass count
(`188 passed`). A suite that SHRANK therefore read as an unchanged green:
nothing pinned the collected set, and a skip was invisible in the summary.

This module is the floor. It runs in every lane that uses the authoritative
runner (the CI `python-quality` job, the image test stage and a local
`uv run --directory apps/knowledge --locked python -m pytest tests -q`), and
it fails the session when the collected set drops below the floor for the
environment it is in.

The floor has two values because seven modules skip AT IMPORT when the
pinned tokenizer is not provisioned: without the artifact their tests are
never collected, so the collected set is legitimately smaller. The floor
therefore states what the environment can collect, and the tokenizer case
holds the larger one.

F-493 (R9-T11-3): the population this floor measures is `apps/knowledge/tests`
and nothing else, because that is the only directory either sanctioned pytest
invocation names. `apps/knowledge/pdf-runtime/tests` is NOT part of it: no
sanctioned executor runs that directory (both invocations root pytest at
`apps/knowledge/tests`, the image test stage copies `pdf-runtime/src` but
never `pdf-runtime/tests`, and the CI `python-quality` job deliberately does
not install the pdf-runtime closure), so a test module parked there has
no executor and its assertions bind nothing. The one module that lived there
(`test_ocr_contract.py`) was deleted and its behaviour -- the four-key scrubbed
environment and the fixed argv tail `zink_pdf_runtime.ocr` hands `Popen` -- is
bound from the parent lane by
`apps/knowledge/tests/test_m12_t9_r4_pdf_ocr_process_contract.py`, which also
pins the decision: it reddens if a child test module reappears under
`pdf-runtime/tests` or if the Dockerfile grows a copy line for it.
"""

from __future__ import annotations

import os
from pathlib import Path

# Collected with the pinned tokenizer provisioned (the CI lane).
MIN_COLLECTED_WITH_TOKENIZER = 245
# Collected without it: the seven tokenizer-gated modules skip at import and
# contribute no items.
MIN_COLLECTED_WITHOUT_TOKENIZER = 161


def _tokenizer_is_provisioned() -> bool:
    tokenizer = os.environ.get("KNOWLEDGE_TOKENIZER_PATH")
    return bool(tokenizer) and Path(tokenizer).is_file()


def pytest_collection_finish(session) -> None:  # type: ignore[no-untyped-def]
    """Fail the session when the collected set shrank below the floor.

    The floor is a property of the WHOLE suite -- that is, of the whole of
    `apps/knowledge/tests`, the only population a sanctioned invocation names
    (F-493) -- so it is only enforced when the run targets that directory. A
    scoped run (one module, one test) is a developer's own selection and
    carries no denominator.
    """

    if not _runs_the_whole_suite(session):
        return
    collected = len(session.items)
    floor = (
        MIN_COLLECTED_WITH_TOKENIZER
        if _tokenizer_is_provisioned()
        else MIN_COLLECTED_WITHOUT_TOKENIZER
    )
    if collected < floor:
        raise AssertionError(
            "The Knowledgebase Python suite collected "
            f"{collected} tests, below the floor of {floor} for this "
            "environment. A shrinking collected set must never read as an "
            "unchanged green: either a module stopped being collected, or the "
            "floor itself has to be moved deliberately."
        )


def _runs_the_whole_suite(session) -> bool:  # type: ignore[no-untyped-def]
    for argument in session.config.args:
        if Path(str(argument)).is_dir():
            return True
    return False
