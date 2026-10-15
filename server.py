#!/usr/bin/env python3
"""Local proxy server for SENSE demo — handles photo-to-crayon conversion via Gemini."""

import http.server
import ssl
import json
import base64
import io
import os
import time

from google import genai
from google.genai import types
from PIL import Image
from rembg import remove

# Load API key from environment or .env file
API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not API_KEY:
    # 1) .env next to server.py (pilot laptops); 2) Yue's workspace copy.
    here = os.path.dirname(os.path.abspath(__file__))
    for env_path in (os.path.join(here, '.env'),
                     os.path.join(here, '..', '..', '..', 'Research', 'SENSE',
                                  'prototype', 'veo_test', '.env')):
        if not os.path.exists(env_path):
            continue
        for line in open(env_path):
            if line.startswith('GEMINI_API__KEY=') or line.startswith('GEMINI_API_KEY='):
                API_KEY = line.split('=', 1)[1].strip()
        if API_KEY:
            break

if not API_KEY:
    print("ERROR: No GEMINI_API_KEY found. Set env var or check .env file.")
    exit(1)

client = genai.Client(api_key=API_KEY)

AVATAR_PROMPT = (
    "Redraw this child as a children's storybook illustration combining "
    "BOLD DARK INK OUTLINES with crayon-style coloring inside. "
    "EVERY shape — body silhouette, head, hair, face, eyes, mouth, collar, "
    "sleeves, hem, pockets, pants, shoes — must be surrounded by a crisp, "
    "clearly visible dark black ink outline (NOT faint, NOT gray, NOT thin "
    "watercolor edges). Inside the dark outlines, fill colors with chunky "
    "wobbly crayon strokes and visible wax texture. "
    "Keep the child's likeness — hair color, skin tone, clothing colors. "
    "Full body standing, plain white paper background. "
    "Style reference: classic children's coloring book where dark ink lines "
    "define every shape, with vibrant crayon shading inside."
)

BACKGROUND_PROMPT = (
    "Transform this photo into a simple crayon drawing by a 5-year-old child. "
    "Flat 2D front-facing view, NO perspective. Chunky wax crayon strokes, "
    "wobbly lines, soft muted colors, lots of white space. Very minimal. "
    "Like a child's drawing on white paper."
)

LINEART_PROMPT = (
    'Look at this image. Create a "coloring book" version of the EXACT same character/object:\n'
    '- Keep the EXACT same pose, proportions, and silhouette.\n'
    '- Keep the EXACT same FRAMING and CROP as the input — if the input shows '
    'a full-body standing figure head-to-shoes, the output must ALSO show the '
    'full body head-to-shoes at the same zoom level. Do NOT zoom in, crop '
    'tighter, or reframe to a close-up/bust/head-only shot — that is a common '
    'mistake to avoid. The character must occupy the same portion of the frame '
    'as in the input image.\n'
    '- Keep small details colored: face/skin, hair, eyes, lips, shoes, socks, small accessories.\n'
    '- Make large clothing areas and big color blocks WHITE (empty, ready to be colored in).\n'
    '- CRITICAL: ALL outlines and line work must be CRISP, DARK BLACK ink lines, '
    'clearly visible and bold (NOT faint, NOT gray, NOT thin watercolor edges). '
    'Every clothing edge — collar, sleeves, hem, hood, pocket, waistband, pant leg — '
    'must have a clearly visible dark black outline so a child can see exactly which '
    'area to color in. The full body silhouette must be outlined with a bold dark line.\n'
    '- Keep the overall hand-drawn / crayon character of the image, but ink lines must '
    'be DARK and READABLE, not faded.\n'
    '- The background MUST be pure white (#FFFFFF), NOT black, NOT gray, NOT any other '
    'color. Do NOT add any background color — just the character on clean white.\n'
    'Think of a real children\'s coloring page: bold dark outlines surrounding empty '
    'white shapes, with the face/hair pre-colored as a guide.'
)

DIR = os.path.dirname(os.path.abspath(__file__))


STICKER_STYLE = (
    "hand-drawn crayon and colored pencil illustration style, chunky wobbly crayon outlines, "
    "visible wax texture, muted warm colors, gentle and whimsical, white background, no text, "
    "charming children's coloring book illustration, single object centered"
)

EVENT_CONTEXTS = {
    "school": "at a young child's morning classroom, calm and welcoming",
    "grocery": "at a family grocery store / supermarket aisle, everyday and bright",
    "dining": "at a family-friendly restaurant / dining out scene, warm and cozy",
    # legacy (kept for backward compatibility):
    "birthday": "at a children's birthday party, party-themed, festive and cheerful",
    "playground": "at a children's playground, outdoor and playful",
}


