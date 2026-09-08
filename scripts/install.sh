#!/usr/bin/env bash
# eYssen EYAS Installer — macOS / Linux
#
# One-liner:
#   curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
#
# Non-interactive (CI / scripted):
#   curl -fsSL …/install.sh | bash -s -- --yes
#
# Optional flags:
#   --yes, -y          No prompts (defaults)
#   --dir PATH         Install directory (default: ~/eyas)
#   --method docker|native
#   --port N           HTTP port (default: 3100)
#   --version TAG      Git tag or branch (default: main). Use to match a backup
#                      (e.g. --version 0.8.5-beta or --version v0.8.5-beta)
#   --help
#
# Optional env (same meaning as flags when set before curl|bash):
#   EYAS_DIR  EYAS_METHOD  EYAS_PORT  EYAS_NO_PROMPT=true  EYAS_VERSION / EYAS_BRANCH
#
# Interactive install asks native vs Docker even when both runtimes are ready.
# Missing tools (git, Bun, Docker) are offered for install. Admin account, AI
# provider and agent names belong to the web setup wizard, not this script.
#
# Native install also bun-installs nested packages (src/web, packages/docs) —
# they are not workspaces, so root `bun install` does not put Vite on disk.
# Unlinked `link:` deps (e.g. @saker) are skipped so a public clone still builds.

set -euo pipefail

# ─── Colors & Formatting ─────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

print_logo() {
  echo -e "${CYAN}${BOLD}"
  # Quoted heredoc so the eYssen backslashes stay literal (echo -e would eat them).
  cat <<'EOF'
      __  __
    __\ \/ /____________  ____
   / _ \  / ___/ ___/ _ \/ __ \
  /  __/ (__  |__  )  __/ / / /
  \___/_/____/____/\___/_/ /_/

  ███████╗██╗   ██╗ █████╗ ███████╗
  ██╔════╝╚██╗ ██╔╝██╔══██╗██╔════╝
  █████╗   ╚████╔╝ ███████║███████╗
  ██╔══╝    ╚██╔╝  ██╔══██║╚════██║
  ███████╗   ██║   ██║  ██║███████║
  ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝
EOF
  echo -e "${NC}${DIM}  eYssen EYAS Installer — macOS / Linux${NC}"
}

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }
step()    { echo -e "\n${BOLD}${CYAN}▸ $*${NC}"; }

# ─── Defaults ─────────────────────────────────────────────────────────────────

INSTALL_DIR="${EYAS_DIR:-$HOME/eyas}"
# Prefer EYAS_VERSION (semver/tag for restore), then EYAS_BRANCH, else main
BRANCH="${EYAS_VERSION:-${EYAS_BRANCH:-main}}"
REPO_URL="https://github.com/eyssen/eyas.git"
NO_PROMPT="${EYAS_NO_PROMPT:-false}"
METHOD="${EYAS_METHOD:-}"
CFG_PORT="${EYAS_PORT:-3100}"
COMPOSE_CMD=""
OS=""
ARCH=""

