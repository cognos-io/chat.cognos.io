#!/bin/sh
set -eu

if [ "${1:-}" != "serve" ]; then
	exec cognos-api "$@"
fi

if [ -z "${COGNOS_BACKEND_UNIX_SOCKET:-}" ]; then
	exec cognos-api "$@" --http="${COGNOS_BACKEND_HTTP_ADDR:-0.0.0.0:8090}"
fi

socket="${COGNOS_BACKEND_UNIX_SOCKET}"
http_addr="${COGNOS_BACKEND_HTTP_ADDR:-127.0.0.1:8090}"

case "$http_addr" in
	0.0.0.0:*) http_addr="127.0.0.1:${http_addr##*:}" ;;
	:*) http_addr="127.0.0.1${http_addr}" ;;
esac

mkdir -p "$(dirname "$socket")"
rm -f "$socket"

cognos-api "$@" --http="$http_addr" &
api_pid="$!"

cleanup() {
	kill "$api_pid" 2>/dev/null || true
	rm -f "$socket"
}
trap cleanup INT TERM EXIT

socat "UNIX-LISTEN:${socket},fork,mode=${COGNOS_BACKEND_UNIX_SOCKET_MODE:-660}" "TCP:${http_addr}" &
socat_pid="$!"

set +e
wait "$api_pid"
status="$?"
kill "$socat_pid" 2>/dev/null || true
exit "$status"
