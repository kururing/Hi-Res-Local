# Vendored FFmpeg (Windows x64, shared)

This directory holds a **GPL shared** FFmpeg build used by the native audio engine
(`ffmpeg-next` + WASAPI Exclusive).

Expected layout:

```
ffmpeg/
  include/   # libavcodec, libavformat, libavutil, libswresample, …
  lib/       # *.lib import libraries
  bin/       # avcodec-*.dll, avformat-*.dll, avutil-*.dll, swresample-*.dll, …
```

## Refresh / install

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/fetch-ffmpeg-windows.ps1
```

`build.rs` copies DLLs next to the cargo binary for `tauri dev` / tests.

Packaged builds bundle `vendor/ffmpeg/bin/*.dll` (flattened to the resource dir / exe dir via `tauri.conf.json`). The process also calls `AddDllDirectory` / `SetDllDirectory` before `ffmpeg::init()` so the loader finds avcodec/avformat/avutil/swresample even when they are not beside the exe.
