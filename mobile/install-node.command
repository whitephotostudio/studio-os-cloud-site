#!/bin/bash
# ---------------------------------------------------------------------------
# Studio OS — one-click Node.js installer.
# Installs Node into your home folder (NO admin password needed), adds it to
# your PATH, then installs the app's dependencies. Just double-click this file.
# ---------------------------------------------------------------------------
set -u

echo ""
echo "============================================================"
echo "  Studio OS — installing Node.js (no password needed)"
echo "============================================================"
echo ""

# 1. Which Mac chip?
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then NODE_ARCH="arm64"; else NODE_ARCH="x64"; fi
echo "  Mac type: $ARCH  ->  Node build: darwin-$NODE_ARCH"

# 2. Find the newest Node LTS (with a safe fallback if the lookup fails).
echo "  Looking up the latest Node LTS version..."
LTS_VER="$(curl -fsSL https://nodejs.org/dist/index.tab 2>/dev/null \
  | awk -F'\t' 'NR==1{for(i=1;i<=NF;i++) if($i=="lts") c=i; next} $c!="-"{print $1; exit}')"
if [ -z "${LTS_VER:-}" ]; then
  LTS_VER="v22.11.0"
  echo "  (Auto-detect failed; using known-good $LTS_VER)"
fi
echo "  Installing Node $LTS_VER"
echo ""

# 3. Download + unpack into ~/.studio-os-node (no sudo).
TARBALL="node-${LTS_VER}-darwin-${NODE_ARCH}.tar.gz"
URL="https://nodejs.org/dist/${LTS_VER}/${TARBALL}"
DEST="$HOME/.studio-os-node"
TMP="$(mktemp -d)"

echo "  Downloading Node..."
if ! curl -fSL "$URL" -o "$TMP/$TARBALL"; then
  echo ""
  echo "  !!! Download failed. Check your internet connection and run this again."
  echo ""
  echo "  Press any key to close."; read -n 1 -s; exit 1
fi

echo "  Installing to $DEST ..."
rm -rf "$DEST"
mkdir -p "$DEST"
tar -xzf "$TMP/$TARBALL" -C "$DEST" --strip-components=1
rm -rf "$TMP"

# 4. Put Node on your PATH for all future Terminal windows (only once).
LINE='export PATH="$HOME/.studio-os-node/bin:$PATH"'
if ! grep -qF "$LINE" "$HOME/.zshrc" 2>/dev/null; then
  printf '\n# Studio OS Node\n%s\n' "$LINE" >> "$HOME/.zshrc"
  echo "  Added Node to your PATH (~/.zshrc)"
fi
export PATH="$HOME/.studio-os-node/bin:$PATH"

echo ""
echo "  Node is installed:"
echo -n "    node "; node -v
echo -n "    npm  "; npm -v
echo ""

# 5. Install the app's JavaScript dependencies (npm install).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
  echo "  Installing app dependencies in:"
  echo "    $SCRIPT_DIR"
  echo "  (this can take a minute)..."
  echo ""
  cd "$SCRIPT_DIR" || exit 1
  if npm install; then
    echo ""
    echo "  Dependencies installed."
  else
    echo ""
    echo "  !!! npm install hit a problem. Send Claude a screenshot of the lines above."
  fi
fi

echo ""
echo "============================================================"
echo "  DONE. Next steps:"
echo "    1) Open a NEW Terminal window (so Node is on its PATH)."
echo "    2) Run these one at a time:"
echo "         cd \"$SCRIPT_DIR\""
echo "         npm run add:ios"
echo "         npm run sync"
echo "         npm run open"
echo ""
echo "  If 'npm run add:ios' says 'pod: command not found',"
echo "  tell Claude and we'll install CocoaPods next."
echo "============================================================"
echo ""
echo "  You can close this window now. (Press any key.)"
read -n 1 -s
echo ""
