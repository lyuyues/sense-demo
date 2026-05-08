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


# ============================================================
# SCENE GENERATION (full background illustrations, not stickers)
# ============================================================

def make_scene_prompt(building_type, exterior_cues=""):
    """Build a Light-stage scene prompt for a given building type.

    exterior_cues: optional extra description (e.g., signage, awning details)
    """
    return f"""Wide landscape watercolor and ink illustration, 16:9 aspect ratio, children's book aesthetic. Soft watercolor washes, thin black ink outlines, warm muted tones, hand-painted feel, charming and whimsical.

Composition: full-bleed side-view cross-section of a {building_type}. The building silhouette EXTENDS TO ALL FOUR EDGES of the frame — the roof touches the top-left and top-right corners, and the building's foundation touches the bottom-left and bottom-right corners. The illustration goes EDGE TO EDGE with NO white margins or padding around the building. Building takes up 100% of the frame.

{exterior_cues}

CRITICAL — INTERIOR IS A FILM STUDIO CHROMA KEY CYCLORAMA:
The entire interior of the building is COMPLETELY COVERED by a giant uniform film-studio chroma key cyclorama, like a Hollywood green-screen seamless wall but in MAGENTA. Hex color #FF00FF (pure neon magenta). The backdrop is freshly painted, completely flat, perfectly uniform.

The cyclorama EXTENDS FROM JUST BELOW THE INTERIOR ROOF LINE ALL THE WAY DOWN TO THE BOTTOM EDGE OF THE FRAME. There is NO interior floor strip, NO baseboard, NO bottom band, NO floor visible inside the building — the magenta cyclorama touches the bottom edge of the frame directly between the two walls. Floor or grass is only visible OUTSIDE the building (to the left and right of the side walls, if at all).

Absolutely NO objects in front of the backdrop: NO furniture, NO desks, NO chalkboards, NO shelves, NO ladders, NO doors, NO chairs, NO carts, NO crates, NO baskets, NO people, NO hanging banners, NO strings, NO drawings, NO writing, NO patterns, NO shadows, NO highlights — just ONE single perfectly uniform flat pure neon magenta rectangle.

The magenta cyclorama must take up AT LEAST 88% of frame width and 88% of frame height (it touches the bottom of the frame). The edges of the magenta meet the building's interior walls and roof line crisply.

NO sky strip at top — the building's roof IS the top edge of the frame.

NO grass strip below the cyclorama — the cyclorama IS the bottom edge of the frame in the interior region.

NO TEXT, NO LETTERS, NO NUMBERS anywhere. NO white margin, NO padding, NO border around the building."""


EVENT_ICONS = [
    ("icons-hd/school.png",
     f"A cheerful smiling schoolhouse building with a red triangular gable roof, a tiny golden bell on the roof peak, two small windows with a smiling friendly face on the front of the building, an apple emblem above the entrance door. {STYLE}"),
    ("icons-hd/grocery.png",
     f"A cheerful smiling shopping cart with a happy face on the front, filled with colorful smiling fruits and vegetables (a red apple with a smile, a green leafy carrot, a small pumpkin), bright and joyful. {STYLE}"),
    ("icons-hd/dining.png",
     f"A cheerful smiling round dinner plate with a happy face on the plate, a fork and knife crossed behind the plate, small steam swirls rising up suggesting warm food, joyful and warm. {STYLE}"),
]


SCENES = [
    ("light_scene_school.png",
     make_scene_prompt(
         "a friendly red-brick schoolhouse with a triangular gable roof and a tiny bell tower on the roof peak",
         "Exterior cues: a small flagpole with a tiny flag on the left side of the roof, a tiny apple emblem painted on the front gable."),
     "16:9"),
    ("light_scene_grocery.png",
     make_scene_prompt(
         "a friendly small grocery store building with a flat-topped roof and a colorful red-and-white striped awning along the top edge",
         "Exterior cues: a small wooden sign with a stylized tomato or apple icon hanging beside the entrance, a tiny shopping basket silhouette next to the wall."),
     "16:9"),
    ("light_scene_dining.png",
     make_scene_prompt(
         "a friendly diner-style restaurant building with a warm terracotta gable roof, a small chimney with curling smoke, and a TEAL-and-cream striped awning across the front above the entrance",
         "Exterior cues: TWO small outdoor patio tables with chairs visible at the very base of the building (tiny silhouettes only, NOT inside the building), a small wooden sign hanging beside the entrance with a stylized FORK AND KNIFE crossed icon."),
     "16:9"),
]


