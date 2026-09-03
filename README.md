# Nghe Nhạc Pro Max 🎵

Hệ sinh thái nghe nhạc chất lượng cao gồm **Desktop local-first** (Tauri), **Web cloud** (React) và **Cloud API** (Fastify). Desktop tập trung vào phát file local với kiểm soát đường xuất âm thanh trên Windows; Web và Desktop đều có thể đăng nhập tài khoản, dùng catalog cloud, streaming lossless và thư viện đồng bộ qua PostgreSQL.

Ứng dụng được xây dựng bằng **Tauri 2**, **Rust**, **React 19**, **TypeScript**, **Tailwind CSS**, **Fastify**, **PostgreSQL** và **MinIO/S3**.

> Kiến trúc chi tiết: [`ARCHITECTURE.md`](ARCHITECTURE.md). API cloud: [`server/README.md`](server/README.md).

## Tính năng chính

### Phát nhạc chất lượng cao (Desktop)

- Giải mã âm thanh native bằng `nnpm-audio-core`; trên Windows phát qua **WASAPI Shared**, **WASAPI Exclusive (bit-perfect)** hoặc **ASIO** (Native DSD).
- Hỗ trợ các định dạng: MP3, FLAC, WAV, OGG/OGA, AAC, ALAC, M4A, AIFF/AIF, OPUS, WMA, APE, MPC, MKA, DSF và DFF.
- DSF raw, DFF raw DSD và DFF chứa DST được nhận diện với metadata kỹ thuật riêng; DFF/DST đi qua `NdsdSourceAdapter` và FIR DSD→PCM khi chọn DSD → PCM.
- Bốn **chế độ phát nhạc**: Tự động, Chất lượng cao (WASAPI Exclusive bit-perfect), Đa nhiệm (WASAPI Shared), và Nâng cao (tùy chọn backend/DSD thủ công).
- Chọn thiết bị đầu ra âm thanh; chuyển nhanh thiết bị và chế độ phát từ thanh trình phát.
- Phát liền mạch (gapless), chuyển bài crossfade, hàng đợi phát và ghi nhận thời lượng nghe thực tế vào lịch sử.
- Equalizer đồ họa 10 băng tần với preset và cấu hình tùy chỉnh.
- ReplayGain theo track/album, preamp và chống clipping.
- Preset **MQA Passthrough** trong chế độ Nâng cao giữ nguyên payload PCM qua WASAPI Exclusive cho DAC MQA Full Decoder; unity gain và toàn bộ DSP được tự động bỏ qua. Ứng dụng không thực hiện MQA Core Decode.
- Các chế độ phát tuần tự, lặp lại và phát ngẫu nhiên.
- Hiển thị trạng thái engine theo thời gian thực (định dạng nguồn, đầu ra, backend, DoP/Native DSD).
- Tiếp tục phát bài và vị trí đã lưu khi mở lại ứng dụng.

### Quản lý thư viện

- **Desktop:** quét một hoặc nhiều thư mục nhạc, theo dõi thay đổi, lưu metadata và ảnh bìa nhúng trong SQLite local.
- **Cloud:** catalog chung trên PostgreSQL; thư viện, playlist, yêu thích và lịch sử gắn tài khoản.
- **Hybrid (Desktop):** khi đăng nhập, gộp thư viện local và cloud trong cùng giao diện.
- Duyệt theo bài hát, album, nghệ sĩ và thể loại; trang chủ với tiếp tục nghe, mới thêm, nghe gần đây và thống kê thư viện.
- Tìm kiếm gần đúng (Ctrl+K) theo bài hát, album và nghệ sĩ.
- Phát hiện bài trùng lặp khi quét thư viện local (backend gán nhóm trùng lặp theo tiêu đề/nghệ sĩ).
- Yêu thích bài hát, album và nghệ sĩ.
- Lịch sử nghe nhạc.
- Playlist thường, smart playlist, phát ngẫu nhiên theo ngữ cảnh và nhập/xuất M3U (Desktop).
- Xuất/khôi phục bản sao lưu JSON trên Desktop (cài đặt, yêu thích, playlist, lịch sử, preset EQ).

### Cloud, streaming và admin

- Đăng ký, đăng nhập, refresh token qua cookie HttpOnly; access token chỉ nằm trong bộ nhớ trang.
- Streaming lossless/Hi-Res qua signed URL trực tiếp tới MinIO/S3 (HTTP Range); audio bytes không đi qua Fastify.
- Catalog mặc định yêu cầu đăng nhập; admin catalog ingestion chỉ trên Web.
- Worker ingestion dùng `nnpm-probe` để validate audio đã upload; không transcode.
- Tra cứu lời LRCLIB và cache trên server; artwork public bucket riêng với audio bucket private.

