#!/usr/bin/env bash
set -euo pipefail

REPO="blaknite/faber"
FABER_HOME="${HOME}/.faber"
BIN_DIR="${FABER_HOME}/bin"
BINARY_NAME="faber"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
  echo -e "${BLUE}[INFO]${NC} $1" >&2
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
  exit 1
}

success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Cleanup temp files on interrupt
TMP_FILE=""
cleanup() {
  echo "" >&2
  echo -e "${YELLOW}Installation interrupted${NC}" >&2
  rm -f "$TMP_FILE" 2>/dev/null || true
  exit 1
}

trap cleanup INT TERM

# Verify required commands are available
check_prereqs() {
  for cmd in uname mktemp chmod mkdir rm curl; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      error "Required command not found: $cmd"
    fi
  done
}

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64)  ASSET="faber-darwin-arm64" ;;
      x86_64) ASSET="faber-darwin-x64" ;;
      *)
        error "Unsupported architecture: $ARCH"
        ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      aarch64|arm64) ASSET="faber-linux-arm64" ;;
      x86_64)        ASSET="faber-linux-x64" ;;
      *)
        error "Unsupported architecture: $ARCH"
        ;;
    esac
    ;;
  *)
    error "Unsupported OS: $OS"
    ;;
esac

check_prereqs

# Fetch the latest release metadata
log "Fetching latest release from https://github.com/$REPO ..."

RELEASE_JSON="$(
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    -H "Accept: application/vnd.github+json"
)"

DOWNLOAD_URL="$(
  echo "$RELEASE_JSON" \
    | grep -o "\"browser_download_url\":[ ]*\"[^\"]*${ASSET}\"" \
    | head -1 \
    | cut -d'"' -f4
)"

if [ -z "$DOWNLOAD_URL" ]; then
  error "Could not find a release asset matching '$ASSET'. Check https://github.com/$REPO/releases for available releases."
fi

VERSION="$(
  echo "$RELEASE_JSON" \
    | grep -o '"tag_name":[ ]*"[^"]*"' \
    | head -1 \
    | cut -d'"' -f4 \
    | sed 's/^v//'
)"

log "Downloading $ASSET ..."
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

curl -fsSL "$DOWNLOAD_URL" -o "$TMP_FILE"
chmod +x "$TMP_FILE"

# Install to ~/.faber/bin
mkdir -p "$BIN_DIR"
DEST="${BIN_DIR}/${BINARY_NAME}"
mv "$TMP_FILE" "$DEST"

success "faber installed to $DEST"

# Check if a directory is in PATH
dir_in_path() {
  local check_dir="$1"
  if [[ -d "$check_dir" ]]; then
    check_dir=$(cd "$check_dir" 2>/dev/null && pwd) || return 1
  fi
  echo ":$PATH:" | grep -q ":$check_dir:"
}

# Try to symlink into an existing PATH directory
try_symlink_in_path() {
  local preferred_dirs=(
    "$HOME/.local/bin"
    "$HOME/bin"
    "$HOME/.bin"
  )

  for dir in "${preferred_dirs[@]}"; do
    if [[ -d "$dir" ]] && dir_in_path "$dir"; then
      local symlink_path="${dir}/${BINARY_NAME}"

      if [[ -L "$symlink_path" ]]; then
        rm -f "$symlink_path"
      fi

      if ln -sf "$DEST" "$symlink_path" 2>/dev/null; then
        log "Created symlink: $symlink_path -> $DEST"
        return 0
      fi
    fi
  done

  return 1
}

# Make faber accessible on PATH
setup_path() {
  # If one of the preferred dirs is already in PATH, symlink there and we're done
  if try_symlink_in_path; then
    return
  fi

  # None of the preferred dirs are in PATH -- create ~/.local/bin and symlink there
  local local_bin="$HOME/.local/bin"
  mkdir -p "$local_bin"

  local symlink_path="${local_bin}/${BINARY_NAME}"
  if [[ -L "$symlink_path" ]]; then
    rm -f "$symlink_path"
  fi
  ln -sf "$DEST" "$symlink_path"
  log "Created symlink: $symlink_path -> $DEST"

  # Detect shell
  local shell_name
  shell_name=$(basename "${SHELL:-bash}")

  local shell_profile=""
  local path_export=""

  case "$shell_name" in
    zsh)
      shell_profile="$HOME/.zshrc"
      path_export='export PATH="$HOME/.local/bin:$PATH"'
      ;;
    bash)
      if [[ "$OS" == "Darwin" ]]; then
        if [[ -f "$HOME/.bash_profile" ]]; then
          shell_profile="$HOME/.bash_profile"
        else
          shell_profile="$HOME/.bashrc"
        fi
      else
        if [[ -f "$HOME/.bashrc" ]]; then
          shell_profile="$HOME/.bashrc"
        else
          shell_profile="$HOME/.bash_profile"
        fi
      fi
      path_export='export PATH="$HOME/.local/bin:$PATH"'
      ;;
    fish)
      shell_profile="$HOME/.config/fish/config.fish"
      path_export='fish_add_path "$HOME/.local/bin"'
      ;;
    *)
      warn "Unknown shell: $shell_name"
      echo ""
      warn "Add ~/.local/bin to your PATH to use faber:"
      echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
      return
      ;;
  esac

  # Check if ~/.local/bin is already configured in the shell profile
  if [[ -f "$shell_profile" ]] && grep -v '^\s*#' "$shell_profile" 2>/dev/null | grep -qE 'PATH=.*\.local/bin|fish_add_path.*\.local/bin'; then
    echo ""
    log "~/.local/bin is already in your shell profile."
    log "To use faber immediately, run:"
    echo "  $path_export"
    return
  fi

  local tilde_profile="${shell_profile/#$HOME/\~}"

  if [[ -t 0 ]]; then
    # Interactive: ask before modifying
    echo ""
    printf "Add ~/.local/bin to your PATH in %s? [y/n] " "$tilde_profile"
    read -r REPLY
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      log "Skipped. To use faber, add ~/.local/bin to your PATH:"
      echo "  $path_export"
      return
    fi
  else
    # Non-interactive: just print the export line
    echo ""
    log "To use faber, add ~/.local/bin to your PATH:"
    echo "  $path_export"
    return
  fi

  if [[ ! -f "$shell_profile" ]]; then
    mkdir -p "$(dirname "$shell_profile")"
    touch "$shell_profile"
  fi

  {
    echo ""
    echo "# Faber"
    echo "$path_export"
  } >> "$shell_profile"

  success "Added ~/.local/bin to PATH in $tilde_profile"
  echo ""
  log "To use faber immediately, run:"
  echo "  $path_export"
}

setup_path

echo ""
log "Run 'faber extras' to install agent skills and opencode commands."

echo ""
success "Run 'faber --help' to get started."
