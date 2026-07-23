#!/usr/bin/env bash

set -euo pipefail

herdr_bin=${HERDR_BIN_PATH:-herdr}
fzf_bin=${FZF_BIN:-fzf}
python_bin=${PYTHON_BIN:-python3}
github_projects_dir=${HERDR_GITHUB_PROJECTS_DIR:-"$HOME/Development/github"}
ebay_projects_dir=${HERDR_EBAY_PROJECTS_DIR:-"$HOME/Development/ebay"}

for command in "$herdr_bin" "$fzf_bin" "$python_bin" pi; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$command" >&2
    exit 1
  fi
done

list_projects() {
  local root project

  for root in "$github_projects_dir" "$ebay_projects_dir"; do
    [[ -d $root ]] || continue

    while IFS= read -r project; do
      printf '%s/%s\t%s\n' "$(basename "$root")" "$(basename "$project")" "$project"
    done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -print)
  done
}

if ! selected_record=$(
  list_projects \
    | sort -f \
    | "$fzf_bin" \
      --delimiter=$'\t' \
      --with-nth=1 \
      --prompt='Project> ' \
      --layout=reverse \
      --border=rounded \
      --height=100%
); then
  exit 0
fi

[[ -n $selected_record ]] || exit 0
selected=${selected_record#*$'\t'}
[[ -d $selected ]] || {
  printf 'Selected project no longer exists: %s\n' "$selected" >&2
  exit 1
}

panes_json=$("$herdr_bin" pane list)
existing_workspace=$(
  printf '%s' "$panes_json" | "$python_bin" -c '
import json
import os
import sys

target = os.path.realpath(sys.argv[1])
panes = json.load(sys.stdin).get("result", {}).get("panes", [])
for pane in panes:
    cwd = pane.get("cwd")
    if cwd and os.path.realpath(cwd) == target:
        print(pane["workspace_id"])
        break
' "$selected"
)

if [[ -n $existing_workspace ]]; then
  "$herdr_bin" workspace focus "$existing_workspace" >/dev/null
  exit 0
fi

workspace_json=$(
  "$herdr_bin" workspace create \
    --cwd "$selected" \
    --label "$(basename "$selected")" \
    --focus
)

read -r workspace_id pane_id < <(
  printf '%s' "$workspace_json" | "$python_bin" -c '
import json
import sys

result = json.load(sys.stdin).get("result", {})
print(result["workspace"]["workspace_id"], result["root_pane"]["pane_id"])
'
)

agent_name="pi-$(printf '%s' "$selected" | cksum | awk '{print $1}')"
if ! "$herdr_bin" agent start "$agent_name" \
  --kind pi \
  --pane "$pane_id" \
  -- \
  --continue; then
  "$herdr_bin" workspace close "$workspace_id" >/dev/null 2>&1 || true
  printf 'Failed to start Pi in %s\n' "$selected" >&2
  exit 1
fi