### Lời bài hát và giao diện

- Hiển thị lời LRC đồng bộ hoặc lời văn bản thông thường.
- Khi không có lời local, tự tra cứu LRCLIB miễn phí; ưu tiên lời đồng bộ nếu nguồn cung cấp.
- Nhập và lưu lời bài hát; hỗ trợ tạo/nhập lời phiên âm.
- Phiên âm tiếng Nhật, Hàn và Trung ngay trên máy.
- Giao diện tiếng Việt và tiếng Anh.
- Nhiều theme và font; hỗ trợ theme tùy chỉnh từ hình ảnh và màu ảnh bìa bài đang phát.
- Tải và cache ảnh album/nghệ sĩ từ iTunes Search API (không ghi đè ảnh nhúng).
- Danh sách ảo hóa để xử lý thư viện lớn.
- Modal chi tiết bài hát với thông số kỹ thuật file.
- Discord Rich Presence tùy chọn (Desktop).
- Khởi động cùng hệ thống, thu nhỏ xuống khay và tiếp tục phát khi đóng cửa sổ (Desktop).

> Desktop hoạt động local-first: quét thư mục và native audio nằm trên máy bạn. Cloud chỉ kết nối khi đăng nhập hoặc phát streaming. Tra cứu LRCLIB, ảnh bìa iTunes và Discord Rich Presence chỉ dùng mạng khi tính năng tương ứng được bật.

### DSD, DoP và ASIO

- Ba đường phát DSD trong **Nâng cao**: `Native DSD` (ASIO), `DoP` (WASAPI Exclusive) và `DSD → PCM`; PCM là lựa chọn thủ công, không phải fallback ngầm khi Native DSD hoặc DoP thất bại.
- Chế độ Tự động / Chất lượng cao / Đa nhiệm luôn dùng DSD → PCM an toàn; chỉ chế độ Nâng cao mở toàn bộ tùy chọn DSD.
- Native DSD chỉ dành cho Windows. Cầu nối ASIO GPLv3 được biên dịch từ SDK đã được cung cấp trong `src-tauri/vendor/asio-sdk`; ASIO driver tương thích của DAC phải được cài riêng. Ứng dụng không đóng gói driver DAC.
- DoP yêu cầu WASAPI Exclusive và thiết bị/DAC hỗ trợ mức DSD tương ứng; EQ, ReplayGain và crossfade bị tắt tạm thời.
- DFF/DST ở DSD512 vẫn được nhận diện; Native DSD cho DST hiện giới hạn đến DSD256 do decoder DST tích hợp. File không đáp ứng giới hạn này sẽ báo lỗi rõ ràng.
- Khi Native DSD hoạt động, volume ứng dụng phải ở 100% và EQ, ReplayGain, crossfade bị tắt tạm thời; cấu hình được khôi phục khi rời chế độ này.
- File `.dst` độc lập không được nhận diện vì không có metadata container bắt buộc; DST chỉ được hỗ trợ khi nằm trong DFF.

> Nếu không có ASIO driver tương thích, hoặc DAC không hỗ trợ đúng mức DSD, ứng dụng báo lỗi rõ ràng và dừng bài DSD ở Native DSD; không chuyển ngầm sang PCM. Chế độ DSD → PCM hoặc DoP vẫn có thể chọn thủ công trong chế độ Nâng cao.

## Công nghệ

| Thành phần | Stack |
| --- | --- |
| Desktop | Tauri 2, Rust 2021, SQLite (`rusqlite`), CPAL, WASAPI, ASIO bridge |
| Audio engine | `nnpm-audio-core` (Symphonia, Lofty, Rubato, DST), `nnpm-probe` CLI, WASM cho Web |
| Frontend | React 19, TypeScript 5, Vite 6, Tailwind CSS, `PlatformApi` runtime abstraction |
| Cloud API | Fastify, PostgreSQL, MinIO/S3, JWT + HttpOnly cookie |
| Kiểm thử | Vitest (web/server), Rust test, Docker Compose smoke stack |

## Cấu trúc dự án

