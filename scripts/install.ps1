# eYssen EYAS Installer — Windows (PowerShell)
#
# One-liner:
#   powershell -c "irm https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.ps1 | iex"
#
# With options (must invoke as scriptblock so parameters work):
#   powershell -c "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.ps1))) -Yes -Port 3100"
#
# Default ref is main. Use -Version to pin a release (e.g. match a backup).

[CmdletBinding()]
param(
    [string]$Dir = "",
    [ValidateSet("", "docker", "native")]
    [string]$Method = "",
    [int]$Port = 0,
    # Git tag or branch — e.g. 0.8.5-beta, v0.8.5-beta, main
    [string]$Version = "",
    [switch]$Yes,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/eyssen/eyas.git"
$DefaultPort = 3100

function Write-Info([string]$Message) { Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "[OK]   $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Err([string]$Message) { Write-Host "[ERROR] $Message" -ForegroundColor Red }

function Normalize-GitRef([string]$Ref) {
    if ([string]::IsNullOrWhiteSpace($Ref)) { return "main" }
    if ($Ref -in @("main", "master", "develop")) { return $Ref }
    if ($Ref.StartsWith("v") -or $Ref.StartsWith("origin/") -or $Ref.StartsWith("tags/")) { return $Ref }
    if ($Ref -match '^[0-9]') { return "v$Ref" }
    return $Ref
}

function Show-Help {
    @"
eYssen EYAS installer (Windows)

One-liner:
  powershell -c "irm https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.ps1 | iex"

With options:
  powershell -c "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.ps1))) -Yes -Version 0.8.9-beta"

Parameters:
  -Dir PATH              Install directory (default: %USERPROFILE%\eyas)
  -Method docker|native  Install method (default: auto — Docker preferred)
  -Port N                HTTP port (default: 3100)
  -Version TAG           Git tag or branch (default: main). Match a backup version.
  -Yes                   Non-interactive defaults
  -Help                  Show this help

Env: EYAS_DIR, EYAS_METHOD, EYAS_PORT, EYAS_VERSION / EYAS_BRANCH, EYAS_NO_PROMPT=true
"@ | Write-Host
}

if ($Help) {
    Show-Help
    return
}

# Resolve defaults from env / params
if (-not $Dir) {
    $Dir = if ($env:EYAS_DIR) { $env:EYAS_DIR } else { Join-Path $HOME "eyas" }
}
if (-not $Method -and $env:EYAS_METHOD) {
    $Method = $env:EYAS_METHOD
}
if ($Port -le 0) {
    if ($env:EYAS_PORT) { $Port = [int]$env:EYAS_PORT } else { $Port = $DefaultPort }
}
if (-not $Version) {
    if ($env:EYAS_VERSION) { $Version = $env:EYAS_VERSION }
    elseif ($env:EYAS_BRANCH) { $Version = $env:EYAS_BRANCH }
    else { $Version = "main" }
}
$Branch = Normalize-GitRef $Version
if ($Yes -or $env:EYAS_NO_PROMPT -eq "true") {
    $script:NoPrompt = $true
} else {
    $script:NoPrompt = $false
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ask-Value([string]$Prompt, [string]$Default) {
    if ($script:NoPrompt) { return $Default }
    $raw = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
    return $raw
}

Write-Host ""
Write-Host "  eYssen EYAS Installer (Windows)" -ForegroundColor Cyan
Write-Host "  Ref: $Branch" -ForegroundColor DarkGray
Write-Host ""

# ── Environment ──────────────────────────────────────────────────────────────

Write-Info "Checking environment..."

if (-not (Test-Command "git")) {
    Write-Err "git is required. Install Git for Windows: https://git-scm.com/download/win"
    exit 1
}
Write-Ok "git $((git --version) -replace 'git version ','')"

$HasDocker = $false
$HasCompose = $false
if (Test-Command "docker") {
    $HasDocker = $true
    Write-Ok "docker present"
    try {
        docker compose version 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $HasCompose = $true
            Write-Ok "docker compose present"
        }
    } catch { }
} else {
    Write-Info "Docker not found"
}

$HasBun = $false
if (Test-Command "bun") {
    $HasBun = $true
    Write-Ok "bun $(bun --version)"
}

# ── Method ───────────────────────────────────────────────────────────────────

if (-not $Method) {
    if ($HasCompose) {
        $Method = "docker"
        Write-Info "Using Docker method"
    } elseif ($HasBun) {
        $Method = "native"
        Write-Info "Using native (Bun) method"
    } else {
        Write-Warn "Neither Docker Compose nor Bun found."
        Write-Host "  Install Docker Desktop (recommended): https://docs.docker.com/desktop/install/windows-install/"
        Write-Host "  Or install Bun: https://bun.sh"
        exit 1
    }
}

if ($Method -eq "docker" -and -not $HasCompose) {
    Write-Err "Docker Compose required for -Method docker"
    exit 1
}
if ($Method -eq "native" -and -not $HasBun) {
    Write-Err "Bun required for -Method native — https://bun.sh"
    exit 1
}

# ── Config prompts ───────────────────────────────────────────────────────────

$Dir = Ask-Value "Install directory" $Dir
$Port = [int](Ask-Value "HTTP port" "$Port")

# ── Clone ────────────────────────────────────────────────────────────────────

Write-Info "Installing into $Dir (ref $Branch)..."

if (Test-Path (Join-Path $Dir ".git")) {
    Write-Info "Existing install — updating to $Branch..."
    git -C $Dir fetch --tags --force origin
    git -C $Dir checkout --force $Branch
    if ($LASTEXITCODE -ne 0) {
        git -C $Dir checkout --force "tags/$Branch"
        if ($LASTEXITCODE -ne 0) { throw "git checkout $Branch failed" }
    }
} else {
    if (Test-Path $Dir) {
        Write-Err "Directory exists but is not a git repo: $Dir"
        exit 1
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $Dir -Parent) | Out-Null
    git clone --depth 1 --branch $Branch $RepoUrl $Dir
    if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
}

# ── local.yaml + .env ────────────────────────────────────────────────────────

$configDir = Join-Path $Dir "config"
$dataDir = Join-Path $Dir "data"
New-Item -ItemType Directory -Force -Path $configDir, $dataDir | Out-Null

@"
# eYssen EYAS local configuration — generated by installer
server:
  host: "0.0.0.0"
  port: $Port

i18n:
  defaultLanguage: "en"
  fallbackLanguage: "en"

log:
  level: "info"
  pretty: true
"@ | Set-Content -Path (Join-Path $configDir "local.yaml") -Encoding utf8

@"
# eYssen EYAS environment — generated by installer
EYAS_PORT=$Port
"@ | Set-Content -Path (Join-Path $Dir ".env") -Encoding utf8

Write-Ok "Wrote config/local.yaml and .env"

# ── Install ──────────────────────────────────────────────────────────────────

Push-Location $Dir
try {
    if ($Method -eq "docker") {
        Write-Info "Building and starting with Docker Compose..."
        $env:EYAS_PORT = "$Port"
        docker compose up -d --build
        if ($LASTEXITCODE -ne 0) { throw "docker compose failed" }
        Write-Ok "EYAS is starting via Docker"
    } else {
        Write-Info "Installing dependencies (bun install)..."
        bun install
        if ($LASTEXITCODE -ne 0) { throw "bun install failed" }
        Write-Info "Building frontend..."
        bun run build:web
        if ($LASTEXITCODE -ne 0) { throw "build:web failed" }
        Write-Ok "Native install ready"
    }
} finally {
    Pop-Location
}

# ── Summary ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  EYAS installed successfully!" -ForegroundColor Green
Write-Host "  Directory: $Dir"
Write-Host "  Method:    $Method"
Write-Host "  Open:      http://localhost:$Port"
Write-Host ""
if ($Method -eq "docker") {
    Write-Host "  Start:  cd `"$Dir`"; `$env:EYAS_PORT=$Port; docker compose up -d"
    Write-Host "  Stop:   cd `"$Dir`"; docker compose down"
    Write-Host "  Logs:   cd `"$Dir`"; docker compose logs -f"
} else {
    Write-Host "  Start:  cd `"$Dir`"; .\bin\eyas start"
    Write-Host "  Stop:   cd `"$Dir`"; .\bin\eyas stop"
    Write-Host "  Status: cd `"$Dir`"; .\bin\eyas status"
}
Write-Host ""
Write-Host "  Docs: https://github.com/eyssen/eyas" -ForegroundColor DarkGray
Write-Host ""
