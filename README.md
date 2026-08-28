# Nghe Nhạc Pro Max 🎵

Trình phát nhạc desktop local-first dành cho thư viện nhạc cá nhân, tập trung vào chất lượng âm thanh và khả năng kiểm soát đường xuất trên Windows. Ứng dụng được xây dựng bằng **Tauri 2**, **Rust**, **React 19**, **TypeScript** và **Tailwind CSS**.

## Tính năng chính

### Phát nhạc chất lượng cao

- Giải mã âm thanh native bằng FFmpeg; trên Windows phát qua **WASAPI Shared**, **WASAPI Exclusive (bit-perfect)** hoặc **ASIO** (Native DSD).
- Hỗ trợ các định dạng: MP3, FLAC, WAV, OGG/OGA, AAC, ALAC, M4A, AIFF/AIF, OPUS, WMA, APE, MPC, MKA, DSF và DFF.
- DSF raw, DFF raw DSD và DFF chứa DST được nhận diện với metadata kỹ thuật riêng; DFF/DST được giải mã qua decoder DSD/DST của FFmpeg khi chọn DSD → PCM.
- Bốn **chế độ phát nhạc**: Tự động, Chất lượng cao (WASAPI Exclusive bit-perfect), Đa nhiệm (WASAPI Shared), và Nâng cao (tùy chọn backend/DSD thủ công).
- Chọn thiết bị đầu ra âm thanh; chuyển nhanh thiết bị và chế độ phát từ thanh trình phát.
- Phát liền mạch (gapless), chuyển bài crossfade, hàng đợi phát và ghi nhận thời lượng nghe thực tế vào lịch sử.
- Equalizer đồ họa 10 băng tần với preset và cấu hình tùy chỉnh.
- ReplayGain theo track/album, preamp và chống clipping.
- Các chế độ phát tuần tự, lặp lại và phát ngẫu nhiên.
- Hiển thị trạng thái engine theo thời gian thực (định dạng nguồn, đầu ra, backend, DoP/Native DSD).
- Tiếp tục phát bài và vị trí đã lưu khi mở lại ứng dụng.

### Quản lý thư viện

- Quét một hoặc nhiều thư mục nhạc và tự động theo dõi thay đổi.
- Đọc metadata và ảnh bìa nhúng từ file nhạc khi quét thư viện.
- Duyệt theo bài hát, album, nghệ sĩ và thể loại; trang chủ với tiếp tục nghe, mới thêm, nghe gần đây và thống kê thư viện.
- Tìm kiếm gần đúng (Ctrl+K) theo bài hát, album và nghệ sĩ.
- Phát hiện bài trùng lặp khi quét thư viện (backend gán nhóm trùng lặp theo tiêu đề/nghệ sĩ).
- Yêu thích bài hát, album và nghệ sĩ.
- Lịch sử nghe nhạc.
- Playlist thường, smart playlist, phát ngẫu nhiên theo ngữ cảnh và nhập/xuất M3U.
- Lưu dữ liệu thư viện trong SQLite với migration tự động.
- Xuất/khôi phục bản sao lưu JSON (cài đặt, yêu thích, playlist, lịch sử, preset EQ).

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
- Discord Rich Presence tùy chọn.
- Khởi động cùng hệ thống, thu nhỏ xuống khay và tiếp tục phát khi đóng cửa sổ.

> Ứng dụng hoạt động theo hướng local-first. Dữ liệu thư viện và quá trình phát nhạc nằm trên máy của bạn. Tra cứu lời bài hát LRCLIB, ảnh bìa iTunes và Discord Rich Presence chỉ kết nối mạng khi tính năng tương ứng được sử dụng hoặc bật.

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

- **Desktop:** Tauri 2
- **Backend:** Rust 2021, SQLite (`rusqlite`), FFmpeg, CPAL, WASAPI, ASIO bridge, Lofty, Tokio
- **Frontend:** React 19, TypeScript 5, Vite 6, Tailwind CSS
- **Kiểm thử:** Vitest và Rust test

## Cấu trúc dự án