```text
nghenhacpromax/
├── .github/workflows/ci.yml   # CI: Rust, WASM, web, server, integration
├── infra/                     # Docker Compose: PostgreSQL, MinIO, smoke stack
├── crates/
│   ├── nnpm-audio-core/       # Probe, decode, DSD, MQA detect, DSP graph, WASM
│   └── nnpm-probe/            # CLI metadata JSON cho ingestion worker
├── packages/
│   ├── api-client/            # CloudApiClient TypeScript
│   ├── audio-contracts/       # Hợp đồng audio engine
│   ├── audio-wasm/            # WASM bindings cho browser playback
│   └── shared-types/          # Kiểu dữ liệu dùng chung
├── server/
│   ├── migrations/            # PostgreSQL migrations
│   ├── scripts/               # migrate, grant-role, worker, smoke
│   └── src/                   # auth, catalog, library, ingestion, streaming, admin
├── src-tauri/
│   ├── crates/nnpm-dsd/       # Native DSD helpers
│   ├── src/
│   │   ├── audio/             # Decoder, pipeline, WASAPI, ASIO, DoP, DSD, DSP
│   │   ├── commands/          # IPC giữa giao diện và backend
│   │   ├── db/                # SQLite schema, migration, backup
│   │   ├── lyrics/            # Đọc và xử lý LRC
│   │   ├── scanner/           # Quét thư viện, theo dõi thư mục
│   │   ├── search/            # Tìm kiếm gần đúng
│   │   └── tags/              # Đọc/ghi metadata
│   └── vendor/asio-sdk/       # Steinberg ASIO SDK (GPLv3)
├── web/
│   ├── src/
│   │   ├── admin/             # Upload trực tiếp lên object storage
│   │   ├── api/               # CloudApiClient
│   │   ├── audio/             # Browser / Tauri / Mock engines
│   │   ├── auth/              # AuthSessionController
│   │   ├── components/        # UI, trình phát, auth, admin
│   │   ├── context/           # Trạng thái React
│   │   ├── platform/          # PlatformApi và runtime adapters
│   │   └── services/          # Lời bài hát, artwork, IPC
│   └── Dockerfile
├── scripts/                   # run-tauri, build-audio-wasm, smoke test
├── ARCHITECTURE.md
├── LICENSE
└── package.json
```

## Yêu cầu môi trường

- Node.js 20 trở lên và npm.
- Rust 1.80 trở lên cùng Cargo.
- Công cụ build native theo hướng dẫn của Tauri cho hệ điều hành đang dùng.
- Windows: Microsoft C++ Build Tools và Windows SDK.
- Cloud local: Docker (PostgreSQL + MinIO qua `infra/compose.yml`).

Native DSD/ASIO hiện chỉ được build và sử dụng trên Windows. DAC cần có ASIO driver riêng do nhà sản xuất cung cấp; driver không được phân phối cùng ứng dụng.

Decode PCM/DSD dùng crate `nnpm-audio-core` (Symphonia, Lofty, Rubato, DST Rust). Desktop, web và server đều dùng engine Rust nội bộ. Web load WASM từ `packages/audio-wasm`; rebuild bằng `npm run build:audio-wasm`.

