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

EYAS_LOGO="${CYAN}${BOLD}
        __   __
   ___ \ \_/ /__ ___  ___ _ __
  / -_) \   /(_-<(_-</ -_) _ \\
  \___| |_| /__//__/\___|_//_/

  ███████╗██╗   ██╗ █████╗ ███████╗
  ██╔════╝╚██╗ ██╔╝██╔══██╗██╔════╝
  █████╗   ╚████╔╝ ███████║███████╗
  ██╔══╝    ╚██╔╝  ██╔══██║╚════██║
  ███████╗   ██║   ██║  ██║███████║
  ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝
${NC}${DIM}  eYssen EYAS Installer — v0.8.5-beta${NC}
"

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

# Config defaults (overridden by interactive prompts)
CFG_LANG="en"
CFG_PORT="${EYAS_PORT:-3100}"
CFG_PROVIDER=""
CFG_API_KEY=""
CFG_USERNAME=""
CFG_PASSWORD=""
CFG_AGENT_NAME="Assistant"

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
  --method docker|native Install method (default: auto-detect)
  --port N               HTTP port (default: 3100)
  --version TAG          Git tag or branch (default: main)
                         Match a backup: --version 0.8.5-beta
                         (also: EYAS_VERSION=0.8.5-beta)
  --help                 Show this help

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

is_interactive() {
  # Detect if stdin is a terminal (not piped)
  # When running via `curl | bash`, we reopen /dev/tty for prompts
  [[ -t 0 ]] || [[ -e /dev/tty ]]
}

ask() {
  local prompt="$1" default="$2" var="$3"
  if [[ "$NO_PROMPT" == "true" ]]; then
    eval "$var=\"$default\""
    return
  fi
  local input
  if [[ -t 0 ]]; then
    read -rp "$(echo -e "${BOLD}$prompt${NC} ${DIM}[$default]${NC}: ")" input
  else
    read -rp "$(echo -e "${BOLD}$prompt${NC} ${DIM}[$default]${NC}: ")" input < /dev/tty
  fi
  eval "$var=\"${input:-$default}\""
}

ask_secret() {
  local prompt="$1" var="$2"
  if [[ "$NO_PROMPT" == "true" ]]; then
    eval "$var=\"\""
    return
  fi
  local input
  if [[ -t 0 ]]; then
    read -srp "$(echo -e "${BOLD}$prompt${NC}: ")" input
  else
    read -srp "$(echo -e "${BOLD}$prompt${NC}: ")" input < /dev/tty
  fi
  echo # newline after hidden input
  eval "$var=\"$input\""
}

ask_choice() {
  local prompt="$1" options_str="$2" default="$3" var="$4"
  if [[ "$NO_PROMPT" == "true" ]]; then
    eval "$var=\"$default\""
    return
  fi

  # Split options into array without setting global IFS
  local -a opts
  IFS='|' read -ra opts <<< "$options_str"

  echo -e "\n${BOLD}$prompt${NC}"
  local i=1
  for opt in "${opts[@]}"; do
    local marker=" "
    [[ "$opt" == "$default" ]] && marker="*"
    echo -e "  ${CYAN}$i)${NC} $opt ${DIM}${marker}${NC}"
    ((i++))
  done
  local input
  if [[ -t 0 ]]; then
    read -rp "$(echo -e "${DIM}Enter number [default: $default]:${NC} ")" input
  else
    read -rp "$(echo -e "${DIM}Enter number [default: $default]:${NC} ")" input < /dev/tty
  fi

  if [[ -z "$input" ]]; then
    eval "$var=\"$default\""
    return
  fi

  local idx=1
  for opt in "${opts[@]}"; do
    if [[ "$idx" == "$input" ]]; then
      eval "$var=\"$opt\""
      return
    fi
    ((idx++))
  done
  eval "$var=\"$default\""
}

command_exists() { command -v "$1" &>/dev/null; }

# ─── Environment Detection ───────────────────────────────────────────────────

detect_env() {
  step "Checking environment..."

  OS="$(uname -s)"
  ARCH="$(uname -m)"
  info "System: $OS $ARCH"

  case "$OS" in
    Linux|Darwin) ;;
    MINGW*|MSYS*|CYGWIN*)
      warn "Windows detected — Docker mode recommended"
      ;;
    *)
      error "Unsupported OS: $OS"
      exit 1
      ;;
  esac

  HAS_GIT=false
  HAS_DOCKER=false
  HAS_DOCKER_COMPOSE=false
  HAS_BUN=false
  HAS_NODE=false
  BUN_VERSION=""
  NODE_VERSION=""

  if command_exists git; then
    HAS_GIT=true
    success "git $(git --version | cut -d' ' -f3)"
  else
    error "git is required but not found"
    exit 1
  fi

  if command_exists docker; then
    HAS_DOCKER=true
    success "docker $(docker --version | cut -d' ' -f3 | tr -d ',')"

    if docker compose version &>/dev/null; then
      HAS_DOCKER_COMPOSE=true
      success "docker compose $(docker compose version --short 2>/dev/null || echo 'available')"
    fi
  else
    info "Docker not found"
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

