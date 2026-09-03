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

The DSD and DST readers used by the PCM path come from `nnpm-audio-core`
(`ndsd-read` Apache-2.0, in-tree DSF/DFF parser, and optional `dst-decoder`).
Native DST decompression can use `ndsd-read/dstdec` (GPL, C++) when the
`dst-native` feature is enabled.

## dst-decoder

The `dst-decoder` Rust dependency is used to decompress DST frames from DFF
for the Native DSD path. It is distributed under the Apache License 2.0; its
license text is available in Cargo's package source and at the dependency's
upstream project.

## nnpm-audio-core dependencies

- **symphonia** — PCM decode (MPL-2.0 / similar; see crate)
- **lofty** — tags and embedded artwork
- **rubato** — DSP resampling
- **mqa-identify** — MQA bitstream magic-word detection (MIT). Detection only; this app does not include licensed MQA Core decode.
- **ndsd-read** — DSD container read (Apache-2.0)
