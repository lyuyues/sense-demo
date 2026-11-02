#!/usr/bin/env bash
# One-shot setup of the SENSE study server on a Linux desktop (systemd),
# exposed at https://<hostname> through a named Cloudflare Tunnel.
#
#   bash deploy/setup_linux.sh sense.example.com
#
# Safe to re-run: every step checks whether it's already done.
# See deploy/README_linux.md for what each step is and how to verify.
set -euo pipefail

HOSTNAME_PUBLIC="${1:?usage: bash deploy/setup_linux.sh <hostname, e.g. sense.example.com>}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="$(id -un)"
PORT=8766
TUNNEL_NAME=sense-study
ENV_FILE="$APP_DIR/deploy/study.env"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$*"; exit 1; }

# --- 1. Gemini key -----------------------------------------------------------
say "1/7 检查 Gemini key (.env)"
[ -f "$APP_DIR/.env" ] && grep -q '^GEMINI_API_KEY=.' "$APP_DIR/.env" \
  || die "缺少 $APP_DIR/.env，内容应为一行: GEMINI_API_KEY=你的key"
chmod 600 "$APP_DIR/.env"

# --- 2. Python env -----------------------------------------------------------
say "2/7 Python 虚拟环境 + 依赖"
command -v python3 >/dev/null || die "需要 python3 (sudo apt install python3 python3-venv)"
[ -d "$APP_DIR/.venv" ] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install -q --upgrade pip
"$APP_DIR/.venv/bin/pip" install -q "google-genai==1.60.0" "pillow==12.1.0" "rembg[cpu]==2.0.76"
# rembg downloads its model on first use; do it now, not mid-session.
"$APP_DIR/.venv/bin/python" -c "from rembg import new_session; new_session()" >/dev/null

# --- 3. Access token + runtime config ---------------------------------------
say "3/7 访问口令"
if [ ! -f "$ENV_FILE" ]; then
  TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(12))')"
  cat > "$ENV_FILE" <<EOF
STUDY_TOKEN=$TOKEN
HOST=127.0.0.1
PORT=$PORT
USE_HTTPS=0
EOF
  chmod 600 "$ENV_FILE"
fi
TOKEN="$(grep '^STUDY_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
mkdir -p "$APP_DIR/session_data" && chmod 700 "$APP_DIR/session_data"

# --- 4. systemd service for server.py ---------------------------------------
say "4/7 开机自启服务 sense-server"
sudo tee /etc/systemd/system/sense-server.service >/dev/null <<EOF
[Unit]
Description=SENSE study server
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$APP_DIR/.venv/bin/python $APP_DIR/server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now sense-server
sleep 3
curl -fs -o /dev/null "http://127.0.0.1:$PORT/index.html?k=$TOKEN" \
  || die "server.py 没起来: journalctl -u sense-server -n 50"

# --- 5. cloudflared ----------------------------------------------------------
say "5/7 安装 cloudflared"
if ! command -v cloudflared >/dev/null; then
  if command -v apt-get >/dev/null; then
    ARCH="$(dpkg --print-architecture)"
    curl -fsSL -o /tmp/cloudflared.deb \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH.deb"
    sudo dpkg -i /tmp/cloudflared.deb
  else
    die "非 Debian/Ubuntu：请手动安装 cloudflared 后重跑 (https://pkg.cloudflare.com)"
  fi
fi

# --- 6. Named tunnel ---------------------------------------------------------
say "6/7 Cloudflare 隧道 → https://$HOSTNAME_PUBLIC"
if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "需要登录一次 Cloudflare：下面会打印一个链接，用浏览器打开并选择你的域名授权。"
  cloudflared tunnel login
fi
cloudflared tunnel list 2>/dev/null | grep -qw "$TUNNEL_NAME" || cloudflared tunnel create "$TUNNEL_NAME"
TUNNEL_ID="$(cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2==n {print $1}')"
[ -n "$TUNNEL_ID" ] || die "找不到隧道 $TUNNEL_NAME"
cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME_PUBLIC" || true  # already-exists is fine

sudo mkdir -p /etc/cloudflared
sudo cp "$HOME/.cloudflared/$TUNNEL_ID.json" /etc/cloudflared/
sudo tee /etc/cloudflared/config.yml >/dev/null <<EOF
tunnel: $TUNNEL_ID
credentials-file: /etc/cloudflared/$TUNNEL_ID.json
ingress:
  - hostname: $HOSTNAME_PUBLIC
    service: http://127.0.0.1:$PORT
  - service: http_status:404
EOF
if ! systemctl list-unit-files | grep -q '^cloudflared.service'; then
  sudo cloudflared service install
fi
sudo systemctl restart cloudflared
sudo systemctl enable cloudflared >/dev/null

# --- 7. Never sleep ----------------------------------------------------------
say "7/7 关闭睡眠/休眠（实验期间台机必须一直在线）"
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null

say "完成。等 ~30 秒 DNS 生效后测试："
cat <<EOF

  给合作者的 SENSE 链接:     https://$HOSTNAME_PUBLIC/index.html?k=$TOKEN
  给合作者的 Baseline 链接:  https://$HOSTNAME_PUBLIC/baseline.html?k=$TOKEN

  不带 ?k= 打开应显示"需要访问口令"（403）—— 这是对的。
  数据目录: $APP_DIR/session_data/
  日志:     journalctl -u sense-server -f
  口令存放: $ENV_FILE（别提交到 git）

EOF
