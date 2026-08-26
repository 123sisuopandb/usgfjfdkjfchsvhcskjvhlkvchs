#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_gen_icon_library.py — generate the CGT icon library.

100 flat, colorful, TRANSPARENT-background logos (no circle/box behind them),
in the same style as the Range Puzzle card icon. Layout:

  assets/svgs/module/library/<category>/<category>-<color>.svg   (10 colors each)
  assets/svgs/module/library/index.html                          (preview gallery)

10 categories x 10 theme colors = 100 icons. Re-run any time; it overwrites.
"""
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(ROOT, 'assets', 'svgs', 'module', 'library')

# (name, gradient-light, gradient-dark, accent) -- CGT theme palette
PALETTES = [
    ('orange', '#ffbf5b', '#f7931a', '#c96f08'),
    ('blue',   '#8fd0ff', '#2e97f7', '#1667c4'),
    ('purple', '#c89bf2', '#a55eea', '#7a34cf'),
    ('green',  '#6fe09a', '#27ae60', '#178048'),
    ('teal',   '#5fe6d6', '#14b8a6', '#0b8a7c'),
    ('red',    '#ff9a9a', '#ff5d5d', '#d83636'),
    ('indigo', '#8aa6ff', '#4b7bec', '#3057c9'),
    ('pink',   '#ff9ec7', '#e84393', '#bd2a71'),
    ('cyan',   '#4fe6c8', '#00b894', '#008a70'),
    ('amber',  '#ffe07a', '#ffc504', '#c99a00'),
]


def grad(c0, c1):
    return ('<linearGradient id="mg" x1="8" y1="6" x2="40" y2="42" '
            'gradientUnits="userSpaceOnUse">'
            '<stop offset="0" stop-color="%s"/>'
            '<stop offset="1" stop-color="%s"/></linearGradient>' % (c0, c1))


# ---- category glyphs (use url(#mg) for the main body, {acc} for accents) ----
def g_vuln(acc):
    return (
        '<path fill="url(#mg)" d="M24 6 L39 11 V23 C39 32.5 32.5 39 24 42.5 '
        'C15.5 39 9 32.5 9 23 V11 Z"/>'
        '<path fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" '
        'stroke-linejoin="round" d="M25 13 L20 23 L26 25 L21 35"/>')


def g_formula(acc):
    return (
        '<rect x="11" y="8" width="26" height="32" rx="4" fill="url(#mg)"/>'
        '<rect x="16" y="14" width="16" height="3" rx="1.5" fill="#fff" opacity="0.92"/>'
        '<rect x="16" y="21" width="12" height="3" rx="1.5" fill="#fff" opacity="0.75"/>'
        '<rect x="16" y="28" width="10" height="3" rx="1.5" fill="%s"/>'
        '<circle cx="30.5" cy="29.5" r="2.3" fill="#fff"/>' % acc)


def g_wifkey(acc):
    return (
        '<circle cx="24" cy="15" r="8.5" fill="url(#mg)"/>'
        '<circle cx="24" cy="15" r="3.2" fill="#fff"/>'
        '<rect x="21.6" y="22" width="4.8" height="18" rx="2.4" fill="url(#mg)"/>'
        '<rect x="26.4" y="29" width="6" height="3.4" rx="1.7" fill="url(#mg)"/>'
        '<rect x="26.4" y="35" width="4.6" height="3.2" rx="1.6" fill="url(#mg)"/>')


def g_wifkey_recover(acc):
    return (
        '<path d="M11 24 a13 13 0 1 1 4 9.2" fill="none" stroke="%s" '
        'stroke-width="3" stroke-linecap="round"/>'
        '<path d="M9.5 17 L11 25.5 L18.5 22 Z" fill="%s"/>'
        '<circle cx="24" cy="18" r="6" fill="url(#mg)"/>'
        '<circle cx="24" cy="18" r="2.4" fill="#fff"/>'
        '<rect x="22" y="23" width="4" height="12.5" rx="2" fill="url(#mg)"/>'
        '<rect x="26" y="28" width="5" height="3" rx="1.5" fill="url(#mg)"/>'
        '<rect x="26" y="32.2" width="4" height="2.8" rx="1.4" fill="url(#mg)"/>'
        % (acc, acc))


def g_pk_recover(acc):
    return (
        '<path d="M11 25 a13 13 0 1 1 4 9.2" fill="none" stroke="%s" '
        'stroke-width="3" stroke-linecap="round"/>'
        '<path d="M9.5 18 L11 26.5 L18.5 23 Z" fill="%s"/>'
        '<path d="M19 24 V20 a5 5 0 0 1 10 0 V24" fill="none" stroke="url(#mg)" '
        'stroke-width="3.2"/>'
        '<rect x="15.5" y="24" width="17" height="13.5" rx="3" fill="url(#mg)"/>'
        '<circle cx="24" cy="29.5" r="2.2" fill="#fff"/>'
        '<rect x="23" y="30.5" width="2" height="4.3" rx="1" fill="#fff"/>'
        % (acc, acc))


def g_math(acc):
    return (
        '<path d="M32 11 H15.5 L24 24 L15.5 37 H32" fill="none" stroke="url(#mg)" '
        'stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>'
        '<path d="M33 15 h6 M36 12 v6" stroke="%s" stroke-width="2.6" stroke-linecap="round"/>'
        '<path d="M33.5 31.5 l4.5 4.5 M38 31.5 l-4.5 4.5" stroke="%s" '
        'stroke-width="2.6" stroke-linecap="round"/>' % (acc, acc))


def g_brain(acc):
    return (
        '<path fill="url(#mg)" d="M20 9 C13.5 9 9.5 13 10.5 17.5 C6.5 19.5 6.5 25.5 '
        '10.5 27.5 C10 32.5 15 36 20 33.8 C22 35.8 26 35.8 28 33.8 C33 36 38 32.5 '
        '37.5 27.5 C41.5 25.5 41.5 19.5 37.5 17.5 C38.5 13 34.5 9 28 9 C26 7.2 22 7.2 20 9 Z"/>'
        '<path d="M24 10.5 V33.5" stroke="#fff" stroke-width="1.6" opacity="0.65" '
        'stroke-linecap="round"/>'
        '<path d="M18 15 q3.5 2 0.5 5 M30 15 q-3.5 2 -0.5 5 M14.5 24 q4 2.5 7 0.3 '
        'M26.5 24.3 q4 -2.2 7 0" fill="none" stroke="#fff" stroke-width="1.4" '
        'opacity="0.55" stroke-linecap="round"/>')


def g_seed(acc):
    return (
        '<path d="M24 41 V23" stroke="%s" stroke-width="3" stroke-linecap="round"/>'
        '<path fill="url(#mg)" d="M23.5 25 C23.5 16.5 17.5 12 10 12 C10 20.5 16.5 25 23.5 25 Z"/>'
        '<path fill="url(#mg)" d="M24.5 23 C24.5 15 30.5 11 38 11 C38 19 31.5 23 24.5 23 Z"/>'
        '<circle cx="24" cy="41" r="2.4" fill="%s"/>' % (acc, acc))


def g_puzzle_range(acc):
    return (
        '<path fill="url(#mg)" d="M12 11 H18 C18 5 26 5 26 11 H32 V17 C38 17 38 25 '
        '32 25 V31 H12 Z"/>'
        '<rect x="8" y="35.5" width="32" height="5" rx="2.5" fill="#d9dce1"/>'
        '<rect x="13" y="35.5" width="22" height="5" rx="2.5" fill="%s"/>'
        '<circle cx="13" cy="38" r="4" fill="#fff" stroke="url(#mg)" stroke-width="2.2"/>'
        '<circle cx="35" cy="38" r="4" fill="#fff" stroke="%s" stroke-width="2.2"/>'
        % (acc, acc))


def g_scanner(acc):
    return (
        '<rect x="9" y="9" width="15" height="15" rx="3" fill="url(#mg)" opacity="0.92"/>'
        '<rect x="12" y="12" width="4" height="4" rx="1" fill="#fff"/>'
        '<rect x="17.5" y="17.5" width="3.5" height="3.5" rx="0.8" fill="#fff" opacity="0.8"/>'
        '<circle cx="28" cy="28" r="8.5" fill="none" stroke="url(#mg)" stroke-width="3.6"/>'
        '<path d="M34 34 L41 41" stroke="%s" stroke-width="3.6" stroke-linecap="round"/>' % acc)


CATEGORIES = [
    ('vuln', g_vuln),
    ('formula', g_formula),
    ('wif-key', g_wifkey),
    ('wif-key-recover', g_wifkey_recover),
    ('private-key-recover', g_pk_recover),
    ('mathematics', g_math),
    ('brainwallet', g_brain),
    ('seed-mnemonic', g_seed),
    ('puzzle-range', g_puzzle_range),
    ('address-scanner', g_scanner),
]

SVG = ('<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">'
       '<defs>%s</defs>%s</svg>\n')

count = 0
sections = []
for cat, fn in CATEGORIES:
    d = os.path.join(BASE, cat)
    os.makedirs(d, exist_ok=True)
    cells = []
    for cname, light, dark, acc in PALETTES:
        svg = SVG % (grad(light, dark), fn(acc))
        fname = '%s-%s.svg' % (cat, cname)
        with open(os.path.join(d, fname), 'w', encoding='utf-8', newline='') as f:
            f.write(svg)
        count += 1
        cells.append(
            '<div class="cell"><img src="%s/%s" alt="%s"><div class="cap">%s</div></div>'
            % (cat, fname, fname, fname))
    sections.append('<h2>%s</h2><div class="grid">%s</div>' % (cat, ''.join(cells)))

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CGT Icon Library - 100 logos</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,'Segoe UI',Roboto,sans-serif;margin:0;background:#0f1220;color:#e8ebf5}
header{padding:20px 24px;border-bottom:1px solid #23263a}
h1{margin:0;font-size:20px}
.sub{color:#9aa0b5;font-size:13px;margin-top:4px}
.toolbar{padding:12px 24px}
button{background:#23263a;color:#e8ebf5;border:1px solid #33374f;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px}
h2{margin:26px 24px 6px;font-size:15px;color:#c8cde6}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:12px;padding:6px 24px 22px}
.cell{background:#181b2c;border:1px solid #262a40;border-radius:12px;padding:14px 8px 8px;text-align:center}
.cell img{width:56px;height:56px;display:block;margin:0 auto 8px}
.cap{font-size:10.5px;color:#8b90a8;word-break:break-all}
body.light{background:#f5f6fa;color:#1a1d29}
body.light header{border-color:#e3e5ee}
body.light .cell{background:#fff;border-color:#e6e8f0}
body.light h2{color:#333}
body.light .cap{color:#888}
</style></head><body>
<header><h1>CGT Icon Library</h1>
<div class="sub">100 logos &middot; 10 categories &times; 10 colors &middot; transparent background (no box)</div></header>
<div class="toolbar"><button onclick="document.body.classList.toggle('light')">Toggle light / dark background</button></div>
__SECTIONS__
</body></html>
"""
with open(os.path.join(BASE, 'index.html'), 'w', encoding='utf-8', newline='') as f:
    f.write(PAGE.replace('__SECTIONS__', '\n'.join(sections)))

print('Wrote %d icons into %s' % (count, BASE))
print('Preview gallery: assets/svgs/module/library/index.html')
