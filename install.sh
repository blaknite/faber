#!/usr/bin/env bash
set -euo pipefail

REPO="blaknite/faber"
INSTALL_DIR="${FABER_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="faber"

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64)  ASSET="faber-darwin-arm64" ;;
      x86_64) ASSET="faber-darwin-x64" ;;
      *)
        echo "Unsupported architecture: $ARCH" >&2
        exit 1
        ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      aarch64|arm64) ASSET="faber-linux-arm64" ;;
      x86_64)        ASSET="faber-linux-x64" ;;
      *)
        echo "Unsupported architecture: $ARCH" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

# Fetch the latest release download URL for our asset
echo "Fetching latest release from https://github.com/$REPO ..."

DOWNLOAD_URL="$(
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    -H "Accept: application/vnd.github+json" \
    | grep -o "\"browser_download_url\": \"[^\"]*${ASSET}\"" \
    | head -1 \
    | cut -d'"' -f4
)"

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Could not find a release asset matching '$ASSET'." >&2
  echo "Check https://github.com/$REPO/releases for available releases." >&2
  exit 1
fi

echo "Downloading $ASSET ..."
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

curl -fsSL "$DOWNLOAD_URL" -o "$TMP_FILE"
chmod +x "$TMP_FILE"

# Install - use sudo only if we can't write to the target directory
DEST="$INSTALL_DIR/$BINARY_NAME"

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP_FILE" "$DEST"
else
  echo "Installing to $DEST (requires sudo) ..."
  sudo mv "$TMP_FILE" "$DEST"
fi

echo "faber installed to $DEST"
echo "Run 'faber --help' to get started."
