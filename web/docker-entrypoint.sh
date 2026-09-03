#!/bin/sh
set -eu
: "${API_UPSTREAM:=http://api:3001}"
: "${ARTWORK_ORIGIN:=http://127.0.0.1:9000}"
: "${MEDIA_ORIGIN:=http://127.0.0.1:9000}"
envsubst '${API_UPSTREAM} ${ARTWORK_ORIGIN} ${MEDIA_ORIGIN}' \
  < /etc/nginx/nginx.conf.template \
  > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
