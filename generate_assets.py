#!/usr/bin/env python3
"""Generate sticker assets using Google Gemini image generation API."""

import os
import time
from google import genai
from google.genai import types

API_KEY = os.environ.get("GEMINI_API_KEY", "")
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")

STYLE = "watercolor and ink illustration style, soft watercolor washes with thin ink outlines, warm muted tones, gentle and whimsical, white background, no text, charming children's book illustration, single object centered"

STICKERS = [
    ("avatar.png", f"A cute round smiling star character with tiny arms and legs, {STYLE}"),
    ("friend1.png", f"A small cheerful boy with brown hair wearing a blue shirt, round head big eyes, standing, {STYLE}"),
    ("friend2.png", f"A small cheerful girl with pigtails wearing a pink dress, round head big eyes, standing, {STYLE}"),
    ("friend3.png", f"A small cheerful child with curly hair wearing a green hoodie, round head big eyes, standing, {STYLE}"),
    ("speaker.png", f"A cute vintage boombox radio with musical notes floating out, {STYLE}"),
    ("microphone.png", f"A cute round microphone on a small stand, {STYLE}"),
    ("bell.png", f"A cute hand bell with a wooden handle, {STYLE}"),
    ("balloon.png", f"A single round red balloon with a curly string, {STYLE}"),
    ("cake.png", f"A cute birthday cake with three lit candles and frosting, {STYLE}"),
    ("present.png", f"A wrapped gift box with a big ribbon bow on top, {STYLE}"),
    ("lights.png", f"A string of colorful round party lights on a wire, horizontal, {STYLE}"),
    ("slide.png", f"A playground slide with a ladder, {STYLE}"),
    ("swing.png", f"A swing set with one wooden seat, {STYLE}"),
    ("ball.png", f"A colorful round beach ball with stripes, {STYLE}"),
    ("dog.png", f"A cute small puppy dog sitting with floppy ears and wagging tail, {STYLE}"),
    ("bench.png", f"A simple wooden park bench, {STYLE}"),
    ("tree.png", f"A round leafy tree with a brown trunk, {STYLE}"),
    ("drum.png", f"A cute drum with two crossed drumsticks on top, {STYLE}"),
]

client = genai.Client(api_key=API_KEY)

def generate_with_imagen(filename, prompt, output_path):
    response = client.models.generate_images(
        model='imagen-4.0-generate-001',
        prompt=prompt,
        config=types.GenerateImagesConfig(number_of_images=1),
    )
    for image in response.generated_images:
        image.image.save(output_path)
        return True
    return False

def generate_with_gemini(filename, prompt, output_path):
    response = client.models.generate_content(
        model="gemini-2.5-flash-image",
        contents=prompt,
        config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
    )
    if response.candidates and response.candidates[0].content.parts:
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                with open(output_path, 'wb') as f:
                    f.write(part.inline_data.data)
                return True
    return False

LINEART_PROMPT = """Look at this image. Create a "coloring book" version of the EXACT same character/object:
- Keep the EXACT same pose, proportions, and outline
- Keep small details colored: face/skin, hair, eyes, shoes, small accessories
- Make large clothing areas and big color blocks WHITE (empty, ready to be colored in)
- Keep all outlines and line work visible
- Keep the same art style (crayon/watercolor look)
- The background MUST be pure white (#FFFFFF), NOT black, NOT gray, NOT any other color
- Do NOT add any background color at all — just the character/object on a clean white background
Think of it like a children's coloring page where the big areas are left white for kids to color in, but the face and hair are already colored."""


