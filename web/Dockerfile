FROM node:20-bookworm-slim AS build
WORKDIR /src
COPY packages ./packages
COPY web/package.json web/package-lock.json ./web/
WORKDIR /src/web
RUN npm ci
COPY web .
ARG VITE_APP_RUNTIME=web
ARG VITE_CLOUD_API_URL=/api
ENV VITE_APP_RUNTIME=$VITE_APP_RUNTIME \
    VITE_CLOUD_API_URL=$VITE_CLOUD_API_URL
RUN npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache gettext \
  && addgroup -g 10001 app \
  && adduser -D -u 10001 -G app app
COPY web/nginx.conf /etc/nginx/nginx.conf.template
COPY --from=build /src/web/dist /usr/share/nginx/html
COPY web/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
    && mkdir -p /var/cache/nginx /tmp \
    && chown -R app:app /usr/share/nginx/html /var/cache/nginx /tmp /etc/nginx /docker-entrypoint.sh
USER app
ENV API_UPSTREAM=http://api:3001 \
    ARTWORK_ORIGIN=http://127.0.0.1:9000 \
    MEDIA_ORIGIN=http://127.0.0.1:9000
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/index.html >/dev/null || exit 1
ENTRYPOINT ["/docker-entrypoint.sh"]
