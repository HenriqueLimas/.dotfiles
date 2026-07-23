#!/usr/bin/env bash

set -euo pipefail

herdr_bin=${HERDR_BIN_PATH:-herdr}

exec "$herdr_bin" plugin pane open \
  --plugin hlimas.project-picker \
  --entrypoint picker
