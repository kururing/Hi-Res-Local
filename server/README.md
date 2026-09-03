# Nghe Nhac Pro Max — Cloud API

Backend độc lập (Fastify + PostgreSQL + MinIO) cho tài khoản, catalog, thư viện cloud, playlist, favorites, history, lyrics cache, và signed streaming URL.

Catalog **mặc định yêu cầu authentication** (`CATALOG_PUBLIC=false`). Streaming **luôn** yêu cầu authentication. Backend không decode, normalize hay transcode audio — signed URL trỏ thẳng object gốc trên S3-compatible storage (HTTP Range do MinIO/S3 phục vụ).

## Cài dependency

Từ root repo:

```bash
npm --prefix server install
```

Sao chép biến môi trường:

```bash
cp server/.env.example server/.env
```

Đổi `JWT_SECRET` trước khi dùng ngoài máy local.

## Hạ tầng local (PostgreSQL + MinIO)

```bash
npm run infra:up
npm run server:migrate
npm run server:grant-role -- -- --email you@example.com --role catalog_admin
npm run server:worker
npm run server:dev
npm run dev
```

`server:worker` requires `nnpm-probe` on PATH (or `NNPM_PROBE_PATH`) unless `MEDIA_PROBE_MODE=fake` and `NODE_ENV=test`. Missing probe logs `NNPM_PROBE_MISSING` and exits non-zero; the worker does not fall back to a fake probe, claim jobs, or mark assets ready. Use `npm run server:worker -- -- --once` for a single batch.

Grant/revoke are local CLI commands only. There is no public role-management API. Role checks are read from PostgreSQL on every admin request, so revoke is immediate.

```bash
npm run infra:up
```

Postgres publish ra `127.0.0.1:5433`. MinIO API `9000`, console `9001`. Dừng:

```bash
npm run infra:down
```

## Migration

```bash
npm --prefix server run migrate
```

Catalog bắt đầu trống sau migrate. Đăng ký tài khoản rồi grant `catalog_admin` cho email của bạn trước khi import nhạc.

## Chạy server

```bash
npm run server:dev
```

- API: `http://127.0.0.1:3001`
- OpenAPI UI: `http://127.0.0.1:3001/docs`
- OpenAPI JSON: `http://127.0.0.1:3001/docs/openapi.json`
- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`

## Tests và build

```bash
npm run server:typecheck
npm run server:test
npm run server:build
```

Integration tests cần PostgreSQL. Nếu không kết nối được, unit tests vẫn chạy; các test integration bị skip và in lý do (host/port). `S3_COMPATIBILITY=minio` (mặc định local) bỏ qua `PutBucketCors` khi MinIO trả NotImplemented và dựa vào CORS global của server. `S3_COMPATIBILITY=aws` luôn yêu cầu per-bucket CORS.

CI đặt cả ba flag bắt buộc:

```bash
INTEGRATION_TESTS_REQUIRED=true S3_INTEGRATION_REQUIRED=true NNPM_PROBE_REQUIRED=true npm run server:test
```

## Cấu trúc

```text
server/src/
  app.ts server.ts
  config/ plugins/ auth/ users/   (users gộp trong auth/me)
  catalog/ library/ playlists/ favorites/ history/ lyrics/
  streaming/ storage/ admin/ rbac/ ingestion/
  db/ errors/ health/ http/ logging/
