#!/usr/bin/env bash

set -euo pipefail

herdr_bin=${HERDR_BIN_PATH:-herdr}
source_pane=${HERDR_ACTIVE_PANE_ID:?HERDR_ACTIVE_PANE_ID is not set}
source_cwd=${HERDR_ACTIVE_PANE_CWD:-$PWD}

split_json=$(
  "$herdr_bin" pane split "$source_pane" \
    --direction right \
    --cwd "$source_cwd" \
    --focus
)

target_pane=$(
  printf '%s' "$split_json" | python3 -c '
import json
import sys
print(json.load(sys.stdin)["result"]["pane"]["pane_id"])
'
)

"$herdr_bin" pane run "$target_pane" "exec hunk diff"
