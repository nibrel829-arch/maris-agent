#!/usr/bin/env python3
"""Nibrexo-owned image engine.

This process is part of Nibrexo. It does not call OpenAI, Cloudflare,
Pollinations, Arena, Hugging Face Inference, or Black Forest's hosted API.
Generation loads weights from a local directory only.

Model: Stable Diffusion v1.5 (sd-legacy/stable-diffusion-v1-5)
License: CreativeML Open RAIL-M
  https://github.com/CompVis/stable-diffusion/blob/main/LICENSE
Commercial use is permitted with use-based restrictions. This is not Apache-2.0.
The model card says the weights are not fit for product use without a safety
review. Nibrexo does not add a paid safety API.

Hardware: about 4 GB of weights on disk and 8 GB RAM for CPU inference.
A paid GPU is not required. Vercel cannot run this process.
If weights or RAM are missing, the process reports that and writes no image.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

ENGINE = "nibrexo-image-engine"
MODEL_ID = "sd-legacy/stable-diffusion-v1-5"
LICENSE = "CreativeML Open RAIL-M"
MIN_RAM_BYTES = 8 * 1024 * 1024 * 1024
WEIGHTS_GB = 4

JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()
PIPE_LOCK = threading.Lock()
PIPE: Any = None


def ram_bytes() -> int:
    try:
        page = os.sysconf("SC_PAGE_SIZE")
        pages = os.sysconf("SC_PHYS_PAGES")
        return int(page * pages)
    except (AttributeError, ValueError, OSError):
        return 0


def weights_dir() -> str:
    return os.environ.get("NIBREXO_IMAGE_WEIGHTS_DIR", "").strip()


def weights_ready(path: str) -> bool:
    if not path or not os.path.isdir(path):
        return False
    return os.path.isfile(os.path.join(path, "model_index.json"))


def readiness() -> dict[str, Any]:
    path = weights_dir()
    missing: list[str] = []
    notes: list[str] = []
    if not weights_ready(path):
        missing.append("NIBREXO_IMAGE_WEIGHTS_DIR")
        notes.append(
            f"Set NIBREXO_IMAGE_WEIGHTS_DIR to a local diffusers folder for {MODEL_ID} "
            f"(about {WEIGHTS_GB} GB, including model_index.json). "
            "Download on a machine that can reach Hugging Face with: "
            "python3 scripts/nibrexo-image-engine.py fetch-weights. "
            "Generation never downloads weights and never calls a hosted image API."
        )
    memory = ram_bytes()
    if memory and memory < MIN_RAM_BYTES:
        missing.append("RAM")
        notes.append(
            f"This machine has {memory / (1024 ** 3):.1f} GB RAM. "
            f"CPU inference needs at least {MIN_RAM_BYTES // (1024 ** 3)} GB. "
            "A paid GPU was not added. No image will be invented to hide this."
        )
    try:
        import torch  # noqa: F401
        from diffusers import StableDiffusionPipeline  # noqa: F401
    except ImportError as error:
        missing.append("python-diffusers")
        notes.append(
            "Install the engine runtime on the worker machine only: "
            "pip install torch diffusers transformers accelerate safetensors pillow. "
            f"Import failed: {error}. Vercel cannot host these packages for inference."
        )
    can = not missing
    message = " ".join(notes) if notes else (
        f"Nibrexo image engine can load {MODEL_ID} from {path}. "
        "No external image API will be called."
    )
    return {
        "engine": ENGINE,
        "model": MODEL_ID,
        "license": LICENSE,
        "weightsReady": weights_ready(path),
        "canGenerate": can,
        "missing": missing,
        "ramBytes": memory,
        "message": message,
    }


def doctor() -> int:
    report = readiness()
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if report["canGenerate"] else 2


def fetch_weights(dest: str) -> int:
    """Explicit download. Never called by serve or generate."""
    print(
        f"Fetching {MODEL_ID} into {dest}. This uses Hugging Face to copy weights "
        "onto a machine you control. It is not an image-generation API call.",
        file=sys.stderr,
    )
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print(
            "huggingface_hub is not installed, so the weights were not downloaded. "
            "pip install huggingface_hub, then rerun this command. No image was created.",
            file=sys.stderr,
        )
        return 2
    try:
        snapshot_download(MODEL_ID, local_dir=dest)
    except Exception as error:  # noqa: BLE001 — report the real download failure
        print(
            f"Weight download failed: {error}. No image was created and no paid API was called.",
            file=sys.stderr,
        )
        return 2
    if not weights_ready(dest):
        print("Download finished but model_index.json is missing. No image was created.", file=sys.stderr)
        return 2
    print(f"Weights saved to {dest}. Set NIBREXO_IMAGE_WEIGHTS_DIR={dest}", file=sys.stderr)
    return 0


def clamp_dim(value: object, default: int = 512) -> int:
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        number = default
    rounded = int(round(number / 64.0) * 64)
    return max(256, min(768, rounded))


def clamp_steps(value: object) -> int:
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        number = 20
    return max(1, min(30, number))


def set_progress(job_id: str, stage: str, step: int, total: int, message: str) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job["progress"] = {"stage": stage, "step": step, "total": total, "message": message}
        job["updatedAt"] = time.time()


def load_pipe():
    global PIPE
    with PIPE_LOCK:
        if PIPE is not None:
            return PIPE
        import torch
        from diffusers import StableDiffusionPipeline

        path = weights_dir()
        if not weights_ready(path):
            raise RuntimeError("Weights are not a local diffusers directory. Refusing to download.")
        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        pipe = StableDiffusionPipeline.from_pretrained(path, torch_dtype=dtype, local_files_only=True, safety_checker=None)
        pipe = pipe.to("cuda" if torch.cuda.is_available() else "cpu")
        PIPE = pipe
        return pipe


def run_job(job_id: str, payload: dict[str, Any]) -> None:
    try:
        report = readiness()
        if not report["canGenerate"]:
            fail_job(job_id, report["message"], retryable=True, missing=report["missing"])
            return
        prompt = str(payload.get("prompt") or "").strip()
        if not prompt:
            fail_job(job_id, "prompt is required. No image was created.", retryable=False)
            return
        steps = clamp_steps(payload.get("steps"))
        width = clamp_dim(payload.get("width"))
        height = clamp_dim(payload.get("height"))
        negative = str(payload.get("negativePrompt") or "")
        ignored: list[str] = []
        if int(payload.get("width") or width) != width or int(payload.get("height") or height) != height:
            ignored.append("dimensions")
        set_progress(job_id, "loading_weights", 0, steps, "Loading local Stable Diffusion weights. No external API is called.")
        pipe = load_pipe()

        def callback(step_index: int, _timestep: int, _latents: object) -> None:
            current = min(steps, step_index + 1)
            set_progress(job_id, "denoising", current, steps, f"Denoising step {current} of {steps}. The file is not saved yet.")

        set_progress(job_id, "encoding_prompt", 0, steps, "Encoding the prompt on the local worker.")
        result = pipe(
            prompt=prompt[:2000],
            negative_prompt=negative[:1000] or None,
            width=width,
            height=height,
            num_inference_steps=steps,
            callback=callback,
            callback_steps=1,
        )
        image = result.images[0]
        set_progress(job_id, "writing_png", steps, steps, "Encoding PNG bytes. They are not in the Content Library yet.")
        import io

        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        png = buffer.getvalue()
        if not png.startswith(b"\x89PNG\r\n\x1a\n"):
            fail_job(job_id, "The local model did not return a PNG. Nothing was saved.", retryable=False)
            return
        with JOBS_LOCK:
            job = JOBS[job_id]
            job["status"] = "completed"
            job["bytes"] = png
            job["mimeType"] = "image/png"
            job["model"] = MODEL_ID
            job["steps"] = steps
            job["ignored"] = ignored
            job["width"] = width
            job["height"] = height
            job["progress"] = {
                "stage": "completed",
                "step": steps,
                "total": steps,
                "message": f"Local PNG is ready ({len(png)} bytes). The Manager still has to verify and store it.",
            }
    except Exception as error:  # noqa: BLE001 — the job must record the real failure
        fail_job(job_id, f"Local inference failed: {error}", retryable=True)


def fail_job(job_id: str, message: str, retryable: bool, missing: list[str] | None = None) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job["status"] = "failed"
        job["message"] = message
        job["retryable"] = retryable
        job["missing"] = missing or []
        job["progress"] = {"stage": "failed", "step": 0, "total": 0, "message": message}


def public_job(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": job["id"],
        "status": job["status"],
        "engine": ENGINE,
        "model": job.get("model", MODEL_ID),
        "progress": job.get("progress"),
        "message": job.get("message"),
        "retryable": job.get("retryable", True),
        "missing": job.get("missing", []),
        "ignored": job.get("ignored", []),
        "steps": job.get("steps"),
        "width": job.get("width"),
        "height": job.get("height"),
    }


class Handler(BaseHTTPRequestHandler):
    server_token = ""

    def do_GET(self) -> None:  # noqa: N802
        if not self.authorized():
            return
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/health":
            self.send_json(200, readiness())
            return
        if path.startswith("/v1/jobs/") and path.endswith("/image"):
            job_id = path.split("/")[3]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                png = job.get("bytes") if job else None
                status = job.get("status") if job else None
            if status != "completed" or not isinstance(png, bytes):
                self.send_json(404, {"status": "error", "message": "No completed image for that job. Nothing was invented."})
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(png)))
            self.end_headers()
            self.wfile.write(png)
            return
        if path.startswith("/v1/jobs/"):
            job_id = path.split("/")[3]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
            if not job:
                self.send_json(404, {"status": "error", "message": "Unknown job. No image was created."})
                return
            self.send_json(200, public_job(job))
            return
        self.send_json(404, {"status": "error", "message": "Unknown engine route."})

    def do_POST(self) -> None:  # noqa: N802
        if not self.authorized():
            return
        path = urlparse(self.path).path.rstrip("/")
        if path != "/v1/jobs":
            self.send_json(404, {"status": "error", "message": "Use POST /v1/jobs."})
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > 100_000:
            self.send_json(400, {"status": "error", "message": "Invalid body. No image was created."})
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            self.send_json(400, {"status": "error", "message": "Body was not JSON. No image was created."})
            return
        report = readiness()
        if not report["canGenerate"]:
            self.send_json(409, {
                "status": "needs_configuration",
                "missing": report["missing"],
                "message": report["message"],
                "engine": ENGINE,
            })
            return
        job_id = uuid.uuid4().hex
        job = {
            "id": job_id,
            "status": "queued",
            "progress": {"stage": "queued", "step": 0, "total": clamp_steps(payload.get("steps")), "message": "Queued on the Nibrexo image engine."},
            "model": MODEL_ID,
        }
        with JOBS_LOCK:
            JOBS[job_id] = job
        threading.Thread(target=run_job, args=(job_id, payload), daemon=True).start()
        self.send_json(202, public_job(job))

    def authorized(self) -> bool:
        expected = self.server_token
        if not expected:
            return True
        header = self.headers.get("Authorization", "")
        if header == f"Bearer {expected}":
            return True
        self.send_json(401, {"status": "error", "message": "Image engine token rejected. No image was created."})
        return False

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[nibrexo-image-engine] {self.address_string()} {fmt % args}", file=sys.stderr)


def serve(host: str, port: int, token: str) -> int:
    if host not in {"127.0.0.1", "localhost", "::1"} and not token:
        print(
            "Refusing to bind a non-loopback address without NIBREXO_IMAGE_ENGINE_TOKEN. "
            "Generate one locally; do not use a vendor API key.",
            file=sys.stderr,
        )
        return 2
    Handler.server_token = token
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"{ENGINE} on http://{host}:{port} model={MODEL_ID}. No external image API will be called.", file=sys.stderr)
    server.serve_forever()
    return 0


def generate_once(prompt: str, out_path: str) -> int:
    report = readiness()
    if not report["canGenerate"]:
        json.dump({"canGenerate": False, "wroteFile": False, "message": report["message"], "missing": report["missing"]}, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 2
    job_id = uuid.uuid4().hex
    with JOBS_LOCK:
        JOBS[job_id] = {"id": job_id, "status": "queued", "progress": {"stage": "queued", "step": 0, "total": 4, "message": "starting"}}
    run_job(job_id, {"prompt": prompt, "steps": 4, "width": 512, "height": 512})
    with JOBS_LOCK:
        job = JOBS[job_id]
    if job.get("status") != "completed" or not isinstance(job.get("bytes"), bytes):
        print(job.get("message") or "Generation failed. No file written.", file=sys.stderr)
        return 2
    with open(out_path, "wb") as handle:
        handle.write(job["bytes"])
    print(out_path)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Nibrexo local image engine")
    parser.add_argument("command", choices=["doctor", "serve", "fetch-weights", "generate"])
    parser.add_argument("--host", default=os.environ.get("NIBREXO_IMAGE_ENGINE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("NIBREXO_IMAGE_ENGINE_PORT", "8788")))
    parser.add_argument("--dest", default=os.environ.get("NIBREXO_IMAGE_WEIGHTS_DIR", ".nibrexo-image/weights"))
    parser.add_argument("--prompt", default="")
    parser.add_argument("--out", default="")
    args = parser.parse_args()
    if args.command == "doctor":
        return doctor()
    if args.command == "fetch-weights":
        return fetch_weights(args.dest)
    if args.command == "generate":
        if not args.prompt or not args.out:
            print("generate requires --prompt and --out. No file written.", file=sys.stderr)
            return 2
        return generate_once(args.prompt, args.out)
    token = os.environ.get("NIBREXO_IMAGE_ENGINE_TOKEN", "").strip()
    return serve(args.host, args.port, token)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