def remove_white_background(image_path):
    """Post-process: flood-fill from edges to remove background, keep interior white."""
    from PIL import Image
    import numpy as np
    from collections import deque

    img = Image.open(image_path).convert('RGBA')
    data = np.array(img)
    h, w = data.shape[:2]

    r, g, b = data[:,:,0], data[:,:,1], data[:,:,2]
    # Pixels that look like background (white or black)
    is_bg_color = ((r > 230) & (g > 230) & (b > 230)) | ((r < 25) & (g < 25) & (b < 25))

    # Flood fill from all edge pixels
    visited = np.zeros((h, w), dtype=bool)
    queue = deque()

    # Seed from all 4 edges
    for x in range(w):
        if is_bg_color[0, x]: queue.append((0, x))
        if is_bg_color[h-1, x]: queue.append((h-1, x))
    for y in range(h):
        if is_bg_color[y, 0]: queue.append((y, 0))
        if is_bg_color[y, w-1]: queue.append((y, w-1))

    while queue:
        cy, cx = queue.popleft()
        if cy < 0 or cy >= h or cx < 0 or cx >= w: continue
        if visited[cy, cx]: continue
        if not is_bg_color[cy, cx]: continue
        visited[cy, cx] = True
        queue.append((cy-1, cx))
        queue.append((cy+1, cx))
        queue.append((cy, cx-1))
        queue.append((cy, cx+1))

    # Only make edge-connected background pixels transparent
    data[visited, 3] = 0

    result = Image.fromarray(data)
    result.save(image_path)


def generate_lineart(source_path, output_path):
    """Generate a coloring-book version from an existing colored image."""
    import base64
    with open(source_path, 'rb') as f:
        image_data = f.read()

    response = client.models.generate_content(
        model="gemini-2.5-flash-image",
        contents=[
            types.Part.from_bytes(data=image_data, mime_type="image/png"),
            LINEART_PROMPT,
        ],
        config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
    )
    if response.candidates and response.candidates[0].content.parts:
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                with open(output_path, 'wb') as f:
                    f.write(part.inline_data.data)
                # Post-process: remove white background
                try:
                    remove_white_background(output_path)
                except Exception as e:
                    print(f"    Warning: background removal failed: {e}")
                return True
    return False


# Assets that need lineart versions for coloring phase
LINEART_TARGETS = [
    "friend1.png", "friend2.png", "friend3.png",
    "cake.png", "balloon.png", "present.png",
    "slide.png", "swing.png", "ball.png", "dog.png",
    "bench.png", "tree.png",
]


def main():
    import sys
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    mode = sys.argv[1] if len(sys.argv) > 1 else "stickers"

    if mode == "lineart":
        # Generate lineart versions from existing colored PNGs
        targets = LINEART_TARGETS
        if len(sys.argv) > 2:
            targets = sys.argv[2:]  # e.g. python generate_assets.py lineart friend1.png

        print(f"Generating lineart for {len(targets)} assets...")
        for i, filename in enumerate(targets, 1):
            source = os.path.join(OUTPUT_DIR, filename)
            output = os.path.join(OUTPUT_DIR, filename.replace('.png', '_lineart.png'))
            if not os.path.exists(source):
                print(f"  [{i}] SKIP {filename} — source not found")
                continue
            print(f"  [{i}/{len(targets)}] {filename} → {os.path.basename(output)}...", flush=True)
            try:
                if generate_lineart(source, output):
                    size = os.path.getsize(output)
                    print(f"    OK ({size:,} bytes)")
                else:
                    print(f"    FAILED")
            except Exception as e:
                print(f"    ERROR: {e}")
            if i < len(targets):
                time.sleep(2)
        return

    # Default: generate colored stickers
    total = len(STICKERS)
    succeeded, failed = [], []

    for i, (filename, prompt) in enumerate(STICKERS, 1):
        output_path = os.path.join(OUTPUT_DIR, filename)
        print(f"[{i}/{total}] Generating {filename}...", flush=True)

        for method_name, method in [("Imagen", generate_with_imagen), ("Gemini", generate_with_gemini)]:
            try:
                if method(filename, prompt, output_path):
                    size = os.path.getsize(output_path)
                    print(f"  OK via {method_name} ({size:,} bytes)")
                    succeeded.append(filename)
                    break
            except Exception as e:
                print(f"  {method_name} failed: {e}")
        else:
            print(f"  FAILED")
            failed.append(filename)

        if i < total:
            time.sleep(1)

    print(f"\nDone: {len(succeeded)} succeeded, {len(failed)} failed")
    if failed:
        print(f"Failed: {', '.join(failed)}")

if __name__ == "__main__":
    main()
