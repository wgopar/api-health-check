#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="api-health-check"
ENV_FILE="${1:-.env.development}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file '$ENV_FILE' not found."
  exit 1
fi

docker build -t "$IMAGE_NAME" .
docker run --rm --env-file "$ENV_FILE" -p 8787:8787 "$IMAGE_NAME"
