# Build from the repository root:
#   docker build -f server/Dockerfile -t nghenhac-server .

FROM rust:1-bookworm AS probe
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN printf '[workspace]\nmembers = ["crates/nnpm-audio-core", "crates/nnpm-probe"]\nresolver = "2"\n' > Cargo.toml \
  && cargo build --release -p nnpm-probe

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/tsconfig.json ./
COPY server/src ./src
COPY server/migrations ./migrations
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 app \
  && useradd --system --uid 10001 --gid app --home /tmp --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=probe /src/target/release/nnpm-probe /usr/local/bin/nnpm-probe
RUN mkdir -p /tmp/nghenhac-ingest \
  && chown -R app:app /tmp/nghenhac-ingest \
  && chmod 0755 /usr/local/bin/nnpm-probe
USER app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    COOKIE_SECURE=true \
    TRUST_PROXY_HOPS=1 \
    MEDIA_PROBE_MODE=nnpm \
    NNPM_PROBE_PATH=/usr/local/bin/nnpm-probe \
    WORKER_TEMP_DIR=/tmp/nghenhac-ingest \
    WORKER_HEARTBEAT_PATH=/tmp/nghenhac-ingest/heartbeat
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health/live').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