def chroma_key_remove(image_path, target_rgb=(255, 0, 255), tolerance=120):
    """Knock out magenta pixels (and pinkish anti-aliased fringe) to transparent.

    Two-pass:
      1. Hard knockout: clear magenta pixels → alpha 0
      2. Soft knockout: pinkish fringe (R, B dominant over G but blended) →
         alpha proportional to "magenta-ness" so we get a smooth feathered edge
    """
    from PIL import Image
    import numpy as np
    img = Image.open(image_path).convert('RGBA')
    data = np.array(img)
    r = data[:, :, 0].astype(int)
    g = data[:, :, 1].astype(int)
    b = data[:, :, 2].astype(int)
    a = data[:, :, 3].astype(int)

    # Magenta-ness score: 0 (no R+B dominance) to 1 (pure magenta)
    rb_avg = (r + b) / 2.0
    rb_dominance = np.clip((rb_avg - g) / 128.0, 0, 1)

    # Pass 1: clear magenta → fully transparent
    is_clear = (rb_dominance > 0.55) & (rb_avg > 140) & (g < 180)
    data[is_clear, 3] = 0
    n_clear = int(is_clear.sum())

    # Pass 2: pinkish fringe → fade alpha by magenta-ness
    is_fringe = (rb_dominance > 0.20) & (~is_clear) & (rb_avg > 110) & (g < 220)
    fade = np.clip(rb_dominance * 1.6, 0, 1)
    new_alpha = (a * (1.0 - fade)).astype('uint8')
    data[..., 3] = np.where(is_fringe, new_alpha, data[..., 3])
    n_fringe = int(is_fringe.sum())

    # Pass 3: morphological close + fill holes inside the keyed region.
    # Imagen often draws objects (chairs, tripods, lamps) in front of the chroma backdrop;
    # objects that touch the building floor/walls survive as "appendages" of the opaque
    # exterior, not as enclosed islands, so binary_fill_holes alone misses them.
    # Apply binary_closing first to bridge those thin necks → objects become enclosed
    # islands inside the chroma region → fill_holes erases them.
    n_filled = 0
    try:
        from scipy.ndimage import binary_fill_holes, binary_closing
        transparent_mask = (data[:, :, 3] == 0)
        # Close gaps up to ~40px wide (bridges tripod legs, narrow object stems, cart wheels, etc.)
        closed = binary_closing(transparent_mask, iterations=20)
        filled = binary_fill_holes(closed)
        # Sanity: if the fill would erase >90% of image, abort
        if filled.sum() < transparent_mask.size * 0.9:
            new_transparent = filled & ~transparent_mask
            data[new_transparent, 3] = 0
            n_filled = int(new_transparent.sum())
    except ImportError:
        pass

    Image.fromarray(data.astype('uint8')).save(image_path)
    return n_clear, n_fringe, n_filled


