# Fetches a Windows x64 FFmpeg 9.0 GPL shared build into src-tauri/vendor/ffmpeg.
# Run from repo root:  powershell -ExecutionPolicy Bypass -File scripts/fetch-ffmpeg-windows.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Vendor = Join-Path $Root "src-tauri\vendor\ffmpeg"
$Tmp = Join-Path $Root "src-tauri\vendor\ffmpeg-download-tmp"
$Stage = Join-Path $Root "src-tauri\vendor\ffmpeg-staged"
$Zip = Join-Path $Root "src-tauri\vendor\ffmpeg-download.zip"

# BtbN autobuild — FFmpeg 9.0 shared (matches ffmpeg-next 9.x). Update URL when bumping.
$Url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-24-13-10/ffmpeg-n9.0.1-6-g9d4ca21220-win64-gpl-shared-9.0.zip"
$ReleaseApi = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/autobuild-2026-08-24-13-10"

Write-Host "Downloading FFmpeg shared build..."
Write-Host $Url
New-Item -ItemType Directory -Force -Path (Split-Path $Zip) | Out-Null
Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing
$assetName = [System.IO.Path]::GetFileName($Url)
$release = Invoke-RestMethod -Uri $ReleaseApi -UseBasicParsing
$asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
if (-not $asset -or -not $asset.digest -or -not $asset.digest.StartsWith('sha256:')) {
    throw "GitHub release did not provide a SHA-256 digest for $assetName"
}
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Zip).Hash.ToLowerInvariant()
$expectedHash = $asset.digest.Substring(7).ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
    throw "FFmpeg archive SHA-256 mismatch: expected $expectedHash, got $actualHash"
}
Write-Host "Verified FFmpeg SHA-256: $actualHash"

if (Test-Path $Tmp) { Remove-Item $Tmp -Recurse -Force }
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
Expand-Archive -Path $Zip -DestinationPath $Tmp -Force

$Src = Get-ChildItem $Tmp -Directory | Select-Object -First 1
if (-not $Src) { throw "Unexpected archive layout" }

New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Copy-Item (Join-Path $Src.FullName "include") (Join-Path $Stage "include") -Recurse
Copy-Item (Join-Path $Src.FullName "lib") (Join-Path $Stage "lib") -Recurse
Copy-Item (Join-Path $Src.FullName "bin") (Join-Path $Stage "bin") -Recurse
$licenseFiles = Get-ChildItem $Src.FullName -File -Include "LICENSE*","COPYING*" -Recurse
foreach ($license in $licenseFiles) { Copy-Item $license.FullName (Join-Path $Stage $license.Name) -Force }
if (-not (Get-ChildItem (Join-Path $Stage "bin\*.dll") -ErrorAction SilentlyContinue)) { throw "FFmpeg archive did not contain shared DLLs" }
if (Test-Path $Vendor) { Remove-Item $Vendor -Recurse -Force }
Move-Item $Stage $Vendor

Remove-Item $Tmp -Recurse -Force
Remove-Item $Zip -Force

Write-Host "Vendored FFmpeg at $Vendor"
Get-ChildItem (Join-Path $Vendor "bin\*.dll") | ForEach-Object { Write-Host "  $($_.Name)" }
