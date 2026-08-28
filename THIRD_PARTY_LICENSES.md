# Third-party license notices

Nghe Nhạc Pro Max is distributed under GPL-3.0-only. The components below
retain their own copyright notices and applicable license terms.

## ASIO SDK

The Windows Native DSD bridge uses the Steinberg ASIO SDK under the GPLv3
licensing option. The SDK source and headers used by the bridge are included
under `src-tauri/vendor/asio-sdk/ASIOSDK`; see its `LICENSE.txt` for the
complete notice and terms. A compatible ASIO driver supplied by the DAC vendor
must still be installed separately. This repository does not bundle DAC
drivers.

The DSD and DST decoders used by the PCM path are provided by the vendored
FFmpeg 9 GPL shared build fetched by `scripts/fetch-ffmpeg-windows.ps1`. See
`src-tauri/vendor/ffmpeg` and the license files distributed with that build.

## dst-decoder

The `dst-decoder` Rust dependency is used to decompress DST frames from DFF
for the Native DSD path. It is distributed under the Apache License 2.0; its
license text is available in Cargo's package source and at the dependency's
upstream project.
