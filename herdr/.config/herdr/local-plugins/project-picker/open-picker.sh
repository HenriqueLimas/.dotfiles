#!/usr/bin/env bash

set -euo pipefail

herdr_bin=${HERDR_BIN_PATH:-herdr}
entrypoint=${1:-picker}

exec "$herdr_bin" plugin pane open \
  --plugin hlimas.project-picker \
  --entrypoint "$entrypoint"