def crop_to_painted_area(image_path, white_threshold=235):
    """Crop the image to the bounding box of non-white painted content.

    Imagen tends to leave white margins/padding around generated illustrations.
    This crops them off so the illustration fills the entire saved image, which
    means object-fit:fill in the browser puts the building edge-to-edge.

    Treats fully transparent pixels as "non-painted" too (chroma-keyed interior
    counts as part of the building bounding box, since walls/roof define the bbox).
    """
    from PIL import Image
    import numpy as np
    img = Image.open(image_path).convert('RGBA')
    data = np.array(img)
    r, g, b, a = data[:, :, 0], data[:, :, 1], data[:, :, 2], data[:, :, 3]
    # White margin: opaque AND near-white
    is_white_margin = (a > 200) & (r > white_threshold) & (g > white_threshold) & (b > white_threshold)
    is_painted = ~is_white_margin  # painted = anything that's not opaque white
    ys, xs = np.where(is_painted)
    if len(ys) == 0:
        return None
    y_min, y_max = int(ys.min()), int(ys.max())
    x_min, x_max = int(xs.min()), int(xs.max())
    cropped = img.crop((x_min, y_min, x_max + 1, y_max + 1))
    cropped.save(image_path)
    return (x_min, y_min, x_max - x_min + 1, y_max - y_min + 1)


def pad_top_with_sky(image_path, ratio=0.30):
    """Add a white-sky padding strip on top of the image.

    After crop_to_painted_area, the building fills the entire image vertically.
    But the JS sun arc lives in the top 5-20% of the stage, which would overlap
    the building roof. Adding a top padding strip pushes the building down so
    the sun arc lands in the open sky area above the building.
    """
    from PIL import Image
    img = Image.open(image_path).convert('RGBA')
    w, h = img.size
    pad = int(h * ratio)
    new_img = Image.new('RGBA', (w, h + pad), (255, 255, 255, 255))
    new_img.paste(img, (0, pad))
    new_img.save(image_path)
    return pad


def generate_scene_with_imagen(prompt, output_path, aspect_ratio="16:9"):
    response = client.models.generate_images(
        model='imagen-4.0-generate-001',
        prompt=prompt,
        config=types.GenerateImagesConfig(
            number_of_images=1,
            aspect_ratio=aspect_ratio,
        ),
    )
    for image in response.generated_images:
        image.image.save(output_path)
        return True
    return False


def main():
    import sys
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    mode = sys.argv[1] if len(sys.argv) > 1 else "stickers"

    if mode == "scenes":
        targets = SCENES
        if len(sys.argv) > 2:
            wanted = set(sys.argv[2:])
            targets = [s for s in SCENES if s[0] in wanted or s[0].rsplit('.', 1)[0] in wanted]
        print(f"Generating {len(targets)} scene(s)...")
        for i, (filename, prompt, aspect) in enumerate(targets, 1):
            output_path = os.path.join(OUTPUT_DIR, filename)
            print(f"[{i}/{len(targets)}] {filename} ({aspect})...", flush=True)
            ok = False
            try:
                ok = generate_scene_with_imagen(prompt, output_path, aspect_ratio=aspect)
                if ok:
                    print(f"  OK via Imagen ({os.path.getsize(output_path):,} bytes)")
            except Exception as e:
                print(f"  Imagen failed: {e}")
            if not ok:
                try:
                    if generate_with_gemini(filename, prompt, output_path):
                        ok = True
                        print(f"  OK via Gemini ({os.path.getsize(output_path):,} bytes)")
                except Exception as e:
                    print(f"  Gemini failed: {e}")
            if ok:
                try:
                    n_clear, n_fringe, n_filled = chroma_key_remove(output_path)
                    print(f"  Magenta knocked out: {n_clear:,} clear + {n_fringe:,} fringe + {n_filled:,} hole-fill → transparent")
                except Exception as e:
                    print(f"  Warning: chroma key failed: {e}")
                try:
                    bbox = crop_to_painted_area(output_path)
                    if bbox:
                        print(f"  Cropped to painted bbox: {bbox[2]}×{bbox[3]} (offset {bbox[0]},{bbox[1]})")
                except Exception as e:
                    print(f"  Warning: crop failed: {e}")
                try:
                    pad = pad_top_with_sky(output_path, ratio=0.30)
                    print(f"  Added sky padding: {pad}px on top")
                except Exception as e:
                    print(f"  Warning: sky pad failed: {e}")
                print(f"  Final size: {os.path.getsize(output_path):,} bytes")
            else:
                print(f"  FAILED")
            if i < len(targets):
                time.sleep(2)
        return

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