# ─── Install Method Selection ─────────────────────────────────────────────────

select_method() {
  step "Selecting install method..."

  if [[ -n "$METHOD" ]]; then
    info "Method forced via EYAS_METHOD=$METHOD"
    return
  fi

  if [[ "$HAS_DOCKER_COMPOSE" == "true" ]] && [[ "$HAS_BUN" == "true" ]]; then
    ask_choice "How would you like to install eYssen EYAS?" \
      "docker|native" "docker" METHOD
  elif [[ "$HAS_DOCKER_COMPOSE" == "true" ]]; then
    METHOD="docker"
    info "Docker Compose found — using Docker method"
  elif [[ "$HAS_BUN" == "true" ]]; then
    METHOD="native"
    info "Bun found — using native method"
  else
    echo ""
    warn "Neither Docker Compose nor Bun found."
    echo ""
    echo -e "  eYssen EYAS needs one of these:"
    echo -e "  ${CYAN}1)${NC} Docker + Docker Compose ${DIM}(recommended for most users)${NC}"
    echo -e "  ${CYAN}2)${NC} Bun runtime ${DIM}(for developers)${NC}"
    echo ""

    ask_choice "Install Bun automatically, or exit to install Docker?" \
      "install-bun|exit" "install-bun" RUNTIME_CHOICE

    if [[ "$RUNTIME_CHOICE" == "exit" ]]; then
      info "Install Docker: https://docs.docker.com/get-docker/"
      info "  — then rerun this installer."
      exit 0
    fi

    install_bun
    METHOD="native"
  fi
}

install_bun() {
  step "Installing Bun..."
  local bun_installer
  bun_installer="$(mktemp)"
  curl -fsSL https://bun.sh/install -o "$bun_installer"
  # Verify it looks like a shell script before executing
  if ! head -1 "$bun_installer" | grep -qE '^#!/'; then
    rm -f "$bun_installer"
    error "Downloaded Bun installer is not a valid shell script"
    exit 1
  fi
  bash "$bun_installer"
  rm -f "$bun_installer"

  # Source the updated profile so `bun` is available
  export BUN_INSTALL="$HOME/.bun"
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

# ─── Interactive Configuration ────────────────────────────────────────────────

configure() {
  step "Configuration"

  if [[ "$NO_PROMPT" == "true" ]]; then
    info "Skipping interactive config (EYAS_NO_PROMPT=true)"
    return
  fi

  if ! is_interactive; then
    warn "Non-interactive mode — using defaults"
    NO_PROMPT="true"
    return
  fi

  echo -e "${DIM}  Configure your eYssen EYAS instance. Press Enter for defaults.${NC}"

  ask "Install directory" "$INSTALL_DIR" INSTALL_DIR
  ask_choice "Language / Nyelv" "en|hu" "en" CFG_LANG

  echo ""
  echo -e "${DIM}  Network (UI + API share one port in production):${NC}"
  ask "HTTP port (default 3100 — avoids Grafana/CRA on :3000)" "3100" CFG_PORT

  ask_choice "Primary AI provider" \
    "anthropic|openai|google|ollama|skip" "anthropic" CFG_PROVIDER

  if [[ "$CFG_PROVIDER" != "skip" && "$CFG_PROVIDER" != "ollama" ]]; then
    ask_secret "API key for $CFG_PROVIDER" CFG_API_KEY
  fi

  echo ""
  echo -e "${DIM}  Admin account (for web UI login):${NC}"
  ask "Admin username" "admin" CFG_USERNAME

  while true; do
    ask_secret "Admin password (min 8 chars)" CFG_PASSWORD
    if [[ ${#CFG_PASSWORD} -ge 8 ]]; then
      break
    elif [[ -z "$CFG_PASSWORD" ]]; then
      warn "Skipping — you can set this later in the web UI"
      break
    fi
    warn "Password must be at least 8 characters"
  done

  ask "AI assistant name" "Assistant" CFG_AGENT_NAME
}

# ─── Generate Configuration ──────────────────────────────────────────────────

generate_config() {
  step "Generating configuration..."

  local config_dir="$INSTALL_DIR/config"
  mkdir -p "$config_dir" "$INSTALL_DIR/data"

  # local.yaml is merged on top of config/default.yaml at runtime
  cat > "$config_dir/local.yaml" <<YAML
# eYssen EYAS local configuration — generated by installer
# Merged over config/default.yaml (see loadResolvedConfig).
server:
  host: "0.0.0.0"
  port: ${CFG_PORT}

i18n:
  defaultLanguage: "${CFG_LANG}"
  fallbackLanguage: "en"

log:
  level: "info"
  pretty: true
YAML
  success "Created config/local.yaml (merged over defaults)"

  # .env file for secrets and setup
  local env_file="$INSTALL_DIR/.env"
  {
    echo "# eYssen EYAS environment — generated by installer"
    echo "# WARNING: Contains secrets — do not commit to git!"
    echo ""
    echo "EYAS_PORT=${CFG_PORT}"
    echo ""

    if [[ -n "$CFG_USERNAME" && -n "$CFG_PASSWORD" ]]; then
      echo "EYAS_SETUP_USERNAME=${CFG_USERNAME}"
      echo "EYAS_SETUP_PASSWORD=${CFG_PASSWORD}"
    fi

    if [[ -n "$CFG_AGENT_NAME" ]]; then
      echo "EYAS_SETUP_AGENT_NAME=${CFG_AGENT_NAME}"
    fi

    case "$CFG_PROVIDER" in
      anthropic)
        echo "ANTHROPIC_API_KEY=${CFG_API_KEY}"
        ;;
      openai)
        echo "OPENAI_API_KEY=${CFG_API_KEY}"
        ;;
      google)
        echo "GOOGLE_API_KEY=${CFG_API_KEY}"
        ;;
      ollama)
        echo "OLLAMA_HOST=http://localhost:11434"
        ;;
    esac
  } > "$env_file"
  chmod 600 "$env_file"
  success "Created .env (mode 600)"

  # Ensure .env is gitignored
  if [[ -f "$INSTALL_DIR/.gitignore" ]]; then
    if ! grep -qF '.env' "$INSTALL_DIR/.gitignore"; then
      echo '.env' >> "$INSTALL_DIR/.gitignore"
    fi
  fi
}

