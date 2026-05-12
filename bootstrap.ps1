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
    exit 0
} else {
    Write-Host "[FAIL] Could not download Node.js."
    Write-Host "Install manually: https://nodejs.org"
    exit 1
}
