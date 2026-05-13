"""Fetch a public URL; plain text, capped. Not for file:// (blocked)."""

from __future__ import annotations

import re
import time
import urllib.error
import urllib.request
from html import unescape
from typing import Any

# Avoid Brotli/br: stdlib does not decompress it, which yields binary-looking UTF-8.
_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 WhiteBoardAgent/0.1"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
}

_META_CHARSET_RE = re.compile(
    r'<meta\s[^>]*charset\s*=\s*["\']?([^"\'>\s]+)',
    re.I,
)


def _charset_from_html_head(raw: bytes) -> str | None:
    if not raw:
        return None
    head = raw[:16384].decode("latin-1", errors="ignore")
    m = _META_CHARSET_RE.search(head)
    if not m:
        return None
    return (m.group(1) or "").strip().rstrip(";") or None


def _decode_body(raw: bytes, headers: Any) -> str:
    charset = None
    try:
        if headers is not None and hasattr(headers, "get_content_charset"):
            charset = headers.get_content_charset()
    except (TypeError, ValueError, AttributeError):
        charset = None
    if not charset:
        charset = _charset_from_html_head(raw)
    enc = (charset or "utf-8").strip()
    try:
        text = raw.decode(enc, errors="replace")
    except (LookupError, TypeError):
        text = raw.decode("utf-8", errors="replace")
    if text.count("\ufffd") > max(20, len(text) * 0.03):
        text = raw.decode("latin-1", errors="replace")
    return text


def _html_to_text(html: str, max_chars: int) -> str:
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_chars:
        text = text[:max_chars] + "…[truncated]"
    return text


def _extracted_text_usable(text: str) -> bool:
    """Reject binary/garbage so the model does not hallucinate from junk."""
    s = (text or "").strip()
    if len(s) < 80:
        return False
    if s.count("\ufffd") > max(10, len(s) * 0.02):
        return False
    alnum = sum(1 for c in s if c.isalnum())
    return alnum / max(len(s), 1) > 0.12


def fetch_url(url: str, max_chars: int = 4000) -> dict[str, Any]:
    u = (url or "").strip()
    if not u or not re.match(r"^https?://", u, re.I):
        return {"ok": False, "error": "only http(s) URLs allowed", "text": ""}
    t0 = time.perf_counter()
    try:
        req = urllib.request.Request(  # noqa: S310
            u,
            headers=dict(_DEFAULT_HEADERS),
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=6.0) as r:  # noqa: S310
            raw = r.read(1_200_000)
            headers = r.headers
    except urllib.error.HTTPError as e:
        return {
            "ok": False,
            "error": f"HTTP {e.code}: {e.reason}"[:500],
            "text": "",
            "elapsed_ms": (time.perf_counter() - t0) * 1000.0,
        }
    except (OSError, ValueError) as e:
        return {
            "ok": False,
            "error": str(e)[:500],
            "text": "",
            "elapsed_ms": (time.perf_counter() - t0) * 1000.0,
        }
    try:
        html = _decode_body(raw, headers)
    except (TypeError, UnicodeError, ValueError) as e:
        return {
            "ok": False,
            "error": f"decode failed: {e!s}"[:500],
            "text": "",
            "elapsed_ms": (time.perf_counter() - t0) * 1000.0,
        }
    text = _html_to_text(html, max_chars)
    if not _extracted_text_usable(text):
        return {
            "ok": False,
            "error": (
                "extracted page text too noisy or empty (encoding, anti-bot, or "
                "non-HTML); use web_search snippets only"
            ),
            "text": text[:400] if text else "",
            "elapsed_ms": (time.perf_counter() - t0) * 1000.0,
        }
    return {
        "ok": True,
        "url": u,
        "text": text,
        "elapsed_ms": (time.perf_counter() - t0) * 1000.0,
    }
