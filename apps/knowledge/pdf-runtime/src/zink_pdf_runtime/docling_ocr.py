"""Exact-candidate Docling adapter using the M4-owned Tesseract runner."""

from __future__ import annotations

import csv
import os
import shutil
import stat
import tempfile
import time
from collections.abc import Iterable
from pathlib import Path
from typing import Type

from docling.datamodel.accelerator_options import AcceleratorOptions
from docling.datamodel.base_models import Page
from docling.datamodel.document import ConversionResult
from docling.datamodel.pipeline_options import OcrOptions, TesseractCliOcrOptions
from docling.models.base_ocr_model import BaseOcrModel
from docling.pipeline.standard_pdf_pipeline import StandardPdfPipeline
from docling.utils.ocr_utils import tesseract_box_to_bounding_rectangle
from docling_core.types.doc import BoundingBox, CoordOrigin
from docling_core.types.doc.page import TextCell

from .ocr import OcrRuntimeError, region_deadline, require_deadline, run_tesseract

# F-284 (R7-C3-03): the deadline the parent sent for this extraction. The
# child runtime is a one-shot process that performs exactly one extraction,
# so the deadline is a property of that extraction and not state shared
# between concurrent requests.
_EXTRACTION_DEADLINE: float | None = None


def set_extraction_deadline(deadline: float | None) -> None:
    """Bind (or clear) the deadline that bounds this extraction."""

    global _EXTRACTION_DEADLINE
    _EXTRACTION_DEADLINE = deadline


def _prepare_temp_root() -> Path:
    """Create the child's private temp root and remove a killed child's residue.

    F-442 (R9-L09-6): each region lives inside a ``TemporaryDirectory`` that
    only the context manager or ``atexit`` removes.  The parent kills the
    child's whole process group when its deadline expires, so neither runs and
    the region directory survived inside the container's tmpfs.  The parent
    serialises runtime invocations, so every pre-existing child of this root is
    residue from a killed invocation and is safe to remove here.
    """

    temp_root = Path(os.environ["ZINK_PDF_TEMP_ROOT"])
    temp_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if temp_root.is_symlink() or stat.S_IMODE(temp_root.stat().st_mode) != 0o700:
        raise OcrRuntimeError("PDF_RUNTIME_UNAVAILABLE")
    for entry in temp_root.iterdir():
        if entry.is_symlink() or not entry.is_dir():
            entry.unlink()
        else:
            shutil.rmtree(entry)
    return temp_root


class M4TesseractOcrModel(BaseOcrModel):
    """Reuses only Docling region and cell semantics, never its subprocess code."""

    def __init__(
        self,
        *,
        enabled: bool,
        artifacts_path: Path | None,
        options: OcrOptions,
        accelerator_options: AcceleratorOptions,
    ) -> None:
        fixed_options = TesseractCliOcrOptions(
            lang=["eng", "vie", "chi_sim"],
            psm=3,
            scale=3.0,
        )
        super().__init__(
            enabled=enabled,
            artifacts_path=artifacts_path,
            options=fixed_options,
            accelerator_options=accelerator_options,
        )
        self.scale = fixed_options.scale

    def __call__(self, conv_res: ConversionResult, page_batch: Iterable[Page]) -> Iterable[Page]:
        if not self.enabled:
            yield from page_batch
            return
        temp_root = _prepare_temp_root()
        for page in page_batch:
            if page._backend is None or not page._backend.is_valid():
                yield page
                continue
            rects = self.get_ocr_rects(page)
            if len(rects) > 32:
                raise OcrRuntimeError("PDF_RUNTIME_FAILED")
            cells: list[TextCell] = []
            for rect in rects:
                if rect.area() == 0:
                    continue
                # F-284 (R7-C3-03): every region is bounded by the deadline the
                # parent sent, not by a fresh ninety seconds.
                overall_deadline = require_deadline(_EXTRACTION_DEADLINE)
                image = page._backend.get_page_image(scale=self.scale, cropbox=rect)
                with tempfile.TemporaryDirectory(dir=temp_root) as directory:
                    image_path = Path(directory) / "region.png"
                    image.save(image_path, format="png")
                    image_path.chmod(0o600)
                    tsv = run_tesseract(image_path, deadline=region_deadline(overall_deadline))
                cells.extend(_tsv_cells(tsv, rect, image.size, self.scale))
            self.post_process_cells(cells, page, conv_res)
            yield page

    @classmethod
    def get_options_type(cls) -> Type[OcrOptions]:
        return TesseractCliOcrOptions


class M4StandardPdfPipeline(StandardPdfPipeline):
    def _make_ocr_model(self, art_path: Path | None) -> M4TesseractOcrModel:
        if art_path is None:
            raise OcrRuntimeError("PDF_RUNTIME_UNAVAILABLE")
        return M4TesseractOcrModel(
            enabled=self.pipeline_options.do_ocr,
            artifacts_path=art_path,
            options=self.pipeline_options.ocr_options,
            accelerator_options=self.pipeline_options.accelerator_options,
        )


def _tsv_cells(tsv: str, rect: BoundingBox, image_size: tuple[int, int], scale: float) -> list[TextCell]:
    cells: list[TextCell] = []
    for ordinal, row in enumerate(csv.DictReader(tsv.splitlines(), delimiter="\t")):
        text = (row.get("text") or "").strip()
        if not text:
            continue
        try:
            left, top = float(row["left"]), float(row["top"])
            right, bottom = left + float(row["width"]), top + float(row["height"])
            confidence = max(0.0, min(1.0, float(row["conf"]) / 100.0))
        except (KeyError, TypeError, ValueError):
            continue
        bbox = BoundingBox(l=left, t=top, r=right, b=bottom, coord_origin=CoordOrigin.TOPLEFT)
        cells.append(
            TextCell(
                index=ordinal,
                text=text,
                orig=text,
                from_ocr=True,
                confidence=confidence,
                rect=tesseract_box_to_bounding_rectangle(
                    bbox,
                    original_offset=rect,
                    scale=scale,
                    orientation=0,
                    im_size=image_size,
                ),
            )
        )
    return cells
