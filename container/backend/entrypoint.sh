#!/bin/sh
set -eu

if [ "${1:-}" != "serve" ]; then
	exec cognos-api "$@"
fi

exec cognos-api "$@" --http="${COGNOS_BACKEND_HTTP_ADDR:-0.0.0.0:8090}"
