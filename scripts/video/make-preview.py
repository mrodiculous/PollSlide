#!/usr/bin/env python3
"""Poster + animated email preview from a recorded manifest.

  python3 scripts/video/make-preview.py <manifest.json> <out-prefix>

Writes <prefix>-poster.jpg (1280x720, for the web player) and <prefix>-email.gif
(560x315, loops a few highlights with a play button). Email clients can't play video,
but nearly all of them animate a GIF; Outlook on Windows shows only the first frame, so
the first frame is the title card with the play button — a complete picture on its own.
"""
import json, sys, bisect
from PIL import Image, ImageDraw, ImageFont

man = json.load(open(sys.argv[1])); prefix = sys.argv[2]
frames = man['frames']; times = [f['t'] for f in frames]
scene = {s['id']: s['t'] for s in man.get('scenes', [])}

def at(t):
    i = max(0, bisect.bisect_right(times, t) - 1)
    return Image.open(frames[i]['f']).convert('RGB')

def font(size, bold=True):
    for p in ['/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf']:
        try: return ImageFont.truetype(p, size)
        except Exception: pass
    return ImageFont.load_default()

def play_button(img, r, where='center'):
    d = ImageDraw.Draw(img, 'RGBA'); w, h = img.size
    cx, cy = (w // 2, h // 2) if where == 'center' else (w - r - 16, h - h // 7 - r - 12)
    d.ellipse([cx - r - 5, cy - r - 5, cx + r + 5, cy + r + 5], fill=(0, 0, 0, 80))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(108, 99, 255, 240))
    k = r * 0.42
    d.polygon([(cx - k * 0.75, cy - k), (cx - k * 0.75, cy + k), (cx + k * 1.05, cy)], fill=(255, 255, 255, 255))
    return img

def banner(img, text):
    d = ImageDraw.Draw(img, 'RGBA'); w, h = img.size; f = font(max(14, h // 17))
    bh = h // 7
    d.rectangle([0, h - bh, w, h], fill=(10, 10, 20, 215))
    tw = d.textlength(text, font=f)
    d.text(((w - tw) / 2, h - bh + (bh - f.size) / 2 - 2), text, font=f, fill=(255, 255, 255, 255))
    return img

# Poster: the title card, with a play button.
title_t = scene.get('intro', 0) + 2.5
poster = at(title_t).resize((1280, 720), Image.LANCZOS)
play_button(poster, 70).save(prefix + '-poster.jpg', quality=88)

# Email GIF: title card first (Outlook's still), then highlights zoomed in so the app is
# readable at email width. Crops are in 1920x1080 stage pixels, 16:9.
W, H, FPS = 560, 315, 6
FULL = (0, 0, 1920, 1080)
plan = [('intro', 2.5, 1.2, 1.0, FULL)]   # (scene, offset, seconds, speed, crop)
# Each scene script may list its own highlights (module.exports.preview); these are the
# getting-started ones, kept as the default.
DEFAULT = [['gifs', 4.0, 3.0, 1.6, [330, 170, 1590, 879]], ['polly', 9.0, 2.5, 1.5, [330, 0, 1590, 709]],
           ['gifs-all', 7.0, 2.0, 1.5, [330, 120, 1590, 829]], ['present', 13.0, 4.0, 1.4, list(FULL)]]
for sid, off, secs, speed, crop in (man.get('preview') or DEFAULT):
    if sid in scene: plan.append((sid, off, secs, speed, tuple(crop)))
out = []
for sid, off, secs, speed, crop in plan:
    base = scene.get(sid, 0) + off
    for k in range(max(1, int(secs * FPS))):
        img = at(base + k * speed / FPS).crop(crop).resize((W, H), Image.LANCZOS)
        img = play_button(img, 24, 'corner') if sid != 'intro' else play_button(img, 30, 'corner')
        img = banner(img, man.get('previewLabel') or 'Watch: your first quiz in 2 minutes')
        out.append(img)
# Hold the title card a moment so Outlook's single frame and the loop start both read well.
pal = [im.quantize(colors=72, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG) for im in out]
durs = [1200] + [int(1000 / FPS)] * (len(pal) - 1)
pal[0].save(prefix + '-email.gif', save_all=True, append_images=pal[1:], duration=durs, loop=0, optimize=True, disposal=1)
import os
print('poster', os.path.getsize(prefix + '-poster.jpg') // 1024, 'KB · email gif', os.path.getsize(prefix + '-email.gif') // 1024, 'KB,', len(pal), 'frames')
