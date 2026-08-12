#!/bin/sh
set -eu

mc alias set aistor "$AISTOR_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
exec mc "$@"
