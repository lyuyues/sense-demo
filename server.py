#!/usr/bin/env python3
"""Local proxy server for SENSE demo — handles photo-to-crayon conversion via Gemini."""

import http.server
import ssl
import json
import base64
import io
import os

from google import genai
from google.genai import types
from PIL import Image
from rembg import remove

# Load API key from environment or .env file
API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not API_KEY:
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', '..',
                            'Claudcode_AI_workspace', 'Research', 'SENSE', 'veo_test', '.env')
    if os.path.exists(env_path):
        for line in open(env_path):
            if line.startswith('GEMINI_API__KEY=') or line.startswith('GEMINI_API_KEY='):
                API_KEY = line.split('=', 1)[1].strip()

if not API_KEY:
    print("ERROR: No GEMINI_API_KEY found. Set env var or check .env file.")
    exit(1)

client = genai.Client(api_key=API_KEY)

AVATAR_PROMPT = (
    "Redraw this child as if a 5-year-old drew them with wax crayons on paper. "
    "Chunky wobbly crayon lines, visible crayon texture and wax strokes. "
    "Keep the child's likeness - hair color, skin tone, clothing colors. "
    "Full body standing, white paper background. NOT clean digital art."
)

BACKGROUND_PROMPT = (
    "Transform this photo into a simple crayon drawing by a 5-year-old child. "
    "Flat 2D front-facing view, NO perspective. Chunky wax crayon strokes, "
    "wobbly lines, soft muted colors, lots of white space. Very minimal. "
    "Like a child's drawing on white paper."
)

DIR = os.path.dirname(os.path.abspath(__file__))


STICKER_STYLE = (
    "hand-drawn crayon and colored pencil illustration style, chunky wobbly crayon outlines, "
    "visible wax texture, muted warm colors, gentle and whimsical, white background, no text, "
    "charming children's coloring book illustration, single object centered"
)

EVENT_CONTEXTS = {
    "birthday": "at a children's birthday party, party-themed, festive and cheerful",
    "playground": "at a children's playground, outdoor and playful",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/api/convert-avatar':
            self._handle_convert(AVATAR_PROMPT, remove_bg=True)
        elif self.path == '/api/convert-background':
            self._handle_convert(BACKGROUND_PROMPT, remove_bg=False)
        elif self.path == '/api/generate-sticker':
            self._handle_generate_sticker()
        elif self.path == '/api/generate-sound':
            self._handle_generate_sound()
        elif self.path == '/api/ai-observation':
            self._handle_ai_observation()
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
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'image': f'data:image/png;base64,{b64}'}).encode())

        except Exception as e:
            print(f"  Error: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
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

            resp = client.models.generate_images(
                model='imagen-4.0-generate-001',
                prompt=prompt,
                config=types.GenerateImagesConfig(number_of_images=1),
            )

            result_data = None
            for img in resp.generated_images:
                result_data = img.image.image_bytes
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
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'image': f'data:image/png;base64,{b64}',
                'name': name,
            }).encode())

        except Exception as e:
            print(f"  Sticker error: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
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
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'audio': f'data:audio/mpeg;base64,{b64}',
                'name': name,
            }).encode())

        except Exception as e:
            print(f"  Sound error: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
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
- Temporal: rhythm speed, visual vs auditory processing difference

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
                model="gemini-2.0-flash",
                contents=parts,
            )

            text = resp.candidates[0].content.parts[0].text
            print(f"  AI response: {text[:100]}...")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'result': text}).encode())

        except Exception as e:
            print(f"  AI observation error: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()


def main():
    port = 8443
    server = http.server.HTTPServer(('0.0.0.0', port), Handler)

    cert = os.path.join(DIR, 'cert.pem')
    key = os.path.join(DIR, 'key.pem')
    if os.path.exists(cert) and os.path.exists(key):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
        print(f"HTTPS server at https://0.0.0.0:{port}")
    else:
        print(f"HTTP server at http://0.0.0.0:{port}")

    server.serve_forever()


if __name__ == '__main__':
    main()
