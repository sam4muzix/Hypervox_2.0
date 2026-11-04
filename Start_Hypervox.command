#!/bin/zsh
# ─────────────────────────────────────────────────────────────
# HyperVox – One-Click Startup Script
# Starts HyperVox Application
# ─────────────────────────────────────────────────────────────

cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "        ⚡ HYPERVOX - POWERED BY SAM ⚡         "
echo "  Starting App Interface                       "
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Launch Chatterbox Voice Cloning Engine (Local Service) ──
if ! curl -s http://127.0.0.1:5051/health > /dev/null 2>&1; then
  echo "🎙️  Starting Chatterbox Voice Cloning Server (127.0.0.1:5051)..."
  ./.venv_clone/bin/python3 chatterbox_server.py > /tmp/chatterbox_server.log 2>&1 &
  CHATTERBOX_PID=$!
  echo "✅ Chatterbox service launched (PID: $CHATTERBOX_PID)."
else
  echo "✅ Chatterbox service is already running on port 5051."
fi

# ── Launch UI (Electron App / Dev server) ──────────────────
if [ ! -d "node_modules" ]; then
  echo "📦 Installing node dependencies..."
  npm install
fi

echo "📱 Launching HyperVox Application..."
npm run app:dev
