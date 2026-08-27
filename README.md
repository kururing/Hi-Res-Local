# Nghe Nhạc Pro Max 🎵

Trình phát nhạc desktop hiệu năng cao, ưu tiên dữ liệu cục bộ và chất lượng âm thanh. Ứng dụng được xây dựng bằng **Tauri 2**, **Rust**, **React 19**, **TypeScript** và **Tailwind CSS**.

## Tính năng chính

### Phát nhạc chất lượng cao

- Giải mã âm thanh native bằng FFmpeg và phát qua CPAL.
- Hỗ trợ các định dạng: MP3, FLAC, WAV, OGG, AAC, ALAC, M4A, AIFF, OPUS, WMA, APE và MPC.
- Chọn thiết bị đầu ra âm thanh.
- WASAPI Exclusive và Bit-Perfect trên Windows.
- Phát liền mạch (gapless), chuyển bài crossfade và hàng đợi phát.
- Equalizer đồ họa 10 băng tần với preset và cấu hình tùy chỉnh.
- ReplayGain theo track/album, preamp và chống clipping.
- Các chế độ phát tuần tự, lặp lại và phát ngẫu nhiên.

### Quản lý thư viện

- Quét một hoặc nhiều thư mục nhạc và tự động theo dõi thay đổi.
- Đọc, chỉnh sửa metadata và ảnh bìa từ file nhạc.
- Duyệt theo bài hát, album, nghệ sĩ và thể loại.
- Tìm kiếm gần đúng, lọc động và phát hiện bài trùng lặp.
- Yêu thích bài hát, album và nghệ sĩ.
- Lịch sử nghe nhạc.
- Playlist thường, smart playlist và nhập/xuất M3U.
- Lưu dữ liệu trong SQLite với migration tự động.
- Sao lưu và khôi phục dữ liệu thư viện.

### Lời bài hát và giao diện

- Hiển thị lời LRC đồng bộ hoặc lời văn bản thông thường.
- Nhập và lưu lời bài hát; hỗ trợ tạo/nhập lời phiên âm.
- Phiên âm tiếng Nhật, Hàn và Trung ngay trên máy.
- Giao diện tiếng Việt và tiếng Anh.
- Nhiều theme và font; hỗ trợ theme tùy chỉnh từ hình ảnh và màu ảnh bìa.
- Danh sách ảo hóa để xử lý thư viện lớn.
- Discord Rich Presence tùy chọn.
- Khởi động cùng hệ thống, thu nhỏ xuống khay và tiếp tục phát khi đóng cửa sổ.

> Ứng dụng hoạt động theo hướng local-first. Dữ liệu thư viện và quá trình phát nhạc nằm trên máy của bạn. Tra cứu ảnh bìa iTunes và Discord Rich Presence chỉ kết nối mạng khi tính năng tương ứng được sử dụng hoặc bật.

## Công nghệ

- **Desktop:** Tauri 2
- **Backend:** Rust 2021, SQLite (`rusqlite`), FFmpeg, CPAL, Lofty, Tokio
- **Frontend:** React 19, TypeScript 5, Vite 6, Tailwind CSS
- **Kiểm thử:** Vitest và Rust test

## Cấu trúc dự án

```text
Hi-Res-Local/
├── src-tauri/
│   ├── src/
│   │   ├── audio/       # Decoder, output, DSP, queue, gapless và WASAPI
│   │   ├── commands/    # Các lệnh IPC giữa giao diện và backend
│   │   ├── db/          # Schema, migration, truy vấn và sao lưu SQLite
│   │   ├── lyrics/      # Đọc và xử lý LRC
│   │   ├── scanner/     # Quét thư viện, theo dõi thư mục và cache ảnh bìa
│   │   ├── search/      # Tìm kiếm gần đúng
│   │   └── tags/        # Đọc và chỉnh sửa metadata
│   ├── vendor/ffmpeg/   # FFmpeg dùng cho bản Windows
│   ├── Cargo.toml
│   └── tauri.conf.json
├── web/
│   ├── src/
│   │   ├── components/  # Giao diện, trình phát, modal và các màn hình
│   │   ├── context/     # Trạng thái thư viện, trình phát, playlist và cài đặt
│   │   ├── i18n/        # Bản dịch tiếng Việt và tiếng Anh
│   │   ├── services/    # IPC, lời bài hát, artwork và tiện ích
│   │   ├── tests/       # Kiểm thử frontend
│   │   └── types/       # Kiểu dữ liệu TypeScript
│   └── package.json
├── scripts/             # Script chạy Tauri và chuẩn bị FFmpeg trên Windows
├── package.json         # Lệnh phát triển ở thư mục gốc
└── README.md
```

## Yêu cầu môi trường

- Node.js 18 trở lên và npm.
- Rust 1.80 trở lên cùng Cargo.
- Công cụ build native theo hướng dẫn của Tauri cho hệ điều hành đang dùng.
- Windows: Microsoft C++ Build Tools và Windows SDK.

Trên Windows, dự án cần FFmpeg shared build trong `src-tauri/vendor/ffmpeg`. Repository hiện đã có cấu trúc vendor; nếu thiếu các thư mục `include`, `lib` hoặc `bin`, chạy:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/fetch-ffmpeg-windows.ps1
```

## Cài đặt

Từ thư mục gốc của dự án:

```bash
npm ci
npm --prefix web ci
```

## Chạy ở chế độ phát triển

Chạy đầy đủ ứng dụng desktop:

```bash
npm run tauri:dev
```

Chỉ chạy giao diện web để phát triển UI:

```bash
npm run dev
```

Giao diện Vite mặc định chạy tại `http://localhost:1420`.

## Build bản phát hành

```bash
npm run tauri:build
```

Tauri sẽ build frontend trước, sau đó tạo gói cài đặt phù hợp với hệ điều hành. Sản phẩm build được lưu trong `src-tauri/target/release/bundle`.

## Kiểm tra chất lượng

Frontend:

```bash
npm run typecheck
npm run test
npm run build
```

Backend Rust:

```bash
cd src-tauri
cargo fmt --check
cargo check
cargo test
```

## Discord Rich Presence

Dự án có sẵn Discord Application ID công khai. Có thể dùng ID khác trong quá trình phát triển hoặc build:

```powershell
$env:NGHENHAC_DISCORD_CLIENT_ID = "your-discord-application-id"
npm run tauri:dev
```

Bật **Hiển thị hoạt động trên Discord** trong phần cài đặt của ứng dụng. Discord cần đang chạy để trạng thái được hiển thị.

## Dữ liệu và quyền riêng tư

- Cơ sở dữ liệu, cài đặt và cache ảnh bìa được lưu cục bộ.
- Ứng dụng chỉ đọc các thư mục nhạc do người dùng chọn.
- Lời phiên âm được xử lý cục bộ.
- Tra cứu ảnh bìa từ xa sử dụng iTunes Search API.
- Discord Rich Presence có thể tắt hoàn toàn trong cài đặt.
