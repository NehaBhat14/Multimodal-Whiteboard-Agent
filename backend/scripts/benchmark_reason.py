"""Benchmark harness for POST /api/v1/reason.

Hits the reasoning endpoint N times with a fixed payload and reports p50/p95/mean
for each stage (server-side `timings`, wall-clock client latency, and per-request
bytes). Intended for both `mock` and `openai` providers — the mock run isolates
FastAPI + network overhead, the openai run includes the model call.

Usage:
  # From the backend directory with the dev server running on localhost:8000
  python scripts/benchmark_reason.py --trials 30
  python scripts/benchmark_reason.py --trials 20 --image sample.png
  python scripts/benchmark_reason.py --url http://127.0.0.1:8000 --trials 50 --out results.json

No third-party deps; stdlib only.
"""

from __future__ import annotations

import argparse
import base64
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any
from urllib import error, request

DEFAULT_URL = "http://127.0.0.1:8000"
DEFAULT_ENDPOINT = "/api/v1/reason"
DEFAULT_QUERY = (
    "Return EXACTLY one JSON object with keys my_response and what_i_see."
)
DEFAULT_SPATIAL = {"x": 0.0, "y": 0.0, "width": 320.0, "height": 180.0}


# 1x1 transparent PNG — valid image data so OpenAI accepts the request when
# no --image is supplied. For latency benchmarks only; content is noise.
_DEFAULT_1X1_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
    "nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg=="
)


def _load_image_base64(image_path: Path | None) -> str:
    if image_path is None:
        return _DEFAULT_1X1_PNG_B64
    raw = image_path.read_bytes()
    return base64.b64encode(raw).decode("ascii")


def _post_once(url: str, body: dict[str, Any], timeout: float) -> tuple[dict[str, Any], float, int]:
    """POST once. Returns (decoded_json, wall_ms, response_bytes)."""
    encoded = json.dumps(body).encode("utf-8")
    req = request.Request(
        url,
        data=encoded,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    start = time.perf_counter()
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Network error: {exc.reason}") from exc
    wall_ms = (time.perf_counter() - start) * 1000.0
    decoded = json.loads(raw.decode("utf-8"))
    return decoded, wall_ms, len(raw)


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return float("nan")
    s = sorted(values)
    k = (len(s) - 1) * (pct / 100.0)
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    frac = k - lo
    return s[lo] + (s[hi] - s[lo]) * frac


def _summarize(label: str, values: list[float], unit: str = "ms") -> dict[str, Any]:
    if not values:
        return {"metric": label, "n": 0}
    return {
        "metric": label,
        "unit": unit,
        "n": len(values),
        "mean": round(statistics.fmean(values), 3),
        "stdev": round(statistics.pstdev(values), 3) if len(values) > 1 else 0.0,
        "min": round(min(values), 3),
        "p50": round(_percentile(values, 50), 3),
        "p95": round(_percentile(values, 95), 3),
        "p99": round(_percentile(values, 99), 3),
        "max": round(max(values), 3),
    }


def run(args: argparse.Namespace) -> int:
    url = args.url.rstrip("/") + DEFAULT_ENDPOINT
    image_path = Path(args.image).resolve() if args.image else None
    image_b64 = _load_image_base64(image_path)

    payload = {
        "imageBase64": image_b64,
        "spatial": DEFAULT_SPATIAL,
        "queryText": args.query,
    }

    request_bytes = len(json.dumps(payload).encode("utf-8"))

    print(
        f"Benchmarking {url} — {args.trials} trials "
        f"(warmup={args.warmup}, image={'provided' if image_path else 'default placeholder'}, "
        f"request_bytes={request_bytes})",
        flush=True,
    )

    # Warmup (not recorded)
    for _ in range(args.warmup):
        try:
            _post_once(url, payload, timeout=args.timeout)
        except RuntimeError as exc:
            print(f"warmup error: {exc}", file=sys.stderr)
            return 2

    wall_ms_vals: list[float] = []
    server_total_vals: list[float] = []
    inference_vals: list[float] = []
    parse_vals: list[float] = []
    overhead_vals: list[float] = []
    response_bytes_vals: list[float] = []
    providers: set[str] = set()
    errors = 0

    for i in range(args.trials):
        try:
            response, wall_ms, resp_bytes = _post_once(url, payload, timeout=args.timeout)
        except RuntimeError as exc:
            errors += 1
            print(f"trial {i+1}: error: {exc}", file=sys.stderr)
            continue

        timings = response.get("timings") or {}
        provider = str(timings.get("provider", "?"))
        providers.add(provider)
        server_total = float(timings.get("total_ms") or 0.0)
        inference = float(timings.get("inference_ms") or 0.0)
        parse = float(timings.get("parse_ms") or 0.0)

        overhead = max(0.0, wall_ms - server_total)

        wall_ms_vals.append(wall_ms)
        server_total_vals.append(server_total)
        inference_vals.append(inference)
        parse_vals.append(parse)
        overhead_vals.append(overhead)
        response_bytes_vals.append(float(resp_bytes))

        if args.verbose:
            print(
                f"trial {i+1:>3}: wall={wall_ms:7.1f}ms "
                f"server_total={server_total:7.1f}ms "
                f"inference={inference:7.1f}ms "
                f"parse={parse:6.2f}ms "
                f"overhead={overhead:6.1f}ms",
                flush=True,
            )

    summary = {
        "url": url,
        "trials_requested": args.trials,
        "trials_ok": len(wall_ms_vals),
        "trials_failed": errors,
        "providers_observed": sorted(providers),
        "request_bytes": request_bytes,
        "metrics": [
            _summarize("client_wall_ms", wall_ms_vals),
            _summarize("server_total_ms", server_total_vals),
            _summarize("server_inference_ms", inference_vals),
            _summarize("server_parse_ms", parse_vals),
            _summarize("network_plus_fastapi_overhead_ms", overhead_vals),
            _summarize("response_bytes", response_bytes_vals, unit="bytes"),
        ],
    }

    pretty = json.dumps(summary, indent=2)
    print("\n=== Benchmark summary ===")
    print(pretty)

    if args.out:
        Path(args.out).write_text(pretty, encoding="utf-8")
        print(f"\nWrote {args.out}")

    return 0 if errors == 0 else 1


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", default=DEFAULT_URL, help=f"Backend base URL (default: {DEFAULT_URL})")
    p.add_argument("--trials", type=int, default=20, help="Number of recorded trials (default: 20)")
    p.add_argument("--warmup", type=int, default=2, help="Warmup requests (not recorded, default: 2)")
    p.add_argument("--timeout", type=float, default=120.0, help="Per-request timeout (seconds)")
    p.add_argument("--image", default=None, help="Optional path to a PNG image to include")
    p.add_argument("--query", default=DEFAULT_QUERY, help="queryText to send")
    p.add_argument("--out", default=None, help="Optional path to write the JSON summary")
    p.add_argument("--verbose", action="store_true", help="Print per-trial results")
    return p


if __name__ == "__main__":
    parser = _build_parser()
    sys.exit(run(parser.parse_args()))