server/migrations/
server/scripts/
server/tests/
infra/compose.yml
```

Route chỉ xử lý HTTP. Service xử lý nghiệp vụ. Repository truy vấn PostgreSQL. `ObjectStorageSigner` ký URL (S3 production, fake trong test).

## Endpoint matrix

| Method | Path | Auth | Response | Ghi chú |
| --- | --- | --- | --- | --- |
| POST | `/v1/auth/register` | No | session | Cookie refresh HttpOnly |
| POST | `/v1/auth/login` | No | session | |
| POST | `/v1/auth/refresh` | Cookie | session | Rotate refresh |
| POST | `/v1/auth/logout` | Cookie | 204 | Revoke session hiện tại |
| GET | `/v1/me` | Bearer | user | |
| PATCH | `/v1/me` | Bearer | user | `display_name` |
| GET | `/v1/catalog/search` | Bearer* | page | Cursor pagination |
| GET | `/v1/catalog/tracks/:id` | Bearer* | `Track` | User-aware nếu đã auth |
| GET | `/v1/catalog/albums/:id` | Bearer* | `Album` | |
| GET | `/v1/catalog/artists/:id` | Bearer* | `Artist` | |
| GET | `/v1/catalog/albums/:id/tracks` | Bearer* | `Track[]` | |
| GET | `/v1/catalog/artists/:id/albums` | Bearer* | `Album[]` | tracks rỗng |
| GET | `/v1/library/tracks` | Bearer | `Track[]` | Khớp `WebLibraryApi` |
| GET | `/v1/library/stats` | Bearer | `LibraryStats` | |
| GET | `/v1/library/roots` | Bearer | `[]` | |
| PUT | `/v1/library/tracks/:trackId` | Bearer | 204 | Idempotent |
| DELETE | `/v1/library/tracks/:trackId` | Bearer | 204 | Idempotent |
| GET | `/v1/library/changes` | Bearer | page | Cursor sync |
| GET | `/v1/playlists` | Bearer | `BackendPlaylist[]` | Array trực tiếp |
| POST | `/v1/playlists` | Bearer | `BackendPlaylist` | |
| GET | `/v1/playlists/:id` | Bearer | `{ playlist, tracks }` | |
| PATCH | `/v1/playlists/:id` | Bearer | `BackendPlaylist` | Chỉ field có mặt |
| DELETE | `/v1/playlists/:id` | Bearer | `boolean` | |
| POST | `/v1/playlists/:id/tracks` | Bearer | `number` | Số track thực sự thêm |
| DELETE | `/v1/playlists/:id/tracks` | Bearer | `number` | Số track thực sự xóa |
| PUT | `/v1/playlists/:id/order` | Bearer | 204 | Membership phải khớp exact |
| PUT | `/v1/favorites/tracks/:id` | Bearer | 204 | Idempotent |
| DELETE | `/v1/favorites/tracks/:id` | Bearer | 204 | Idempotent |
| GET | `/v1/favorites/albums` | Bearer | `{ album_title, artist_name }[]` | |
| PUT | `/v1/favorites/albums` | Bearer | 204 | Resolve tên → catalog ID |
| DELETE | `/v1/favorites/albums` | Bearer | 204 | |
| GET | `/v1/favorites/artists` | Bearer | `string[]` | |
| PUT | `/v1/favorites/artists` | Bearer | 204 | |
| DELETE | `/v1/favorites/artists` | Bearer | 204 | |
| GET | `/v1/history` | Bearer | `PlayHistoryEntry[]` | `limit`/`offset`, newest first |
| POST | `/v1/history` | Bearer | `PlayHistoryEntry` | Idempotency-Key + body |
| DELETE | `/v1/history` | Bearer | `number` | Số row đã xóa |
| GET | `/v1/tracks/:trackId/lyrics` | Bearer | lyrics | Cache only, không gọi provider |
| POST | `/v1/lyrics/resolve` | Bearer | lyrics | Cache rồi provider |
| GET/PUT | `/v1/me/preferences` | Bearer | preferences | Allowlist + revision |
| POST | `/v1/tracks/:trackId/stream` | Bearer | signed URL | 1–5 phút |
| GET | `/health/live` | No | `{ status }` | |
| GET | `/health/ready` | No | `{ status }` | |
| GET | `/docs` | No* | UI | Tắt mặc định khi `NODE_ENV=production` |

\* Catalog mặc định yêu cầu auth (`CATALOG_PUBLIC=false`). Nếu public, token hợp lệ vẫn gắn user state lên `Track`.

Response domain trả primitive/array trực tiếp, không bọc `{ data }`. Lỗi vẫn dùng envelope `{ code, message, request_id }`.

## Smart playlist

Server **chỉ lưu** `is_smart` và `rules_json`. Không evaluate rule, không materialize membership từ rule. `track_count` / `total_duration_ms` lấy từ `playlist_tracks` đã lưu.

## Favorite name resolution

Album/artist favorite dùng identity catalog (UUID). Request hiện gửi tên:

- Normalize: trim, collapse whitespace, lowercase
- 0 match → `404 FAVORITE_NOT_FOUND`
- \>1 match → `409 FAVORITE_AMBIGUOUS` (không chọn ngẫu nhiên)
- Gần tên (`Twin Peak` vs `Twin Peak Ensemble`) không khớp

Favorite track không tự favorite album/artist. Unfavorite không xóa catalog.

## History idempotency

`Idempotency-Key` header và/hoặc `client_request_id` body. Nếu cả hai có mặt phải khớp, không thì `400 HISTORY_IDEMPOTENCY_MISMATCH`. Retry cùng key trả entry cũ, không insert thêm, không tăng `play_count`.

`play_count` / `last_played` / `last_played_at` **tính trực tiếp từ `play_history`** (JOIN khi map `Track`). Clear history trong transaction; lần đọc sau ra 0.

Duration không âm; upper bound = duration track + tolerance nhỏ. `fully_played` không được dùng để bypass.

Track unavailable vẫn giữ entry; `track` có thể là `null`.

## Lyrics cache / provider

- `GET /v1/tracks/:id/lyrics` chỉ đọc cache còn hạn. Không gọi provider. Miss/expired/`not_found` → `404 LYRICS_NOT_FOUND`
- `POST /v1/lyrics/resolve` mới được gọi provider. Metadata catalog thắng title/artist/album/duration client khi `track_id` hợp lệ
- URL provider cố định từ `LYRICS_PROVIDER_URL` (mặc định `https://lrclib.net`). Không SSRF từ input
- Positive TTL (`found` / `instrumental`) dài hơn negative TTL (`not_found`)
- Timeout / 5xx / response quá lớn **không** được cache thành `not_found`
- Concurrent resolve dùng transaction advisory lock theo `track_id`