# ─── Docker Install ──────────────────────────────────────────────────────────

install_docker() {
  step "Installing via Docker Compose..."

  if [[ -d "$INSTALL_DIR" && -d "$INSTALL_DIR/.git" ]]; then
    info "Existing installation found — updating to $BRANCH..."
    git -C "$INSTALL_DIR" fetch --tags --force origin
    git -C "$INSTALL_DIR" checkout --force "$BRANCH" || git -C "$INSTALL_DIR" checkout --force "tags/$BRANCH"
  else
    info "Cloning eYssen EYAS @ $BRANCH..."
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi

  generate_config

  # Host port via EYAS_PORT (compose maps ${EYAS_PORT:-3100}:3100)
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

  local compose_profiles=""
  if [[ "$CFG_PROVIDER" == "ollama" ]]; then
    compose_profiles="--profile gpu"
    info "Ollama profile enabled"
  fi

  export EYAS_PORT="${CFG_PORT}"
  docker compose $compose_profiles up -d --build

  success "eYssen EYAS is starting via Docker!"
}

# ─── Native (Bun) Install ────────────────────────────────────────────────────

install_native() {
  step "Installing natively with Bun..."

  if [[ -d "$INSTALL_DIR" && -d "$INSTALL_DIR/.git" ]]; then
    info "Existing installation found — updating to $BRANCH..."
    git -C "$INSTALL_DIR" fetch --tags --force origin
    git -C "$INSTALL_DIR" checkout --force "$BRANCH" || git -C "$INSTALL_DIR" checkout --force "tags/$BRANCH"
  else
    info "Cloning eYssen EYAS @ $BRANCH..."
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi

  cd "$INSTALL_DIR"

  generate_config

  step "Installing dependencies..."
  bun install
  success "Dependencies installed"

  step "Building frontend..."
  bun run build:web
  success "Frontend built"

  step "Building product docs..."
  if [ -f packages/docs/package.json ]; then
    (cd packages/docs && bun install && bun run build) \
      && success "Docs built at packages/docs/dist (/docs on the server)" \
      || info "Docs build skipped/failed — server still works; run: bun run docs:build"
  else
    info "No packages/docs — skipping docs build"
  fi

  # Add eyas to PATH hint
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
  if [[ -n "$CFG_USERNAME" ]]; then
    echo -e "  ${BOLD}Login:${NC}      ${CFG_USERNAME}"
  fi
  echo ""

  if [[ "$METHOD" == "docker" ]]; then
    echo -e "  ${BOLD}Commands:${NC}"
    echo -e "    ${CYAN}cd $INSTALL_DIR${NC}"
    echo -e "    ${CYAN}EYAS_PORT=${CFG_PORT} docker compose up -d${NC}   ${DIM}# Start${NC}"
    echo -e "    ${CYAN}docker compose logs -f${NC}                   ${DIM}# Logs${NC}"
    echo -e "    ${CYAN}docker compose down${NC}                      ${DIM}# Stop${NC}"
    echo -e "    ${CYAN}docker compose up -d --build${NC}             ${DIM}# Rebuild${NC}"
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

  echo -e "$EYAS_LOGO"
  info "Git ref: $BRANCH  (use --version TAG to pin a release for backup restore)"

  detect_env
  select_method
  configure

  case "$METHOD" in
    docker) install_docker ;;
    native) install_native ;;
    *)
      error "Unknown method: $METHOD"
      exit 1
      ;;
  esac

  print_summary
}

main "$@"
