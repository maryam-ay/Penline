import gc
import io
import os
import logging

import numpy as np
import potrace
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

FRONTEND_URL = os.getenv("FRONTEND_URL", "*")
MAX_FILE_SIZE = 2 * 1024 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

app = FastAPI(title="Penline")

origins = ["*"] if FRONTEND_URL == "*" else [FRONTEND_URL]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exc(request, exc):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_exc(request, exc):
    return JSONResponse(status_code=422, content={"error": "Invalid request."})


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/convert")
async def convert(file: UploadFile = File(...)):
    raw = await file.read()

    if len(raw) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File must be under 2 MB.")

    if raw[:8] != PNG_SIGNATURE:
        raise HTTPException(status_code=415, detail="Only PNG files are accepted.")

    try:
        img = Image.open(io.BytesIO(raw))
        width, height = img.size
        del raw
        gc.collect()

        gray = img.convert("L")
        del img
        gc.collect()

        arr = np.array(gray, dtype=np.uint8)
        del gray
        gc.collect()

        # dark pixels → foreground (what potrace traces)
        bitmap = arr < 128
        del arr
        gc.collect()

        bm = potrace.Bitmap(bitmap)
        path_obj = bm.trace()
        del bm, bitmap
        gc.collect()

        svg = _build_svg(path_obj, width, height)
        del path_obj
        gc.collect()

        logger.info("converted %dx%d png → %d bytes svg", width, height, len(svg))
        return {"svg": svg}

    except HTTPException:
        raise
    except Exception:
        gc.collect()
        logger.exception("conversion failed")
        raise HTTPException(status_code=500, detail="Conversion failed. The image may be malformed.")


def _build_svg(path, width: int, height: int) -> str:
    parts = []
    for curve in path.curves:
        s = curve.start_point
        parts.append(f"M {s[0]:.3f} {s[1]:.3f}")
        for seg in curve.segments:
            e = seg.end_point
            if seg.is_corner:
                c = seg.c
                parts.append(f"L {c[0]:.3f} {c[1]:.3f} L {e[0]:.3f} {e[1]:.3f}")
            else:
                c1, c2 = seg.c1, seg.c2
                parts.append(
                    f"C {c1[0]:.3f} {c1[1]:.3f} {c2[0]:.3f} {c2[1]:.3f} {e[0]:.3f} {e[1]:.3f}"
                )
        parts.append("Z")

    d = " ".join(parts)
    # potrace uses bottom-left origin; SVG uses top-left — flip vertically
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}">'
        f'<g transform="translate(0,{height}) scale(1,-1)">'
        f'<path d="{d}" fill="#1A1A18" fill-rule="evenodd"/>'
        f'</g>'
        f'</svg>'
    )