# Normalize version string to a git ref (tag or branch).
# 0.8.5-beta → v0.8.5-beta; v0.8.5-beta / main / feature-x left as-is.
normalize_git_ref() {
  local ref="$1"
  if [[ -z "$ref" ]]; then
    echo "main"
    return
  fi
  if [[ "$ref" == "main" || "$ref" == "master" || "$ref" == "develop" ]]; then
    echo "$ref"
    return
  fi
  if [[ "$ref" == v* || "$ref" == origin/* || "$ref" == tags/* ]]; then
    echo "$ref"
    return
  fi
  # Looks like a version number (starts with digit) → prefix v for git tags
  if [[ "$ref" =~ ^[0-9] ]]; then
    echo "v${ref}"
    return
  fi
  echo "$ref"
}

# ─── CLI ──────────────────────────────────────────────────────────────────────

usage() {
  cat <<'EOF'
eYssen EYAS installer (macOS / Linux)

Usage:
  curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash
  curl -fsSL …/install.sh | bash -s -- [options]

Options:
  --yes, -y              Non-interactive (use defaults)
  --dir PATH             Install directory (default: ~/eyas)
  --method docker|native Install method (interactive default: ask)
  --port N               HTTP port (default: 3100)
  --version TAG          Git tag or branch (default: main)
                         Match a backup: --version 0.8.12-beta
                         (also: EYAS_VERSION=0.8.12-beta)
  --help                 Show this help

Account, AI provider and agent names are collected by the setup wizard
in the browser after first start — not by this installer.

Default ref is main. Use --version to pin a release for restore from backup.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes|-y)
        NO_PROMPT="true"
        shift
        ;;
      --dir)
        INSTALL_DIR="${2:?--dir requires a path}"
        shift 2
        ;;
      --method)
        METHOD="${2:?--method requires docker|native}"
        case "$METHOD" in
          docker|native) ;;
          *) error "Invalid --method: $METHOD (use docker or native)"; exit 1 ;;
        esac
        shift 2
        ;;
      --port)
        CFG_PORT="${2:?--port requires a number}"
        shift 2
        ;;
      --version|--ref)
        BRANCH="${2:?--version requires a tag or branch}"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        error "Unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done
  BRANCH="$(normalize_git_ref "$BRANCH")"
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

command_exists() { command -v "$1" &>/dev/null; }

read_reply() {
  local prompt="$1"
  local input=""
  if [[ "$NO_PROMPT" == "true" ]]; then
    REPLY=""
    return
  fi
  if [[ -t 0 ]]; then
    read -rp "$prompt" input
  elif [[ -e /dev/tty ]]; then
    read -rp "$prompt" input < /dev/tty
  else
    input=""
  fi
  REPLY="$input"
}

ask() {
  local prompt="$1" default="$2" var="$3"
  if [[ "$NO_PROMPT" == "true" ]]; then
    eval "$var=\"$default\""
    return
  fi
  read_reply "$(echo -e "${BOLD}$prompt${NC} ${DIM}[$default]${NC}: ")"
  eval "$var=\"${REPLY:-$default}\""
}

ask_yes() {
  local prompt="$1"
  local default="${2:-yes}"
  local yn hint
  if [[ "$default" == "yes" ]]; then hint="Y/n"; else hint="y/N"; fi
  if [[ "$NO_PROMPT" == "true" ]]; then
    [[ "$default" == "yes" ]]
    return
  fi
  read_reply "$(echo -e "${BOLD}$prompt${NC} ${DIM}[$hint]${NC} ")"
  yn="$(echo "${REPLY:-}" | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$yn" ]]; then
    [[ "$default" == "yes" ]]
    return
  fi
  [[ "$yn" == "y" || "$yn" == "yes" ]]
}

pkg_install() {
  local pkgs=("$@")
  if command_exists brew; then
    brew install "${pkgs[@]}"
  elif command_exists apt-get; then
    sudo apt-get update
    sudo apt-get install -y "${pkgs[@]}"
  elif command_exists dnf; then
    sudo dnf install -y "${pkgs[@]}"
  elif command_exists yum; then
    sudo yum install -y "${pkgs[@]}"
  elif command_exists pacman; then
    sudo pacman -Sy --noconfirm "${pkgs[@]}"
  elif command_exists zypper; then
    sudo zypper install -y "${pkgs[@]}"
  elif command_exists apk; then
    sudo apk add "${pkgs[@]}"
  else
    return 1
  fi
}

run_remote_installer() {
  local url="$1"
  local label="$2"
  local installer
  installer="$(mktemp)"
  if ! command_exists curl; then
    error "curl is required to install $label"
    exit 1
  fi
  curl -fsSL "$url" -o "$installer"
  if ! head -n 1 "$installer" | grep -qE '^#!'; then
    rm -f "$installer"
    error "Downloaded $label installer is not a valid shell script"
    exit 1
  fi
  bash "$installer"
  rm -f "$installer"
}

# ─── Environment Detection ───────────────────────────────────────────────────

docker_daemon_up() { docker info &>/dev/null; }

detect_compose_cmd() {
  COMPOSE_CMD=""
  if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
    return 0
  fi
  if command_exists docker-compose; then
    COMPOSE_CMD="docker-compose"
    return 0
  fi
  return 1
}

compose() {
  # shellcheck disable=SC2086
  $COMPOSE_CMD "$@"
}

detect_env() {
  step "Checking environment..."

  OS="$(uname -s)"
  ARCH="$(uname -m)"
  info "System: $OS $ARCH"

  case "$OS" in
    Linux|Darwin) ;;
    MINGW*|MSYS*|CYGWIN*)
      warn "Windows detected — Docker mode recommended (or use scripts/install.ps1)"
      ;;
    *)
      error "Unsupported OS: $OS"
      exit 1
      ;;
  esac

  HAS_GIT=false
  HAS_DOCKER=false
  HAS_DOCKER_DAEMON=false
  HAS_DOCKER_COMPOSE=false
  HAS_DOCKER_APP=false
  HAS_BUN=false
  HAS_NODE=false
  BUN_VERSION=""
  NODE_VERSION=""

  if command_exists git; then
    HAS_GIT=true
    success "git $(git --version | cut -d' ' -f3)"
  else
    warn "git not found"
  fi

  if command_exists docker; then
    HAS_DOCKER=true
    success "docker $(docker --version | cut -d' ' -f3 | tr -d ',')"
    if docker_daemon_up; then
      HAS_DOCKER_DAEMON=true
      success "Docker daemon is running"
    else
      warn "Docker CLI found, but the daemon is not running"
    fi
    if detect_compose_cmd; then
      HAS_DOCKER_COMPOSE=true
      success "docker compose $(compose version --short 2>/dev/null || echo 'available')"
    else
      warn "Docker Compose not found"
    fi
  else
    info "Docker not found"
  fi

  if [[ "$OS" == "Darwin" && -d "/Applications/Docker.app" ]]; then
    HAS_DOCKER_APP=true
  fi

  if command_exists bun; then
    HAS_BUN=true
    BUN_VERSION="$(bun --version)"
    success "bun $BUN_VERSION"
  else
    info "Bun not found"
  fi

  if command_exists node; then
    HAS_NODE=true
    NODE_VERSION="$(node --version)"
    local major="${NODE_VERSION#v}"
    major="${major%%.*}"
    if [[ "$major" -lt 22 ]]; then
      warn "Node.js $NODE_VERSION found but 22+ required for eYssen EYAS"
      HAS_NODE=false
    else
      success "node $NODE_VERSION"
    fi
  fi
}

# ─── Missing-tool installers ─────────────────────────────────────────────────

install_git() {
  step "Installing git..."
  if [[ "$OS" == "Darwin" ]]; then
    if command_exists brew; then
      brew install git
    else
      info "Opening Apple Command Line Tools installer (includes git)..."
      xcode-select --install || true
      error "Finish the Command Line Tools window, then rerun this installer."
      exit 1
    fi
  else
    if ! pkg_install git; then
      error "Could not install git automatically. Install it from https://git-scm.com/ and rerun."
      exit 1
    fi
  fi
  if command_exists git; then
    HAS_GIT=true
    success "git $(git --version | cut -d' ' -f3)"
  else
    error "git installation did not make the git command available"
    exit 1
  fi
}

install_bun() {
  step "Installing Bun..."
  run_remote_installer "https://bun.sh/install" "Bun"

  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if command_exists bun; then
    HAS_BUN=true
    BUN_VERSION="$(bun --version)"
    success "Bun $BUN_VERSION installed"
  else
    error "Bun installation failed"
    exit 1
  fi
}

start_docker_daemon() {
  if docker_daemon_up; then
    HAS_DOCKER_DAEMON=true
    return 0
  fi

  step "Starting Docker daemon..."
  if [[ "$OS" == "Darwin" ]]; then
    if [[ "$HAS_DOCKER_APP" == "true" || -d "/Applications/Docker.app" ]]; then
      HAS_DOCKER_APP=true
      info "Opening Docker Desktop..."
      open -a Docker
    else
      return 1
    fi
  elif command_exists systemctl; then
    if command_exists sudo; then
      sudo systemctl start docker || true
    else
      systemctl start docker || true
    fi
  elif command_exists service; then
    sudo service docker start || true
  else
    return 1
  fi

  info "Waiting for Docker daemon (up to 90s)..."
  local i=0
  while (( i < 90 )); do
    if docker_daemon_up; then
      echo
      HAS_DOCKER=true
      HAS_DOCKER_DAEMON=true
      success "Docker daemon is running"
      detect_compose_cmd && HAS_DOCKER_COMPOSE=true || true
      return 0
    fi
    sleep 2
    i=$((i + 2))
    printf "."
  done
  echo
  return 1
}

install_docker() {
  step "Installing Docker..."
  if [[ "$OS" == "Darwin" ]]; then
    if [[ -d "/Applications/Docker.app" ]]; then
      HAS_DOCKER_APP=true
      HAS_DOCKER=true
    elif command_exists brew; then
      info "Installing Docker Desktop via Homebrew (this can take a few minutes)..."
      brew install --cask docker
      HAS_DOCKER_APP=true
    else
      error "Docker Desktop is not installed."
      info "Install it from https://docs.docker.com/desktop/setup/install/mac-install/"
      info "  — then rerun this installer."
      exit 1
    fi
    if ! start_docker_daemon; then
      error "Docker Desktop is installed but the daemon did not start."
      info "Open Docker Desktop, wait until it is running, then rerun this installer."
      exit 1
    fi
  else
    run_remote_installer "https://get.docker.com" "Docker"
    if command_exists sudo; then
      sudo usermod -aG docker "${USER:-$(id -un)}" 2>/dev/null || true
    fi
    start_docker_daemon || true
    if ! command_exists docker; then
      error "Docker installation did not make the docker command available"
      exit 1
    fi
    HAS_DOCKER=true
    if ! docker_daemon_up; then
      error "Docker is installed but the daemon is not running (or this user cannot talk to it)."
      info "Try: sudo systemctl start docker"
      info "And add your user to the docker group: sudo usermod -aG docker $USER && newgrp docker"
      exit 1
    fi
    HAS_DOCKER_DAEMON=true
  fi

  if detect_compose_cmd; then
    HAS_DOCKER_COMPOSE=true
    success "docker compose $(compose version --short 2>/dev/null || echo 'available')"
  else
    error "Docker Compose is not available after Docker install"
    exit 1
  fi
}

ensure_git() {
  if [[ "$HAS_GIT" == "true" ]]; then
    return 0
  fi
  if [[ "$NO_PROMPT" == "true" ]]; then
    error "git is required. Install git and rerun, or run this installer interactively."
    exit 1
  fi
  if ask_yes "git is not installed. Install it now?" yes; then
    install_git
  else
    error "git is required. Install it from https://git-scm.com/ and rerun."
    exit 1
  fi
}

ensure_bun() {
  if command_exists bun; then
    HAS_BUN=true
    return 0
  fi
  if [[ "$NO_PROMPT" == "true" ]]; then
    error "Bun is required for native install. Install it from https://bun.sh and rerun, or pass --method docker."
    exit 1
  fi
  if ask_yes "Bun is not installed. Install it now?" yes; then
    install_bun
  else
    error "Cannot continue a native install without Bun. Install it from https://bun.sh or choose Docker."
    exit 1
  fi
}

ensure_docker() {
  if [[ "$HAS_DOCKER_COMPOSE" == "true" && "$HAS_DOCKER_DAEMON" == "true" ]]; then
    return 0
  fi

  if [[ "$HAS_DOCKER" == "true" && "$HAS_DOCKER_DAEMON" == "true" && "$HAS_DOCKER_COMPOSE" != "true" ]]; then
    error "Docker is running but Docker Compose is not available. Install the compose plugin and rerun."
    exit 1
  fi

  if [[ "$HAS_DOCKER" == "true" && "$HAS_DOCKER_DAEMON" == "false" ]]; then
    if [[ "$NO_PROMPT" == "true" ]]; then
      error "Docker CLI is installed but the daemon is not running. Start Docker and rerun."
      exit 1
    fi
    if ask_yes "Docker is installed but not running. Start it now?" yes; then
      if start_docker_daemon && [[ "$HAS_DOCKER_COMPOSE" == "true" ]]; then
        return 0
      fi
      error "Could not start the Docker daemon. Open Docker Desktop / start the service, then rerun."
      exit 1
    else
      error "Docker method needs a running daemon."
      exit 1
    fi
  fi

  if [[ "$NO_PROMPT" == "true" ]]; then
    error "Docker + Compose are required for --method docker. Install Docker and rerun, or pass --method native."
    exit 1
  fi
  if ask_yes "Docker is not installed. Install it now?" yes; then
    install_docker
  else
    error "Cannot continue a Docker install without Docker. Install it from https://docs.docker.com/get-docker/ or choose native."
    exit 1
  fi
}

# ─── Install Method Selection ─────────────────────────────────────────────────

docker_ready() { [[ "$HAS_DOCKER_COMPOSE" == "true" && "$HAS_DOCKER_DAEMON" == "true" ]]; }
native_ready() { [[ "$HAS_BUN" == "true" ]]; }

method_note() {
  case "$1" in
    native)
      if native_ready; then
        echo "Bun ${BUN_VERSION:-ready}"
      else
        echo "Bun not found — can install"
      fi
      ;;
    docker)
      if docker_ready; then
        echo "Compose ready, daemon running"
      elif [[ "$HAS_DOCKER" == "true" && "$HAS_DOCKER_DAEMON" == "false" ]]; then
        echo "CLI found, daemon not running — can start"
      else
        echo "Docker not found — can install"
      fi
      ;;
  esac
}

select_method() {
  step "Selecting install method..."

  if [[ -n "$METHOD" ]]; then
    info "Method forced: $METHOD"
    return
  fi

  local default="native"
  if docker_ready; then
    default="docker"
  elif native_ready; then
    default="native"
  elif [[ "$HAS_DOCKER" == "true" ]]; then
    # CLI present (daemon may just need starting) — prefer Docker.
    default="docker"
  fi

  if [[ "$NO_PROMPT" == "true" ]]; then
    if docker_ready; then
      METHOD="docker"
    elif native_ready; then
      METHOD="native"
    else
      error "Neither Docker (running) nor Bun found. Run interactively to install a runtime, or install one first."
      info "  Docker: https://docs.docker.com/get-docker/"
      info "  Bun:    https://bun.sh"
      exit 1
    fi
    info "Using $METHOD method"
    return
  fi

  local native_mark=" " docker_mark=" "
  [[ "$default" == "native" ]] && native_mark="*"
  [[ "$default" == "docker" ]] && docker_mark="*"

  echo ""
  echo -e "${BOLD}How would you like to install eYssen EYAS?${NC}"
  echo -e "  ${CYAN}1)${NC} native ${DIM}($(method_note native)) ${native_mark}${NC}"
  echo -e "  ${CYAN}2)${NC} docker ${DIM}($(method_note docker)) ${docker_mark}${NC}"
  echo ""
  read_reply "$(echo -e "${DIM}Enter number [default: $default]:${NC} ")"
  case "${REPLY:-}" in
    1) METHOD="native" ;;
    2) METHOD="docker" ;;
    "") METHOD="$default" ;;
    native|docker) METHOD="$REPLY" ;;
    *) METHOD="$default" ;;
  esac
  info "Selected: $METHOD"
}

ensure_method_prereqs() {
  ensure_git
  case "$METHOD" in
    native) ensure_bun ;;
    docker) ensure_docker ;;
    *)
      error "Unknown method: $METHOD"
      exit 1
      ;;
  esac
}

# ─── Interactive Configuration ────────────────────────────────────────────────

configure() {
  step "Configuration"

  if [[ "$NO_PROMPT" == "true" ]]; then
    info "Skipping interactive config (EYAS_NO_PROMPT=true)"
    return
  fi

  echo -e "${DIM}  Admin account, AI provider and agent names are set in the setup wizard${NC}"
  echo -e "${DIM}  after first start. This installer only needs a directory and a port.${NC}"

  ask "Install directory" "$INSTALL_DIR" INSTALL_DIR

  echo ""
  echo -e "${DIM}  Network (UI + API share one port in production):${NC}"
  ask "HTTP port (default 3100 — avoids Grafana/CRA on :3000)" "$CFG_PORT" CFG_PORT
}

# ─── Clone ────────────────────────────────────────────────────────────────────

clone_or_update() {
  if [[ -d "$INSTALL_DIR" && -d "$INSTALL_DIR/.git" ]]; then
    info "Existing installation found — updating to $BRANCH..."
    git -C "$INSTALL_DIR" fetch --tags --force origin
    git -C "$INSTALL_DIR" checkout --force "$BRANCH" || git -C "$INSTALL_DIR" checkout --force "tags/$BRANCH"
  else
    if [[ -e "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" ]]; then
      error "Directory exists but is not a git repo: $INSTALL_DIR"
      exit 1
    fi
    info "Cloning eYssen EYAS @ $BRANCH..."
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

# ─── Generate Configuration ──────────────────────────────────────────────────

generate_config() {
  step "Generating configuration..."

  local config_dir="$INSTALL_DIR/config"
  mkdir -p "$config_dir" "$INSTALL_DIR/data"

  local yaml="$config_dir/local.yaml"
  if [[ -f "$yaml" ]]; then
    info "Keeping existing config/local.yaml"
  else
    cat > "$yaml" <<YAML
# eYssen EYAS local configuration — generated by installer
# Merged over config/default.yaml (see loadResolvedConfig).
server:
  host: "0.0.0.0"
  port: ${CFG_PORT}

log:
  level: "info"
  pretty: true
YAML
    success "Created config/local.yaml (merged over defaults)"
  fi

  local env_file="$INSTALL_DIR/.env"
  if [[ -f "$env_file" ]]; then
    info "Keeping existing .env"
  else
    cat > "$env_file" <<ENV
# eYssen EYAS environment — generated by installer
EYAS_PORT=${CFG_PORT}
ENV
    chmod 600 "$env_file"
    success "Created .env (mode 600)"
  fi

  if [[ -f "$INSTALL_DIR/.gitignore" ]]; then
    if ! grep -qF '.env' "$INSTALL_DIR/.gitignore"; then
      echo '.env' >> "$INSTALL_DIR/.gitignore"
    fi
  fi
}

# ─── Nested JS packages (src/web, packages/docs) ─────────────────────────────
# These have their own package.json + lockfile and are NOT bun workspaces.
# Root `bun install` therefore never installs Vite / @vitejs/plugin-react, and
# `bunx vite build` then dies with: Cannot find package '@vitejs/plugin-react'.

install_nested_package() {
  local dir="$1"
  local label="${2:-$dir}"
  if [[ ! -f "$dir/package.json" ]]; then
    info "No $label package.json — skipping"
    return 0
  fi
  local script="$INSTALL_DIR/scripts/install-nested-package.ts"
  if [[ -f "$script" ]]; then
    info "Installing $label dependencies..."
    if bun "$script" "$dir"; then
      success "$label dependencies ready"
      return 0
    fi
    error "$label: nested install failed"
    return 1
  fi
  info "Installing $label dependencies..."
  if (cd "$dir" && bun install); then
    success "$label dependencies installed"
    return 0
  fi
  warn "$label: bun install failed — retrying without unlinked local packages"
  recover_unlinked_install "$dir" "$label"
}

recover_unlinked_install() {
  local dir="$1"
  local label="$2"
  local pkg="$dir/package.json"
  local lock="$dir/bun.lock"
  local bak lockbak=""
  bak="$(mktemp)"
  cp "$pkg" "$bak"
  if [[ -f "$lock" ]]; then
    lockbak="$(mktemp)"
    cp "$lock" "$lockbak"
  fi
  local rc=1
  if (
    cd "$dir"
    bun -e '
      const p = await Bun.file("package.json").json();
      for (const k of ["dependencies","devDependencies","optionalDependencies","peerDependencies"]) {
        if (!p[k]) continue;
        for (const n of Object.keys(p[k])) {
          if (String(p[k][n]).startsWith("link:")) delete p[k][n];
        }
      }
      await Bun.write("package.json", JSON.stringify(p, null, 2) + "\n");
    ' && bun install
  ); then
    rc=0
    success "$label dependencies installed (skipped unlinked local packages)"
  else
    error "$label: bun install still failed"
  fi
  cp "$bak" "$pkg"
  rm -f "$bak"
  if [[ -n "$lockbak" ]]; then
    cp "$lockbak" "$lock"
    rm -f "$lockbak"
  fi
  return "$rc"
}

build_web() {
  step "Building frontend..."
  if bun run build:web; then
    success "Frontend built"
    return 0
  fi
  warn "Frontend build failed — installing src/web deps and retrying"
  install_nested_package "$INSTALL_DIR/src/web" "frontend" || true
  if bun run build:web; then
    success "Frontend built (after retry)"
    return 0
  fi
  error "Frontend build failed"
  echo -e "  ${DIM}The UI is a nested package at src/web (own package.json + lockfile).${NC}"
  echo -e "  ${DIM}Root bun install does not install Vite or @vitejs/plugin-react.${NC}"
  echo -e "  ${CYAN}cd $INSTALL_DIR/src/web && bun install && cd $INSTALL_DIR && bun run build:web${NC}"
  return 1
}

# ─── Docker Install ──────────────────────────────────────────────────────────

install_via_docker() {
  step "Installing via Docker Compose..."

  clone_or_update
  generate_config

  if [[ "$CFG_PORT" != "3100" ]]; then
    cat > "$INSTALL_DIR/docker-compose.override.yml" <<YAML
# Generated by installer — host port ${CFG_PORT}
services:
  eyas:
    ports:
      - "${CFG_PORT}:3100"
YAML
    success "Created docker-compose.override.yml (host port ${CFG_PORT})"
  fi

  step "Building and starting eYssen EYAS..."
  cd "$INSTALL_DIR"
  export EYAS_PORT="${CFG_PORT}"
  compose up -d --build

  success "eYssen EYAS is starting via Docker!"
}

# ─── Native (Bun) Install ────────────────────────────────────────────────────

install_via_native() {
  step "Installing natively with Bun..."

  clone_or_update
  cd "$INSTALL_DIR"
  generate_config

  step "Installing dependencies..."
  bun install
  success "Dependencies installed"

  install_nested_package "$INSTALL_DIR/src/web" "frontend"
  build_web

  step "Building product docs..."
  if [ -f packages/docs/package.json ]; then
    install_nested_package "$INSTALL_DIR/packages/docs" "docs" \
      && (cd packages/docs && bun run build) \
      && success "Docs built at packages/docs/dist (/docs on the server)" \
      || info "Docs build skipped/failed — server still works; run: bun run docs:build"
  else
    info "No packages/docs — skipping docs build"
  fi

  if ! command_exists eyas; then
    info "To add 'eyas' CLI to your PATH, run:"
    echo -e "  ${CYAN}export PATH=\"$INSTALL_DIR/bin:\$PATH\"${NC}"
    echo -e "  ${DIM}(Add this to your ~/.bashrc or ~/.zshrc for persistence)${NC}"
  fi

  success "Native install ready (not started — use commands below)"
}

# ─── Post-Install Summary ────────────────────────────────────────────────────

print_summary() {
  local url="http://localhost:${CFG_PORT}"

  echo ""
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}${BOLD}  eYssen EYAS installed successfully!${NC}"
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  ${BOLD}Directory:${NC}  $INSTALL_DIR"
  echo -e "  ${BOLD}Method:${NC}     $METHOD"
  echo -e "  ${BOLD}Open:${NC}       ${CYAN}${url}${NC}"
  echo -e "  ${DIM}First launch opens the setup wizard (admin, provider, agents).${NC}"
  echo ""

  if [[ "$METHOD" == "docker" ]]; then
    echo -e "  ${BOLD}Commands:${NC}"
    echo -e "    ${CYAN}cd $INSTALL_DIR${NC}"
    echo -e "    ${CYAN}EYAS_PORT=${CFG_PORT} $COMPOSE_CMD up -d${NC}   ${DIM}# Start${NC}"
    echo -e "    ${CYAN}$COMPOSE_CMD logs -f${NC}                   ${DIM}# Logs${NC}"
    echo -e "    ${CYAN}$COMPOSE_CMD down${NC}                      ${DIM}# Stop${NC}"
    echo -e "    ${CYAN}$COMPOSE_CMD up -d --build${NC}             ${DIM}# Rebuild${NC}"
  else
    echo -e "  ${BOLD}Commands:${NC}"
    echo -e "    ${CYAN}cd $INSTALL_DIR${NC}"
    echo -e "    ${CYAN}set -a && source .env && set +a${NC}"
    echo -e "    ${CYAN}./bin/eyas start${NC}              ${DIM}# Background (production)${NC}"
    echo -e "    ${CYAN}./bin/eyas stop${NC}               ${DIM}# Stop background${NC}"
    echo -e "    ${CYAN}./bin/eyas status${NC}             ${DIM}# Health${NC}"
    echo -e "    ${CYAN}./bin/eyas serve${NC}              ${DIM}# Foreground${NC}"
    echo -e "    ${CYAN}bun run dev${NC}                   ${DIM}# Dev backend + hot reload${NC}"
    echo -e "    ${CYAN}bun run dev:web${NC}               ${DIM}# Dev frontend (Vite :5173)${NC}"
  fi

  echo ""
  echo -e "  ${DIM}Multi-instance: see README — EYAS_HOME / EYAS_PORT / docker compose -p${NC}"
  echo -e "  ${DIM}Docs: https://github.com/eyssen/eyas${NC}"
  echo ""
}

# ─── Main ─────────────────────────────────────────────────────────────────────

main() {
  parse_args "$@"

  print_logo
  info "Git ref: $BRANCH  (use --version TAG to pin a release for backup restore)"

  detect_env
  select_method
  ensure_method_prereqs
  configure

  case "$METHOD" in
    docker) install_via_docker ;;
    native) install_via_native ;;
    *)
      error "Unknown method: $METHOD"
      exit 1
      ;;
  esac

  print_summary
}

main "$@"
