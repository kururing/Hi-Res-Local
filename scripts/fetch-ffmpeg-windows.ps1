# Fetches a Windows x64 FFmpeg 9.0 GPL shared build into src-tauri/vendor/ffmpeg.
# Run from repo root:  powershell -ExecutionPolicy Bypass -File scripts/fetch-ffmpeg-windows.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Vendor = Join-Path $Root "src-tauri\vendor\ffmpeg"
$Tmp = Join-Path $Root "src-tauri\vendor\ffmpeg-download-tmp"
$Zip = Join-Path $Root "src-tauri\vendor\ffmpeg-download.zip"

# BtbN autobuild — FFmpeg 9.0 shared (matches ffmpeg-next 9.x). Update URL when bumping.
$Url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-24-13-10/ffmpeg-n9.0.1-6-g9d4ca21220-win64-gpl-shared-9.0.zip"

Write-Host "Downloading FFmpeg shared build..."
Write-Host $Url
New-Item -ItemType Directory -Force -Path (Split-Path $Zip) | Out-Null
Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing

if (Test-Path $Tmp) { Remove-Item $Tmp -Recurse -Force }
Expand-Archive -Path $Zip -DestinationPath $Tmp -Force

$Src = Get-ChildItem $Tmp -Directory | Select-Object -First 1
if (-not $Src) { throw "Unexpected archive layout" }

if (Test-Path $Vendor) { Remove-Item $Vendor -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Vendor | Out-Null
Copy-Item (Join-Path $Src.FullName "include") (Join-Path $Vendor "include") -Recurse
Copy-Item (Join-Path $Src.FullName "lib") (Join-Path $Vendor "lib") -Recurse
Copy-Item (Join-Path $Src.FullName "bin") (Join-Path $Vendor "bin") -Recurse

Remove-Item $Tmp -Recurse -Force
Remove-Item $Zip -Force

Write-Host "Vendored FFmpeg at $Vendor"
Get-ChildItem (Join-Path $Vendor "bin\*.dll") | ForEach-Object { Write-Host "  $($_.Name)" }