# --- Public-deployment guards (home server behind a tunnel) ---
# STUDY_TOKEN set → every request needs it, either as ?k=<token> (first visit;
# the server then sets a cookie) or the sense_k cookie. Unset → open, as on a
# trusted LAN. Without this, anyone on the internet could call the Gemini
# endpoints on our quota or hit save-session.
STUDY_TOKEN = os.environ.get('STUDY_TOKEN', '')
# Never served as static files, token or not: participant data, secrets, code.
BLOCKED_PREFIXES = ('/session_data', '/.git', '/.env', '/__pycache__', '/deploy')
BLOCKED_SUFFIXES = ('.pem', '.py', '.env', '.pyc', '.sh', '.service', '.yml', '.yaml')


class Handler(http.server.SimpleHTTPRequestHandler):
    def _authorized(self):
        if not STUDY_TOKEN:
            return True
        from urllib.parse import urlsplit, parse_qs
        from http.cookies import SimpleCookie
        q = parse_qs(urlsplit(self.path).query)
        if q.get('k', [''])[0] == STUDY_TOKEN:
            self._set_token_cookie = True
            return True
        c = SimpleCookie(self.headers.get('Cookie', ''))
        return 'sense_k' in c and c['sense_k'].value == STUDY_TOKEN

    def _deny(self, code, msg):
        body = msg.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _guard_static(self):
        from urllib.parse import urlsplit, unquote
        import posixpath
        raw = unquote(urlsplit(self.path).path).lower()
        # Normalise (collapse //, /./, ..) before matching, so the guard doesn't
        # depend on how this Python version's http.server treats such paths.
        path = posixpath.normpath('/' + raw.lstrip('/'))
        if raw.endswith('/') and path != '/':
            path += '/'
        if path.startswith(BLOCKED_PREFIXES) or path.endswith(BLOCKED_SUFFIXES) or '/.' in path or '/.' in raw:
            self._deny(404, 'Not found')
            return False
        if not self._authorized():
            self._deny(403, '需要访问口令：请使用研究团队提供的完整链接打开。')
            return False
        return True

    def do_GET(self):
        if not self._guard_static():
            return
        if self.headers.get('Range') and self._serve_range():
            return
        super().do_GET()

    def _serve_range(self):
        # iOS Safari refuses to play <video> from servers that ignore Range
        # (SimpleHTTPRequestHandler always answers 200 with the whole file).
        # Single "bytes=a-b" ranges only — all Safari/Chrome send for media.
        import re
        m = re.match(r'bytes=(\d*)-(\d*)$', self.headers['Range'].strip())
        path = self.translate_path(self.path)
        if not m or not os.path.isfile(path):
            return False
        size = os.path.getsize(path)
        a, b = m.groups()
        if a == '':  # suffix range: last N bytes
            start, end = max(0, size - int(b or 0)), size - 1
        else:
            start, end = int(a), min(int(b) if b else size - 1, size - 1)
        if start >= size or start > end:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.end_headers()
            return True
        length = end - start + 1
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(length))
        self.end_headers()
        try:
            with open(path, 'rb') as f:
                f.seek(start)
                while length > 0:
                    chunk = f.read(min(65536, length))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    length -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # player aborted the request (seek) — normal
        return True

    def do_HEAD(self):
        if self._guard_static():
            super().do_HEAD()

    def do_POST(self):
        if not self._authorized():
            self._deny(403, 'forbidden')
            return
        if self.path == '/api/convert-avatar':
            self._handle_convert(AVATAR_PROMPT, remove_bg=True)
        elif self.path == '/api/convert-background':
            self._handle_convert(BACKGROUND_PROMPT, remove_bg=False)
        elif self.path == '/api/generate-lineart':
            self._handle_convert(LINEART_PROMPT, remove_bg=True)
        elif self.path == '/api/generate-sticker':
            self._handle_generate_sticker()
        elif self.path == '/api/generate-sound':
            self._handle_generate_sound()
        elif self.path == '/api/ai-observation':
            self._handle_ai_observation()
        elif self.path == '/api/save-session':
            self._handle_save_session()
        else:
            self.send_error(404)

    def _handle_convert(self, prompt, remove_bg):
        try:
            length = int(self.headers['Content-Length'])
            body = json.loads(self.rfile.read(length))
            img_data = base64.b64decode(body['image'].split(',')[1])

            img = Image.open(io.BytesIO(img_data))
            img.thumbnail((512, 512))
            buf = io.BytesIO()
            img.save(buf, format='PNG')

            print(f"Converting image ({len(img_data)} bytes)...")

            resp = client.models.generate_content(
                model="gemini-2.5-flash-image",
                contents=[
                    types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png"),
                    prompt,
                ],
                config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
            )

            result_data = None
            for part in resp.candidates[0].content.parts:
                if part.inline_data:
                    result_data = part.inline_data.data
                    break

            if not result_data:
                raise Exception("No image in response")

            result_img = Image.open(io.BytesIO(result_data))
            if remove_bg:
                result_img = remove(result_img)
            result_img.thumbnail((300, 300), Image.LANCZOS)

            out_buf = io.BytesIO()
            result_img.save(out_buf, format='PNG', optimize=True)
            b64 = base64.b64encode(out_buf.getvalue()).decode()

            print(f"  OK ({len(out_buf.getvalue())} bytes)")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'image': f'data:image/png;base64,{b64}'}).encode())

        except Exception as e:
            print(f"  Error: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def _handle_generate_sticker(self):
        try:
            length = int(self.headers['Content-Length'])
            body = json.loads(self.rfile.read(length))
            name = body.get('name', '').strip()
            event = body.get('event', '').strip()
            if not name:
                raise Exception("No name provided")

            context = EVENT_CONTEXTS.get(event, "for a young child's scene")
            prompt = f"A cute {name} {context}, {STICKER_STYLE}"
            print(f"Generating sticker: '{name}'...")

            # Imagen was retired from the Gemini API (2026-10); use the same
            # image model as avatar conversion.
            resp = client.models.generate_content(
                model="gemini-2.5-flash-image",
                contents=[prompt],
                config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"]),
            )

            result_data = None
            for part in resp.candidates[0].content.parts:
                if part.inline_data:
                    result_data = part.inline_data.data
                    break

            if not result_data:
                raise Exception("No image generated")

            # Remove background
            result_img = Image.open(io.BytesIO(result_data))
            result_img = remove(result_img)
            result_img.thumbnail((300, 300), Image.LANCZOS)

            out_buf = io.BytesIO()
            result_img.save(out_buf, format='PNG', optimize=True)
            b64 = base64.b64encode(out_buf.getvalue()).decode()

            print(f"  OK: '{name}' ({len(out_buf.getvalue())} bytes)")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'image': f'data:image/png;base64,{b64}',
                'name': name,
            }).encode())

        except Exception as e:
            print(f"  Sticker error: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def _handle_generate_sound(self):
        try:
            length = int(self.headers['Content-Length'])
            body = json.loads(self.rfile.read(length))
            name = body.get('name', '').strip()
            if not name:
                raise Exception("No name provided")

            prompt = f"Pure isolated sound effect of {name} only. Single sound source, no background music, no vocals, no singing, no instruments. Just the raw natural sound of {name}. Clean recording, loopable."
            print(f"Generating sound: '{name}'...")

            from google.genai import types as gtypes
            resp = client.models.generate_content(
                model="lyria-3-clip-preview",
                contents=prompt,
                config=gtypes.GenerateContentConfig(response_modalities=["AUDIO"]),
            )

            audio_data = None
            for part in resp.candidates[0].content.parts:
                if part.inline_data:
                    audio_data = part.inline_data.data
                    break

            if not audio_data:
                raise Exception("No audio generated")

            b64 = base64.b64encode(audio_data).decode()
            print(f"  OK: '{name}' ({len(audio_data)} bytes)")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'audio': f'data:audio/mpeg;base64,{b64}',
                'name': name,
            }).encode())

        except Exception as e:
            print(f"  Sound error: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def _handle_ai_observation(self):
        try:
            length = int(self.headers['Content-Length'])
            body = json.loads(self.rfile.read(length))
            behavior_data = body.get('behaviorData', {})
            screenshots = body.get('screenshots', {})

            mode = body.get('mode', 'full')

            if mode == 'single_stage':
                stage_name = behavior_data.get('stage', 'unknown')
                prompt = f"""You are a child sensory preference observer. A child (age 3-6) just completed the "{stage_name}" stage. Based on the data, write ONE short factual observation in Chinese (15-25 characters) describing WHAT the child did and WHAT preferences they showed.

RULES:
- 给家长有用的 insight，不要空洞鼓励。错误："画得真棒！" 正确："偏好柔和的冷色调，涂色时很仔细"
- 聚焦感官偏好：颜色选择、空间布局、节奏模式、声音敏感度

Data: {json.dumps(behavior_data, indent=2)}

Return JSON only: {{"observation": "一句中文行为观察（15-25字）"}}"""
            elif mode == 'summary':
                prompt = """Based on all stage data, write a 2-3 sentence Chinese summary describing the child's sensory preference profile. Focus on:
- Visual: color saturation preference (vivid vs soft), brightness preference
- Spatial: social distance preference (close vs far), number of elements
- Auditory: volume/complexity preference, processing latency
- Temporal: rhythm speed during free play

RULES:
- 用温暖但信息丰富的语气，帮助家长理解孩子的感官偏好
- 不要空洞的鼓励（"画得真棒"），要有具体的 insight（"您的孩子倾向于选择柔和的颜色，把朋友放在较近的位置"）
- 让家长读完后觉得"原来我的孩子有这样的偏好"

Data: """ + json.dumps(behavior_data, indent=2) + """

Return JSON only: {"summary": "2-3句中文感官偏好描述（50-80字）"}"""
            else:
                prompt = """You are a child behavior observation assistant for SENSE. Based on the data, provide observations for each stage and a summary.

GUIDELINES: Be descriptive, not diagnostic. Warm and supportive. No clinical terms.

Data: """ + json.dumps(behavior_data, indent=2) + """

Return JSON only:
{
  "stages": [
    { "stage": "create", "observation": "一句中文观察（15-25字）" },
    { "stage": "color", "observation": "一句中文观察（15-25字）" },
    { "stage": "sound", "observation": "一句中文观察（15-25字）" },
    { "stage": "drum", "observation": "一句中文观察（15-25字）" }
  ],
  "summary": "2-3句中文整体描述（50-80字）"
}"""

            parts = [types.Part.from_text(text=prompt)]

            # Add screenshots if available
            for key, label in [('elements', '布置场景'), ('color', '涂色'), ('sound', '声音')]:
                if key in screenshots and screenshots[key]:
                    img_data = screenshots[key]
                    if ',' in img_data:
                        img_data = img_data.split(',')[1]
                    parts.append(types.Part.from_bytes(
                        data=base64.b64decode(img_data),
                        mime_type='image/jpeg'
                    ))
                    parts.append(types.Part.from_text(text=f'{label}阶段截图'))

            print("AI observation: calling Gemini...")
            resp = client.models.generate_content(
                model="gemini-2.5-flash",  # gemini-2.0-flash retired (404) as of 2026-10
                contents=parts,
            )

            text = resp.candidates[0].content.parts[0].text
            print(f"  AI response: {text[:100]}...")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'result': text}).encode())

        except Exception as e:
            print(f"  AI observation error: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def _handle_save_session(self):
        # Study data-collection sink: the client POSTs its full session record
        # (elicitation preferences + interactionLog + video playback) here so
        # it survives the tab closing, instead of relying on a manual dev-mode
        # download. One file per (sessionId, exportStage) — stage1 fires at the
        # elicitation->video boundary, stage2 at video end, so a session that's
        # abandoned mid-video still leaves a stage1 record behind.
        try:
            length = int(self.headers['Content-Length'])
            body = json.loads(self.rfile.read(length))
            session_dir = os.path.join(DIR, 'session_data')
            os.makedirs(session_dir, exist_ok=True)

            session_id = "".join(c for c in str(body.get("sessionId") or int(time.time() * 1000)) if c.isdigit())
            stage = body.get('exportStage', 'unknown')
            pid = ''.join(c for c in str(body.get('participantId') or 'NO-PID') if c.isalnum() or c in '-_')
            cond = ''.join(c for c in str(body.get('condition') or 'unknown') if c.isalnum())
            stage = ''.join(c for c in str(stage) if c.isalnum() or c in '-_')
            fname = f"sense-{pid}-{cond}-{session_id}-{stage}.json"
            path = os.path.join(session_dir, fname)
            with open(path, 'w') as f:
                json.dump(body, f, indent=2)
            print(f"Session data saved: {fname}")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'ok', 'file': fname}).encode())
        except Exception as e:
            print(f"Save session error: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def end_headers(self):
        if getattr(self, '_set_token_cookie', False):
            self.send_header('Set-Cookie', f'sense_k={STUDY_TOKEN}; Path=/; Max-Age=15552000; SameSite=Lax; HttpOnly')
            self._set_token_cookie = False
        if not STUDY_TOKEN:
            self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()


def main():
    port = int(os.environ.get('PORT', 8443))
    use_https = os.environ.get('USE_HTTPS', '1') != '0'
    # HOST=127.0.0.1 when behind a tunnel, so the server is reachable only via
    # the tunnel (which carries the token check), not directly from the LAN.
    host = os.environ.get('HOST', '0.0.0.0')
    server = http.server.ThreadingHTTPServer((host, port), Handler)

    cert = os.path.join(DIR, 'cert.pem')
    key = os.path.join(DIR, 'key.pem')
    if use_https and os.path.exists(cert) and os.path.exists(key):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
        print(f"HTTPS server at https://{host}:{port}")
    else:
        print(f"HTTP server at http://{host}:{port}" + (" (token required)" if STUDY_TOKEN else ""))

    server.serve_forever()


if __name__ == '__main__':
    main()
