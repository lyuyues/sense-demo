#!/usr/bin/env python3
"""Pre-generate the 8 reward preset PNGs into assets/rewards/.

Mirrors server.py's /api/generate-sticker pipeline (Imagen 4 -> rembg -> 300px
PNG) so presets and caregiver-typed custom items share one art style. Run once;
the PNGs are committed so presets work on GitHub Pages, where there is no server.

    python3 generate_reward_presets.py [--force] [id ...]
"""
import base64
import io
import os
import sys

from google import genai
from google.genai import types
from PIL import Image
from rembg import remove

API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not API_KEY:
    # Walk up looking for the workspace root, then down to veo_test/.env.
    # (server.py hardcodes a '../' chain that is off by one — don't copy it.)
    here = os.path.dirname(os.path.abspath(__file__))
    rel = os.path.join('Claudcode_AI_workspace', 'Research', 'SENSE', 'prototype', 'veo_test', '.env')
    env_path = None
    while True:
        cand = os.path.join(here, rel)
        if os.path.exists(cand):
            env_path = cand
            break
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent

    if env_path:
        for line in open(env_path):
            if line.startswith('GEMINI_API__KEY=') or line.startswith('GEMINI_API_KEY='):
                API_KEY = line.split('=', 1)[1].strip()

if not API_KEY:
    print("ERROR: No GEMINI_API_KEY found. Set env var or check .env file.")
    sys.exit(1)

client = genai.Client(api_key=API_KEY)

# Same style string as server.py STICKER_STYLE, minus "white background" — these
# get their background removed and composited onto the collection bar.
STICKER_STYLE = (
    "hand-drawn crayon and colored pencil illustration style, chunky wobbly crayon outlines, "
    "visible wax texture, muted warm colors, gentle and whimsical, white background, no text, "
    "charming children's coloring book illustration, single object centered"
)

# Preset subjects follow the circumscribed-interests literature (South & Ozonoff
# 2005; Turner-Brown 2011; Anthony 2013): vehicles/trains, dinosaurs and animals
# dominate, and symbolic interests (letters, numbers) are distinctively elevated
# in autism relative to NT children. Keep in sync with REWARD_PRESETS in app.js.
PRESETS = [
    ("train",     "a friendly toy steam train engine"),
    ("dinosaur",  "a cute happy cartoon dinosaur"),
    ("car",       "a cheerful little toy car"),
    ("cat",       "a cute friendly cat"),
    ("numbers",   "a colourful wooden toy number seven"),
    ("letters",   "a colourful wooden toy letter A"),
    ("space",     "a cute planet with a ring, like Saturn"),
    ("star",      "a cheerful smiling star"),
]

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets', 'rewards')


def generate(item_id, subject):
    prompt = f"{subject}, a single collectible sticker on a plain white background, {STICKER_STYLE}"
    resp = client.models.generate_images(
        model='imagen-4.0-generate-001',
        prompt=prompt,
        config=types.GenerateImagesConfig(number_of_images=1),
    )
    raw = next((img.image.image_bytes for img in resp.generated_images), None)
    if not raw:
        raise RuntimeError("no image returned")

    img = remove(Image.open(io.BytesIO(raw)))
    img.thumbnail((300, 300), Image.LANCZOS)
    out_path = os.path.join(OUT_DIR, f'{item_id}.png')
    img.save(out_path, format='PNG', optimize=True)
    return out_path, os.path.getsize(out_path)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    force = '--force' in sys.argv
    wanted = [p for p in PRESETS if not args or p[0] in args]

    os.makedirs(OUT_DIR, exist_ok=True)
    failed = []
    for item_id, subject in wanted:
        out_path = os.path.join(OUT_DIR, f'{item_id}.png')
        if os.path.exists(out_path) and not force:
            print(f"  skip {item_id} (exists; --force to regenerate)")
            continue
        print(f"generating {item_id}...", flush=True)
        try:
            path, size = generate(item_id, subject)
            print(f"  OK {os.path.basename(path)} ({size} bytes)")
        except Exception as e:
            print(f"  FAIL {item_id}: {e}")
            failed.append(item_id)

    if failed:
        print(f"\n{len(failed)} failed: {', '.join(failed)}")
        sys.exit(1)
    print("\nDone.")


if __name__ == '__main__':
    main()
