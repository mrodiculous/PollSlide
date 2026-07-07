#!/usr/bin/env python3
# PollSlide deck converter — PowerPoint (.pptx/.ppt) / Keynote (.key) → PDF.
#
# Runs on Rod's Mac as the PRIMARY converter (native apps = pixel-perfect):
#   .key         → Keynote.app via AppleScript
#   .pptx / .ppt → Microsoft PowerPoint.app via AppleScript (falls back to
#                  LibreOffice `soffice` if PowerPoint isn't installed)
# The same file also runs inside the Docker image (see Dockerfile) as the CLOUD
# FALLBACK, where only LibreOffice is available.
#
# CONTRACT (must match api/convert-deck.js):
#   In : POST (any path) raw bytes
#        headers: x-filename: <url-encoded original name>, x-target: pdf,
#                 Authorization: Bearer <CONVERT_KEY>   (only if CONVERT_KEY set)
#   Out: 200 application/pdf | plain-text error with 4xx/5xx
#   GET /health → 200 "ok"   (for uptime checks)
#
# ENV: PORT (default 8790) · CONVERT_KEY (optional shared secret)
#
# Stdlib only — no pip installs needed. Start with:  python3 server.py

import http.server
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.parse

PORT = int(os.environ.get("PORT", "8790"))
KEY = os.environ.get("CONVERT_KEY", "")
MAX_BYTES = 60 * 1024 * 1024
CONVERT_TIMEOUT_S = 120
ALLOWED_EXTS = (".pptx", ".ppt", ".key", ".odp")

IS_MAC = sys.platform == "darwin"
HAS_KEYNOTE = IS_MAC and os.path.isdir("/Applications/Keynote.app")
HAS_POWERPOINT = IS_MAC and os.path.isdir("/Applications/Microsoft PowerPoint.app")
SOFFICE = (
    shutil.which("soffice")
    or ("/Applications/LibreOffice.app/Contents/MacOS/soffice" if IS_MAC else "/usr/bin/soffice")
)

# Native-app automation (and soffice with a shared profile) must not run two
# conversions at once — serialize every conversion.
_convert_lock = threading.Lock()


def _osascript(script):
    subprocess.run(["osascript", "-e", script], check=True, capture_output=True,
                   timeout=CONVERT_TIMEOUT_S)


def keynote_to_pdf(src, out_pdf):
    _osascript(f'''
        tell application "Keynote"
            set theDoc to open POSIX file "{src}"
            export theDoc to POSIX file "{out_pdf}" as PDF
            close theDoc saving no
        end tell''')


def powerpoint_to_pdf(src, out_pdf):
    _osascript(f'''
        tell application "Microsoft PowerPoint"
            open POSIX file "{src}"
            set thePres to active presentation
            save thePres in POSIX file "{out_pdf}" as save as PDF
            close thePres saving no
        end tell''')


def soffice_to_pdf(src, tmp):
    if not os.path.exists(SOFFICE):
        raise RuntimeError("no converter available for this file type "
                           "(PowerPoint/Keynote app not found and LibreOffice not installed)")
    # Unique LibreOffice profile per call — parallel/stale profiles otherwise
    # make soffice exit silently without converting.
    subprocess.run(
        [SOFFICE, "--headless", "--norestore",
         f"-env:UserInstallation=file://{tmp}/loprofile",
         "--convert-to", "pdf", "--outdir", tmp, src],
        check=True, capture_output=True, timeout=CONVERT_TIMEOUT_S)


def convert(src, ext, tmp):
    out_pdf = os.path.join(tmp, "deck.pdf")
    if ext == ".key" and HAS_KEYNOTE:
        keynote_to_pdf(src, out_pdf)
    elif ext in (".pptx", ".ppt") and HAS_POWERPOINT:
        powerpoint_to_pdf(src, out_pdf)
    else:
        soffice_to_pdf(src, tmp)  # writes <srcname>.pdf into tmp
        produced = os.path.splitext(src)[0] + ".pdf"
        if os.path.exists(produced) and produced != out_pdf:
            os.rename(produced, out_pdf)
    if not os.path.exists(out_pdf) or os.path.getsize(out_pdf) == 0:
        raise RuntimeError("conversion produced no PDF")
    return out_pdf


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, b"ok", "text/plain")
        self._send(404, b"not found", "text/plain")

    def do_POST(self):
        if KEY and self.headers.get("Authorization") != "Bearer " + KEY:
            return self._send(401, b"unauthorized", "text/plain")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self._send(400, b"empty upload", "text/plain")
        if length > MAX_BYTES:
            return self._send(413, b"file too large", "text/plain")
        raw = self.rfile.read(length)

        name = urllib.parse.unquote(self.headers.get("x-filename", "deck.pptx"))
        ext = os.path.splitext(name)[1].lower() or ".pptx"
        if ext not in ALLOWED_EXTS:
            return self._send(415, f"unsupported file type {ext}".encode(), "text/plain")

        tmp = tempfile.mkdtemp(prefix="psconv-")
        try:
            src = os.path.join(tmp, "deck" + ext)
            with open(src, "wb") as f:
                f.write(raw)
            with _convert_lock:
                out_pdf = convert(src, ext, tmp)
            with open(out_pdf, "rb") as f:
                pdf = f.read()
            self._send(200, pdf, "application/pdf")
            self.log_message("converted %s (%d KB -> %d KB)", name, length // 1024, len(pdf) // 1024)
        except subprocess.TimeoutExpired:
            self._send(504, b"conversion timed out", "text/plain")
        except subprocess.CalledProcessError as e:
            detail = (e.stderr or b"")[:300]
            self._send(500, b"converter failed: " + detail, "text/plain")
        except Exception as e:
            self._send(500, str(e).encode()[:300], "text/plain")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    modes = []
    if HAS_KEYNOTE:
        modes.append(".key via Keynote.app")
    if HAS_POWERPOINT:
        modes.append(".pptx/.ppt via PowerPoint.app")
    if os.path.exists(SOFFICE):
        modes.append("LibreOffice fallback")
    print(f"PollSlide converter on :{PORT} — {', '.join(modes) or 'NO CONVERTERS FOUND'}"
          + (" — auth required" if KEY else " — no auth (set CONVERT_KEY!)"))
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