SDK Steinberg ASIO được đặt trong `src-tauri/vendor/asio-sdk/ASIOSDK` và được biên dịch cùng cầu nối Native DSD khi build Windows. Mã nguồn SDK cần thiết được vendor trực tiếp trong repository; file ZIP tải về không được commit. Nếu thư mục SDK bị thiếu, khôi phục từ repository hoặc tải ASIO SDK từ trang nhà phát triển [chính thức của Steinberg](https://www.steinberg.net/developers/) rồi đặt đúng cấu trúc trên. Không cần cài ASIO SDK toàn hệ thống và dự án không phân phối driver ASIO của DAC.

## Cài đặt

Từ thư mục gốc của dự án:

```bash
npm ci
npm --prefix web ci
npm --prefix server ci
```

## Chạy ở chế độ phát triển

### Desktop (Tauri)

```bash
npm run tauri:dev
```

### Web UI (mock preview)

Chỉ chạy giao diện web, không cần backend:

```bash
npm run dev
```

Giao diện Vite mặc định chạy tại `http://localhost:1420`.

`npm run dev` mặc định là **mock preview** (`VITE_APP_RUNTIME=mock`): mở thẳng ứng dụng, không có màn hình đăng nhập cloud.

### Web runtime + cloud backend

1. Sao chép biến môi trường:

```bash
cp web/.env.example web/.env
cp server/.env.example server/.env
```

2. Trong `web/.env` đặt `VITE_APP_RUNTIME=web` (giữ `VITE_CLOUD_API_URL=/api`).
3. Trong `server/.env` giữ `COOKIE_SECURE=false` cho HTTP local, và `CORS_ORIGINS` có origin Vite (`http://localhost:1420`). Cookie production vẫn phải `Secure`.
4. Khởi động PostgreSQL/MinIO, migrate, rồi chạy API và Vite:

```bash
npm run infra:up
npm run server:migrate
npm run server:grant-role -- -- --email you@example.com --role catalog_admin
npm run server:worker
npm run server:dev
npm run dev
```

Admin catalog ingestion chỉ có trên Web; người dùng thường không thấy mục admin. Worker validate audio đã upload bằng `nnpm-probe` và không transcode. Audio bytes không đi qua Fastify — trình duyệt PUT trực tiếp lên MinIO qua presigned URL ngắn hạn. Bucket audio giữ private; artwork dùng bucket public/CDN riêng.

Nếu Docker, PostgreSQL, MinIO hoặc `nnpm-probe` không sẵn sàng, unit test và Fastify fake test vẫn chạy được; ingestion live không được coi là đã verify.

Vite proxy `/api` tới `VITE_CLOUD_API_PROXY_TARGET` (mặc định `http://127.0.0.1:3001`). Trình duyệt gọi `/api/v1/...` same-origin, gửi cookie refresh HttpOnly với `credentials: include`. Access token chỉ nằm trong bộ nhớ trang, không ghi `localStorage`.

Chi tiết API: [`server/README.md`](server/README.md).

## Build bản phát hành

Desktop:

```bash
npm run tauri:build
```

Tauri sẽ build frontend trước, sau đó tạo gói cài đặt phù hợp với hệ điều hành. Sản phẩm build được lưu trong `src-tauri/target/release/bundle`.

Web production build:

```bash
npm run build
```

## Kiểm tra chất lượng

Frontend:

```bash
npm run typecheck
npm run test
npm run build
```

Cloud API:

```bash
npm run server:typecheck
npm run server:test
npm run server:build
```

Backend Rust:

```bash
cd src-tauri
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

Audio core:

```bash
cargo test -p nnpm-audio-core
```

Smoke stack (Docker Compose end-to-end):

```bash
npm run smoke:up
npm run smoke:test
npm run smoke:down
```

Một số test âm thanh/ASIO chỉ chạy đầy đủ trên Windows với phần cứng hoặc driver tương ứng. Native DSD không tự động chuyển sang PCM khi khởi tạo ASIO thất bại; hãy chọn `DSD → PCM` hoặc `DoP` thủ công trong chế độ Nâng cao nếu muốn phát qua thiết bị không có ASIO driver phù hợp.

## Discord Rich Presence

Dự án có sẵn Discord Application ID công khai. Có thể dùng ID khác trong quá trình phát triển hoặc build:

```powershell
$env:NGHENHAC_DISCORD_CLIENT_ID = "your-discord-application-id"
npm run tauri:dev
```

Bật **Hiển thị hoạt động trên Discord** trong phần cài đặt của ứng dụng. Discord cần đang chạy để trạng thái được hiển thị.

## Dữ liệu và quyền riêng tư

- **Desktop:** cơ sở dữ liệu thư viện, cài đặt và cache ảnh bìa được lưu cục bộ; chỉ đọc thư mục nhạc do người dùng chọn.
- **Cloud:** metadata và thư viện người dùng trên PostgreSQL; file audio trên MinIO/S3; streaming qua signed URL có thời hạn.
- Lời phiên âm được xử lý cục bộ trên client.
- Tra cứu ảnh bìa từ xa sử dụng iTunes Search API.
- Discord Rich Presence có thể tắt hoàn toàn trong cài đặt (Desktop).

## License và dependency bên thứ ba

- Nghe Nhạc Pro Max được phát hành theo **GNU General Public License v3.0 only (GPL-3.0-only)**. Xem toàn văn tại [`LICENSE`](LICENSE).
- Decode audio dùng `nnpm-audio-core` (Symphonia, Lofty, Rubato, dst-decoder, mqa-identify). Server probe bằng CLI `nnpm-probe`.
- Cầu nối Native DSD biên dịch Steinberg ASIO SDK theo lựa chọn GPLv3; thông báo và license của SDK nằm trong `src-tauri/vendor/asio-sdk/ASIOSDK`.
- Các dependency và thành phần bên thứ ba vẫn giữ nguyên license, thông báo bản quyền và điều khoản riêng của chúng.
- Danh sách ghi chú bên thứ ba nằm trong [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
