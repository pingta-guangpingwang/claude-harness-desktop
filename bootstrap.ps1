# Bootstrap: download bundled Node.js if not present
$nodeVersion = "22.19.0"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeDir = Join-Path $scriptDir "nodejs"
$nodeExe = Join-Path $nodeDir "node.exe"
$npmCli = Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js"
$nodeZip = Join-Path $nodeDir "node-v$nodeVersion-win-x64.zip"
$extractedDir = Join-Path $nodeDir "node-v$nodeVersion-win-x64"

if ((Test-Path $nodeExe) -and (Test-Path $npmCli)) {
    Write-Host "[OK] Bundled Node.js v$nodeVersion found."
    exit 0
}

if (Test-Path $nodeExe) {
    Write-Host "[WARN] Node.js found but npm incomplete — re-downloading..."
} else {
    Write-Host "[1/4] Bundled Node.js not found - downloading v$nodeVersion..."
}

if (-not (Test-Path $nodeDir)) {
    New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
}

# Clean up leftovers from previous failed attempts
if (Test-Path $nodeZip) { Remove-Item $nodeZip -Force }
if (Test-Path $extractedDir) { Remove-Item $extractedDir -Recurse -Force }
if ((Test-Path $nodeExe) -and (-not (Test-Path $npmCli))) {
    Write-Host "Cleaning up broken npm installation..."
    $brokenNpm = Join-Path $nodeDir "node_modules\npm"
    if (Test-Path $brokenNpm) { Remove-Item $brokenNpm -Recurse -Force }
}

$urlOfficial = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip"
$urlMirror = "https://npmmirror.com/dist/node/v$nodeVersion/node-v$nodeVersion-win-x64.zip"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

# Try official first, fallback to mirror
$downloaded = $false
Write-Host "Trying official source: nodejs.org ..."
try {
    Invoke-WebRequest -Uri $urlOfficial -OutFile $nodeZip -TimeoutSec 120
    Write-Host "Official source OK."
    $downloaded = $true
} catch {
    Write-Host "Official source failed - switching to npmmirror..."
    try {
        Invoke-WebRequest -Uri $urlMirror -OutFile $nodeZip -TimeoutSec 120
        Write-Host "Mirror OK."
        $downloaded = $true
    } catch {
        Write-Host "Mirror also failed: $_"
    }
}

if ($downloaded -and (Test-Path $nodeZip)) {
    Write-Host "Extracting..."
    Expand-Archive -Path $nodeZip -DestinationPath $nodeDir -Force
    if (Test-Path $extractedDir) {
        Copy-Item (Join-Path $extractedDir '*') -Destination $nodeDir -Recurse -Force
        Remove-Item $extractedDir -Recurse -Force
    }
    Remove-Item $nodeZip -Force
}

if (Test-Path $nodeExe) {
    Write-Host "[OK] Node.js v$nodeVersion ready."
} else {
    Write-Host "[FAIL] Could not download Node.js."
    Write-Host "Install manually: https://nodejs.org"
    exit 1
}

# Check / install Claude Code CLI
$env:Path = "$nodeDir;$env:Path"
$claudeExe1 = Join-Path $nodeDir "node_modules\@anthropic-ai\claude-code\bin\claude.exe"
$claudeCmd1 = Join-Path $nodeDir "claude.cmd"
$globalNpmDir = Join-Path $env:APPDATA "npm"
$globalClaudeExe = Join-Path $globalNpmDir "node_modules\@anthropic-ai\claude-code\bin\claude.exe"
$globalClaudeCmd = Join-Path $globalNpmDir "claude.cmd"
$globalClaudeJs  = Join-Path $globalNpmDir "claude"

if ((Test-Path $claudeExe1) -or (Test-Path $claudeCmd1) -or (Test-Path $globalClaudeExe) -or (Test-Path $globalClaudeCmd) -or (Test-Path $globalClaudeJs)) {
    Write-Host "[OK] Claude Code CLI found."
    exit 0
}

# Also check PATH
$whereClaude = Get-Command claude -ErrorAction SilentlyContinue
if ($whereClaude) {
    Write-Host "[OK] Claude Code CLI found in PATH: $($whereClaude.Source)"
    exit 0
}

Write-Host ""
Write-Host "Claude Code CLI not found - installing..."
Write-Host ""

$npmCliJs = Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js"
$installArgs = @($npmCliJs, "install", "-g", "@anthropic-ai/claude-code", "--registry=https://registry.npmmirror.com")

# Try mirror first for speed in China, fall back to default
$proc = Start-Process -FilePath $nodeExe -ArgumentList $installArgs -NoNewWindow -Wait -PassThru
if ($proc.ExitCode -ne 0) {
    Write-Host "Mirror failed, trying default registry..."
    $installArgs = @($npmCliJs, "install", "-g", "@anthropic-ai/claude-code")
    $proc = Start-Process -FilePath $nodeExe -ArgumentList $installArgs -NoNewWindow -Wait -PassThru
}

if ((Test-Path $claudeExe1) -or (Test-Path $claudeCmd1) -or (Test-Path $globalClaudeExe)) {
    Write-Host "[OK] Claude Code CLI installed."
} else {
    Write-Host "[WARN] Claude Code CLI install may have failed."
    Write-Host "You can install manually: npm install -g @anthropic-ai/claude-code"
}
exit 0