```text
nghenhacpromax/
├── src-tauri/
│   ├── src/
│   │   ├── audio/       # Decoder, pipeline, WASAPI, ASIO, DoP, DSD, queue, gapless, DSP
│   │   ├── commands/    # Các lệnh IPC giữa giao diện và backend
│   │   ├── db/          # Schema, migration, truy vấn và sao lưu SQLite
│   │   ├── lyrics/      # Đọc và xử lý LRC
│   │   ├── scanner/     # Quét thư viện, theo dõi thư mục và cache ảnh bìa
│   │   ├── search/      # Tìm kiếm gần đúng
│   │   └── tags/        # Đọc và ghi metadata (API backend)
│   ├── vendor/ffmpeg/   # FFmpeg dùng cho bản Windows
│   ├── vendor/asio-sdk/ # Steinberg ASIO SDK, build theo GPLv3
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
├── LICENSE              # GNU General Public License v3.0
├── package.json         # Lệnh phát triển ở thư mục gốc
└── README.md
```

## Yêu cầu môi trường

- Node.js 18 trở lên và npm.
- Rust 1.80 trở lên cùng Cargo.
- Công cụ build native theo hướng dẫn của Tauri cho hệ điều hành đang dùng.
- Windows: Microsoft C++ Build Tools và Windows SDK.

Native DSD/ASIO hiện chỉ được build và sử dụng trên Windows. DAC cần có ASIO
driver riêng do nhà sản xuất cung cấp; driver không được phân phối cùng ứng dụng.

Trên Windows, dự án cần FFmpeg 9 shared build trong `src-tauri/vendor/ffmpeg`. Các thư mục nhị phân `include`, `lib` và `bin` không được commit; chạy script sau để tải đúng bản GPL shared mà dự án đang dùng:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/fetch-ffmpeg-windows.ps1
```

SDK Steinberg ASIO được đặt trong `src-tauri/vendor/asio-sdk/ASIOSDK` và được
biên dịch cùng cầu nối Native DSD khi build Windows. Mã nguồn SDK cần thiết được
vendor trực tiếp trong repository; file ZIP tải về không được commit. Nếu thư mục
SDK bị thiếu, khôi phục từ repository hoặc tải ASIO SDK từ trang nhà phát triển
[chính thức của Steinberg](https://www.steinberg.net/developers/) rồi đặt đúng
cấu trúc trên. Không cần cài ASIO SDK toàn hệ thống và dự án không phân phối
driver ASIO của DAC.

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
cargo test
cargo clippy --all-targets -- -D warnings
```

Các test cần FFmpeg shared build và một số test âm thanh/ASIO chỉ có thể chạy
đầy đủ trên Windows với phần cứng hoặc driver tương ứng. Native DSD không tự
động chuyển sang PCM khi khởi tạo ASIO thất bại; hãy chọn `DSD → PCM` hoặc `DoP`
thủ công trong chế độ Nâng cao nếu muốn phát qua thiết bị không có ASIO driver phù hợp.

## Discord Rich Presence

Dự án có sẵn Discord Application ID công khai. Có thể dùng ID khác trong quá trình phát triển hoặc build:

```powershell
$env:NGHENHAC_DISCORD_CLIENT_ID = "your-discord-application-id"
npm run tauri:dev
```

Bật **Hiển thị hoạt động trên Discord** trong phần cài đặt của ứng dụng. Discord cần đang chạy để trạng thái được hiển thị.

## Dữ liệu và quyền riêng tư

- Cơ sở dữ liệu thư viện, cài đặt và cache ảnh bìa được lưu cục bộ.
- Ứng dụng chỉ đọc các thư mục nhạc do người dùng chọn.
- Lời phiên âm được xử lý cục bộ.
- Tra cứu ảnh bìa từ xa sử dụng iTunes Search API.
- Discord Rich Presence có thể tắt hoàn toàn trong cài đặt.

## License và dependency bên thứ ba

- Nghe Nhạc Pro Max được phát hành theo **GNU General Public License v3.0 only
  (GPL-3.0-only)**. Xem toàn văn tại [`LICENSE`](LICENSE).
- Bản Windows hiện dùng FFmpeg 9 GPL shared được tải bởi
  `scripts/fetch-ffmpeg-windows.ps1` và liên kết với ứng dụng khi build.
- Cầu nối Native DSD biên dịch Steinberg ASIO SDK theo lựa chọn GPLv3; thông báo
  và license của SDK nằm trong `src-tauri/vendor/asio-sdk/ASIOSDK`.
- Các dependency và thành phần bên thứ ba vẫn giữ nguyên license, thông báo bản
  quyền và điều khoản riêng của chúng.
- Danh sách ghi chú bên thứ ba nằm trong
  [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
