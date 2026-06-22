import gc
import io
import os
import logging
import subprocess
import tempfile

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

    bmp_path = None
    svg_path = None
    try:
        img = Image.open(io.BytesIO(raw))
        width, height = img.size
        del raw
        gc.collect()

        gray = img.convert("L")
        del img
        gc.collect()

        # Write grayscale BMP to a temp file — potrace requires file input
        with tempfile.NamedTemporaryFile(suffix=".bmp", delete=False) as f:
            bmp_path = f.name
            gray.save(f, format="BMP")
        del gray
        gc.collect()

        svg_path = bmp_path.replace(".bmp", ".svg")

        result = subprocess.run(
            ["potrace", "--svg", "-o", svg_path, bmp_path],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "potrace exited with an error.")

        with open(svg_path, "r", encoding="utf-8") as f:
            svg = f.read()

        logger.info("converted %dx%d png → %d bytes svg", width, height, len(svg))
        return {"svg": svg}

    except HTTPException:
        raise
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Conversion timed out.")
    except Exception:
        gc.collect()
        logger.exception("conversion failed")
        raise HTTPException(status_code=500, detail="Conversion failed. The image may be malformed.")
    finally:
        for path in (bmp_path, svg_path):
            if path and os.path.exists(path):
                try:
                    os.unlink(path)
                except OSError:
                    pass
        gc.collect()
