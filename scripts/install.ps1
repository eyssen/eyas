# eYssen EYAS Installer — Windows (PowerShell)
#
# One-liner:
#   powershell -c "irm https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.ps1 | iex"
#
# With options (must invoke as scriptblock so parameters work):
#   powershell -c "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.ps1))) -Yes -Port 3100"
#
# Default ref is main. Use -Version to pin a release (e.g. match a backup).
#
# Interactive install asks native vs Docker even when both runtimes are ready.
# Missing tools (git, Bun, Docker) are offered for install. Admin account, AI
# provider and agent names belong to the web setup wizard, not this script.

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
  powershell -c "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.ps1))) -Yes -Version 0.8.12-beta"

Parameters:
  -Dir PATH              Install directory (default: %USERPROFILE%\eyas)
  -Method docker|native  Install method (interactive default: ask)
  -Port N                HTTP port (default: 3100)
  -Version TAG           Git tag or branch (default: main). Match a backup version.
  -Yes                   Non-interactive defaults
  -Help                  Show this help

Account, AI provider and agent names are collected by the setup wizard
in the browser after first start — not by this installer.

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

function Ask-Yes([string]$Prompt, [bool]$Default = $true) {
    if ($script:NoPrompt) { return $Default }
    $hint = if ($Default) { "Y/n" } else { "y/N" }
    $raw = Read-Host "$Prompt [$hint]"
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
    return $raw -imatch '^(y|yes)$'
}

