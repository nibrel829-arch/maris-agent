#!/usr/bin/env python3
"""Local free image server for Nibrexo image.generate.

Superseded by scripts/nibrexo-image-engine.py. The Manager does not call this
process. It does not call OpenAI, Pollinations, Cloudflare, or any other hosted API.

Recommended model: black-forest-labs/FLUX.1-schnell
License: Apache-2.0 (commercial use permitted).
Hardware: about 12 GB VRAM for comfortable inference, or a slow CPU run.
Vercel and this Next.js process cannot host the 12B model.

Point NIBREXO_LOCAL_IMAGE_URL at this server, for example:
  NIBREXO_LOCAL_IMAGE_URL=http://127.0.0.1:8788/generate

Set FLUX_MODEL_DIR to a local directory that already contains the weights.
"""

from __future__ import annotations

import base64
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def main() -> None:
    model_dir = os.environ.get("FLUX_MODEL_DIR", "").strip()
    if not model_dir or not os.path.isdir(model_dir):
        raise SystemExit(
            "FLUX_MODEL_DIR is not a local directory. Download FLUX.1-schnell "
            "yourself from the Apache-2.0 Hugging Face repo and set FLUX_MODEL_DIR. "
            "This script will not download weights or call a paid API."
        )
    try:
        import torch
        from diffusers import FluxPipeline
    except ImportError as error:
        raise SystemExit(
            "Install torch and diffusers in this environment before starting the server. "
            f"Import failed: {error}"
        ) from error

    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    pipe = FluxPipeline.from_pretrained(model_dir, torch_dtype=dtype, local_files_only=True)
    if torch.cuda.is_available():
        pipe = pipe.to("cuda")

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            if self.path.rstrip("/") not in {"/generate", ""}:
                self.send_error(404, "Use POST /generate")
                return
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 100_000:
                self.send_error(400, "Invalid body")
                return
            payload = json.loads(self.rfile.read(length))
            prompt = str(payload.get("prompt") or "").strip()
            if not prompt:
                self.send_error(400, "prompt is required")
                return
            steps = max(1, min(4, int(payload.get("steps") or 4)))
            width = max(256, min(1024, int(payload.get("width") or 1024)))
            height = max(256, min(1024, int(payload.get("height") or 1024)))
            image = pipe(
                prompt,
                num_inference_steps=steps,
                width=width,
                height=height,
                guidance_scale=0.0,
            ).images[0]
            import io

            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
            body = json.dumps({"image": encoded, "mime_type": "image/png"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt: str, *args: object) -> None:
            print(f"[local-flux] {self.address_string()} {fmt % args}")

    host = os.environ.get("NIBREXO_LOCAL_IMAGE_HOST", "127.0.0.1")
    port = int(os.environ.get("NIBREXO_LOCAL_IMAGE_PORT", "8788"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Local FLUX server on http://{host}:{port}/generate — no paid API will be called.")
    server.serve_forever()


if __name__ == "__main__":
    main()
