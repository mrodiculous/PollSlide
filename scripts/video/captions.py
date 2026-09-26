#!/usr/bin/env python3
"""Captions for a recorded video, in every site language.

  python3 scripts/video/captions.py getting-started

Reads out/<id>.cues.json (timing = when each narration line is spoken) and
<id>.captions.json (the translations), and writes out/<id>.<lang>.vtt. Each narration
line is split into sentences and its time shared out by length, so a caption never
fills half the picture.
"""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
vid = sys.argv[1] if len(sys.argv) > 1 else 'getting-started'
cues = json.load(open(os.path.join(HERE, 'out', vid + '.cues.json')))
tr = json.load(open(os.path.join(HERE, vid + '.captions.json')))['cues']
assert len(tr) == len(cues), f'{len(cues)} narration lines but {len(tr)} translations — update {vid}.captions.json'

def ts(s):
    h, m = int(s // 3600), int(s // 60) % 60
    return f'{h:02d}:{m:02d}:{s % 60:06.3f}'

def split(text):
    parts = re.split(r'(?<=[.!?¡¿])\s+(?=[A-ZÀ-ÖØ-Þ¡¿«„"])', text.strip())
    out = []
    for p in parts:                       # merge very short bits into the previous caption
        if out and len(p) < 18: out[-1] += ' ' + p
        else: out.append(p)
    return out

for lang in ['en', 'es', 'de', 'fr', 'pt', 'it']:
    lines, n = ['WEBVTT', ''], 0
    for c, t in zip(cues, tr):
        text = t.get(lang) or (c['text'] if lang == 'en' else None)
        if not text: raise SystemExit(f'missing {lang} caption for: {c["text"][:50]}')
        bits = split(text); total = sum(len(b) for b in bits); at = c['from']
        for b in bits:
            dur = (c['to'] - c['from']) * len(b) / total
            n += 1; lines += [str(n), f'{ts(at)} --> {ts(at + dur)}', b, '']; at += dur
    open(os.path.join(HERE, 'out', f'{vid}.{lang}.vtt'), 'w').write('\n'.join(lines))
print('captions: en es de fr pt it')