function Test-DockerDaemon {
    if (-not (Test-Command "docker")) { return $false }
    try {
        docker info 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Install-BunRuntime {
    Write-Info "Installing Bun..."
    $installer = Join-Path $env:TEMP "bun-install.ps1"
    Invoke-WebRequest -UseBasicParsing -Uri "https://bun.sh/install.ps1" -OutFile $installer
    try {
        & $installer
    } finally {
        Remove-Item -Force $installer -ErrorAction SilentlyContinue
    }
    $bunBin = Join-Path $env:USERPROFILE ".bun\bin"
    if (Test-Path $bunBin) {
        $env:PATH = "$bunBin;$env:PATH"
    }
    if (-not (Test-Command "bun")) {
        throw "Bun installation failed — https://bun.sh"
    }
    Write-Ok "bun $(bun --version)"
}

function Start-DockerDesktop {
    $candidates = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Docker\Docker Desktop.exe"
    )
    $exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $exe) { return $false }
    Write-Info "Starting Docker Desktop..."
    Start-Process $exe | Out-Null
    Write-Info "Waiting for Docker daemon (up to 90s)..."
    for ($i = 0; $i -lt 45; $i++) {
        if (Test-DockerDaemon) {
            Write-Ok "Docker daemon is running"
            return $true
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

Write-Host ""
Write-Host "  eYssen EYAS Installer (Windows)" -ForegroundColor Cyan
Write-Host "  Ref: $Branch" -ForegroundColor DarkGray
Write-Host ""

# ── Environment ──────────────────────────────────────────────────────────────

Write-Info "Checking environment..."

$HasGit = Test-Command "git"
if ($HasGit) {
    Write-Ok "git $((git --version) -replace 'git version ','')"
} else {
    Write-Warn "git not found"
}

$HasDocker = $false
$HasCompose = $false
$HasDockerDaemon = $false
if (Test-Command "docker") {
    $HasDocker = $true
    Write-Ok "docker present"
    $HasDockerDaemon = Test-DockerDaemon
    if ($HasDockerDaemon) {
        Write-Ok "Docker daemon is running"
    } else {
        Write-Warn "Docker CLI found, but the daemon is not running"
    }
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
} else {
    Write-Info "Bun not found"
}

# ── Method ───────────────────────────────────────────────────────────────────

$dockerReady = $HasCompose -and $HasDockerDaemon
$nativeReady = $HasBun

if (-not $Method) {
    if ($script:NoPrompt) {
        if ($dockerReady) { $Method = "docker" }
        elseif ($nativeReady) { $Method = "native" }
        else {
            Write-Err "Neither Docker (running) nor Bun found. Run interactively to install a runtime, or install one first."
            Write-Host "  Docker Desktop: https://docs.docker.com/desktop/install/windows-install/"
            Write-Host "  Bun:            https://bun.sh"
            exit 1
        }
        Write-Info "Using $Method method"
    } else {
        $default = if ($dockerReady) { "docker" } elseif ($nativeReady) { "native" } elseif ($HasDocker) { "docker" } else { "native" }
        $nativeNote = if ($nativeReady) { "Bun ready" } else { "Bun not found — can install" }
        $dockerNote = if ($dockerReady) {
            "Compose ready, daemon running"
        } elseif ($HasDocker -and -not $HasDockerDaemon) {
            "CLI found, daemon not running — can start"
        } else {
            "Docker not found — can install"
        }
        Write-Host ""
        Write-Host "How would you like to install eYssen EYAS?"
        Write-Host "  1) native  ($nativeNote)$(if ($default -eq 'native') { ' *' })"
        Write-Host "  2) docker  ($dockerNote)$(if ($default -eq 'docker') { ' *' })"
        $choice = Read-Host "Enter number [default: $default]"
        switch ($choice) {
            "1" { $Method = "native" }
            "2" { $Method = "docker" }
            "native" { $Method = "native" }
            "docker" { $Method = "docker" }
            default { $Method = $default }
        }
        Write-Info "Selected: $Method"
    }
}

if (-not $HasGit) {
    if ($script:NoPrompt) {
        Write-Err "git is required. Install Git for Windows: https://git-scm.com/download/win"
        exit 1
    }
    if (Ask-Yes "git is not installed. Open the Git for Windows download page?" $true) {
        Start-Process "https://git-scm.com/download/win"
        Write-Err "Install git, then rerun this installer."
        exit 1
    }
    Write-Err "git is required."
    exit 1
}

if ($Method -eq "native" -and -not (Test-Command "bun")) {
    if ($script:NoPrompt) {
        Write-Err "Bun required for -Method native — https://bun.sh"
        exit 1
    }
    if (Ask-Yes "Bun is not installed. Install it now?" $true) {
        Install-BunRuntime
        $HasBun = $true
    } else {
        Write-Err "Cannot continue a native install without Bun."
        exit 1
    }
}

if ($Method -eq "docker") {
    if ($HasCompose -and $HasDockerDaemon) {
        # ready
    } elseif ($HasDocker -and -not $HasDockerDaemon) {
        if ($script:NoPrompt) {
            Write-Err "Docker CLI is installed but the daemon is not running. Start Docker Desktop and rerun."
            exit 1
        }
        if (Ask-Yes "Docker is installed but not running. Start Docker Desktop now?" $true) {
            if (-not (Start-DockerDesktop)) {
                Write-Err "Docker Desktop did not become ready. Open it, wait until it is running, then rerun."
                exit 1
            }
            $HasDockerDaemon = $true
            try {
                docker compose version 2>$null | Out-Null
                if ($LASTEXITCODE -eq 0) { $HasCompose = $true }
            } catch { }
        } else {
            Write-Err "Docker method needs a running daemon."
            exit 1
        }
    } else {
        if ($script:NoPrompt) {
            Write-Err "Docker Compose required for -Method docker"
            exit 1
        }
        if (Ask-Yes "Docker is not installed. Open the Docker Desktop download page?" $true) {
            Start-Process "https://docs.docker.com/desktop/install/windows-install/"
            Write-Err "Install Docker Desktop, start it, then rerun this installer."
            exit 1
        }
        Write-Err "Cannot continue a Docker install without Docker."
        exit 1
    }
    if (-not $HasCompose) {
        Write-Err "Docker Compose is not available."
        exit 1
    }
}

# ── Config prompts ───────────────────────────────────────────────────────────

if (-not $script:NoPrompt) {
    Write-Host ""
    Write-Host "  Admin account, AI provider and agent names are set in the setup wizard after first start." -ForegroundColor DarkGray
}

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

$localYaml = Join-Path $configDir "local.yaml"
if (Test-Path $localYaml) {
    Write-Info "Keeping existing config/local.yaml"
} else {
    @"
# eYssen EYAS local configuration — generated by installer
server:
  host: "0.0.0.0"
  port: $Port

log:
  level: "info"
  pretty: true
"@ | Set-Content -Path $localYaml -Encoding utf8
    Write-Ok "Wrote config/local.yaml"
}

$envFile = Join-Path $Dir ".env"
if (Test-Path $envFile) {
    Write-Info "Keeping existing .env"
} else {
    @"
# eYssen EYAS environment — generated by installer
EYAS_PORT=$Port
"@ | Set-Content -Path $envFile -Encoding utf8
    Write-Ok "Wrote .env"
}

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
Write-Host "  First launch opens the setup wizard (admin, provider, agents)." -ForegroundColor DarkGray
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