## Cách chạy integration tests

Integration tests cần PostgreSQL. Nếu không kết nối được, unit tests và Fastify tests với fake service vẫn chạy; suite integration bị skip và in lý do (host/port). Để fail khi thiếu DB:

```bash
REQUIRE_INTEGRATION=1 npm run server:test
```

CI GitHub Actions (`.github/workflows/ci.yml`) chạy typecheck, test, migrate, integration Postgres/MinIO/`nnpm-probe`, E2E smoke và build container. Flag bắt buộc:

```bash
INTEGRATION_TESTS_REQUIRED=true S3_INTEGRATION_REQUIRED=true NNPM_PROBE_REQUIRED=true npm run server:test
```

## Refresh cookie

- `HttpOnly`, `Secure` (tắt trên local HTTP), `SameSite` từ env
- Path `/v1/auth`
- Rotate mỗi lần refresh; token cũ bị revoke
- Reuse sau rotate → revoke cả family
- Endpoint cookie bắt buộc `Origin` nằm trong CORS allowlist

## Asset selection

Xem `src/streaming/assetSelector.ts`. Tóm tắt:

- `max`: fidelity cao nhất (lossless trước, rồi sample rate × bit depth × channels)
- `lossless`: chỉ lossless, không fallback
- `high`: lossy ≥ 256 kbps, không thì CD lossless (≤ 48 kHz, ≤ 16-bit). Không chọn hi-res. Không có thì lỗi
- `auto`: lossless ≤ 48 kHz, không thì lossy bitrate cao nhất, không thì `max`

Không đổi bit depth / sample rate. Object gốc được ký nguyên vẹn.
