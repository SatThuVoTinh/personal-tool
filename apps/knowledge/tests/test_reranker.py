from __future__ import annotations

import asyncio
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np

from app.reranker import OnnxReranker


@dataclass
class _Encoding:
    ids: list[int]
    attention_mask: list[int]
    type_ids: list[int]


class _Budget:
    pad_token_id = 9

    def encode_pair(self, query: str, retrieval_text: str) -> _Encoding:
        size = 3 if retrieval_text == "short" else 5
        return _Encoding([1] * size, [1] * size, [0] * size)


@dataclass
class _Input:
    name: str


class _Session:
    def __init__(self, block: threading.Event | None = None) -> None:
        self.block = block
        self.started = threading.Event()
        self.calls = 0
        self.active = 0
        self.maximum_active = 0
        self.last_feeds: dict[str, np.ndarray] | None = None

    def get_inputs(self) -> list[_Input]:
        return [_Input("input_ids"), _Input("attention_mask")]

    def run(self, _: object, feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        self.calls += 1
        self.active += 1
        self.maximum_active = max(self.maximum_active, self.active)
        self.last_feeds = feeds
        self.started.set()
        try:
            if self.block is not None and not self.block.wait(timeout=3):
                raise RuntimeError("fake inference was not released")
            return [np.arange(feeds["input_ids"].shape[0], dtype=np.float32).reshape(-1, 1)]
        finally:
            self.active -= 1


def _reranker(session: _Session) -> OnnxReranker:
    reranker = object.__new__(OnnxReranker)
    reranker._token_budget = _Budget()
    reranker._np = np
    reranker._session = session
    reranker._executor = ThreadPoolExecutor(max_workers=1)
    return reranker


class RerankerTests(unittest.IsolatedAsyncioTestCase):
    async def test_entire_candidate_set_uses_one_manually_padded_run(self) -> None:
        session = _Session()
        reranker = _reranker(session)
        try:
            logits = await reranker.predict([("q", "short"), ("q", "long")])
            self.assertEqual(logits, [0.0, 1.0])
            self.assertEqual(session.calls, 1)
            self.assertEqual(session.last_feeds["input_ids"].shape, (2, 5))
            self.assertEqual(session.last_feeds["input_ids"][0].tolist(), [1, 1, 1, 9, 9])
            self.assertEqual(session.last_feeds["attention_mask"][0].tolist(), [1, 1, 1, 0, 0])
        finally:
            await reranker.close()

    async def test_cancelled_caller_cannot_overlap_native_inference(self) -> None:
        release = threading.Event()
        session = _Session(block=release)
        reranker = _reranker(session)
        try:
            first = asyncio.create_task(reranker.predict([("q", "long")]))
            self.assertTrue(await asyncio.to_thread(session.started.wait, 1))
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first
            second = asyncio.create_task(reranker.predict([("q", "short")]))
            await asyncio.sleep(0.05)
            self.assertEqual(session.calls, 1)
            self.assertEqual(session.maximum_active, 1)
            release.set()
            self.assertEqual(await second, [0.0])
            self.assertEqual(session.maximum_active, 1)
        finally:
            release.set()
            await reranker.close()
