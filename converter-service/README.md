# PollSlide Deck Converter — local-first, cloud fallback

Converts uploaded PowerPoint (`.pptx`/`.ppt`) and Keynote (`.key`) decks to PDF so
"Present from PollSlide" can render every slide pixel-faithfully (pdf.js).

**Why local-first:** this Mac already has the two apps that render these formats
*perfectly* — Keynote and Microsoft PowerPoint. `server.py` drives them via
AppleScript, so conversion quality is identical to opening the deck in the real app.
No LibreOffice needed locally, no per-file fees, files never leave your machine.
The cloud fallback (same `server.py` in Docker + LibreOffice) only kicks in when
your Mac is off or unreachable.

```
User uploads deck → app.pollslide.com/api/convert-deck (Vercel)
                        │ 1st: CONVERT_API_URL       → this Mac (tunnel) → Keynote/PowerPoint → PDF
                        │ 2nd: CONVERT_FALLBACK_URL  → Fly/Railway container → LibreOffice → PDF
                        └ neither set/working        → user sees "export to PDF" guidance (no crash)
```

---

## Step 1 — Run it (2 min)

```bash
cd ~/Documents/GitHub/PollSlide/converter-service
CONVERT_KEY=pick-a-long-random-secret python3 server.py
```

You should see: `PollSlide converter on :8790 — .key via Keynote.app, .pptx/.ppt via PowerPoint.app — auth required`

## Step 2 — Test it (1 min)

In a second terminal, with any .pptx you have:

```bash
curl -sS -X POST http://localhost:8790 \
  -H "Authorization: Bearer pick-a-long-random-secret" \
  -H "x-filename: test.pptx" \
  --data-binary @/path/to/any/deck.pptx \
  -o /tmp/test.pdf && open /tmp/test.pdf
```

⚠️ **First run only:** macOS will pop up "Terminal wants to control Keynote /
Microsoft PowerPoint" — click **OK** (System Settings → Privacy & Security →
Automation if you miss it). PowerPoint may also open visibly the first time; that's
normal.

## Step 3 — Expose it to Vercel with a quick tunnel (2 min)

cloudflared is already installed. For a quick test URL:

```bash
cloudflared tunnel --url http://localhost:8790
```

It prints a URL like `https://random-words.trycloudflare.com`. Then on Vercel
(pollslide app → Settings → Environment Variables):

- `CONVERT_API_URL` = that URL
- `CONVERT_API_KEY` = the same secret you used for `CONVERT_KEY`

Redeploy, then try importing a .pptx in the PollSlide presenter — slides should come
back pixel-perfect.

## Step 4 — Make the tunnel permanent (10 min, one time)

Quick-tunnel URLs change every restart. For a stable hostname:

```bash
cloudflared tunnel login                 # opens browser; pick the pollslide.com zone
cloudflared tunnel create pollslide-convert
cloudflared tunnel route dns pollslide-convert convert.pollslide.com
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: pollslide-convert
credentials-file: /Users/Rod/.cloudflared/<TUNNEL-ID>.json   # printed by `tunnel create`
ingress:
  - hostname: convert.pollslide.com
    service: http://localhost:8790
  - service: http_status:404
```

Install it as a service so it survives reboots:

```bash
sudo cloudflared service install
```

Update Vercel: `CONVERT_API_URL=https://convert.pollslide.com`.

## Step 5 — Keep the converter itself always running

```bash
# Edit the plist first: replace CHANGE-ME with your CONVERT_KEY secret.
cp com.pollslide.converter.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.pollslide.converter.plist
curl http://localhost:8790/health     # → ok
```

Logs: `tail -f /tmp/pollslide-converter.log`. Note: the Mac must be awake —
System Settings → Energy → "Prevent automatic sleeping when the display is off"
(or `sudo pmset -a sleep 0` / caffeinate), same as the Ollama setup.

## Step 6 — Cloud fallback for when the Mac is off (optional, ~15 min)

The included Dockerfile runs the *same* server with LibreOffice instead of the
native apps (slightly lower fidelity — good enough as a backup). On Fly.io:

```bash
brew install flyctl
cd ~/Documents/GitHub/PollSlide/converter-service
fly launch --name pollslide-convert --no-deploy   # accept defaults
fly secrets set CONVERT_KEY=another-long-random-secret
fly deploy
```

Then on Vercel:

- `CONVERT_FALLBACK_URL` = `https://pollslide-convert.fly.dev`
- `CONVERT_FALLBACK_KEY` = that second secret

`api/convert-deck.js` tries your Mac first (25s budget), then the container,
then falls back to the "export to PDF" guidance — the user never sees a crash.

---

## Contract (what api/convert-deck.js sends)

- `POST` raw file bytes, headers `x-filename` (url-encoded), `x-target: pdf`,
  `Authorization: Bearer <key>` if a key is configured.
- Response: `200` with `application/pdf`, or a plain-text error (4xx/5xx).
- `GET /health` → `ok` (wire this to UptimeRobot etc. if you want alerts).
