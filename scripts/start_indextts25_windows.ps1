[CmdletBinding()]
param(
    [string]$HostAddress = "0.0.0.0",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
[int]$Port = 7864
$existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existingListener) {
    Write-Host "Stopping process $($existingListener.OwningProcess) on dedicated port $Port."
    Stop-Process -Id $existingListener.OwningProcess -Force -ErrorAction Stop
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$studioRoot = Join-Path $projectRoot "product-studio"
$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$bundledPnpm = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
$nodeCandidates = @(
    $env:INDEXTTS_NODE,
    (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    $bundledNode
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
$node = $nodeCandidates | Select-Object -First 1
if (-not $node) { throw "Node.js 24 LTS was not found. Install Node.js 24 LTS or set INDEXTTS_NODE." }
$major = [int]((& $node --version).TrimStart("v").Split(".")[0])
if ($major -lt 24) { throw "Node.js 24 LTS or newer is required. Current: $(& $node --version)" }
$pnpmCandidates = @(
    $env:INDEXTTS_PNPM,
    (Get-Command pnpm.cmd -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    $bundledPnpm
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
$pnpm = $pnpmCandidates | Select-Object -First 1
if (-not $SkipBuild) {
    if (-not $pnpm) { throw "pnpm was not found. Install pnpm or set INDEXTTS_PNPM." }
    $env:PATH = "$(Split-Path -Parent $node);$env:PATH"
    Push-Location $studioRoot
    try {
        & $pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "Frontend dependency installation failed." }
        & $pnpm build
        if ($LASTEXITCODE -ne 0) { throw "Frontend production build failed." }
    }
    finally { Pop-Location }
}
$env:HOST = $HostAddress
$env:PORT = [string]$Port
$env:PYTHONUTF8 = "1"
Set-Location -LiteralPath $studioRoot
& $node "server/index.mjs"
exit $LASTEXITCODE
