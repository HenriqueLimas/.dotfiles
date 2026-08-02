#!/usr/bin/env python3
"""Interactive Herdr workspace manager backed by GitHub and git worktrees."""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from email.utils import getaddresses
from pathlib import Path
from typing import Any, Iterable, Sequence
from urllib.parse import urlparse


HERDR = os.environ.get("HERDR_BIN_PATH", "herdr")
FZF = os.environ.get("FZF_BIN", "fzf")
GH = os.environ.get("GH_BIN", "gh")
GIT = os.environ.get("GIT_BIN", "git")
GPG = os.environ.get("GPG_BIN", "gpg")
PI_COMMAND = os.environ.get("HERDR_WORKSPACE_COMMAND", "pi --continue")
INSTALL_COMMAND = os.environ.get("HERDR_INSTALL_COMMAND", "ni")
REPOSITORY_CACHE_VERSION = 2
GITHUB_AUTHOR_NAME = "HenriqueLimas"
GITHUB_AUTHOR_EMAIL = "henrique.ramos.limas@gmail.com"


class Cancelled(Exception):
    """The user cancelled an interactive step."""


class WorkspaceError(Exception):
    """An expected, user-facing workspace error."""


@dataclass(frozen=True)
class Host:
    key: str
    label: str
    hostname: str
    root: Path
    public_repos_only: bool


@dataclass(frozen=True)
class WorktreeRecord:
    """A repository worktree that can be opened or copied into a new one."""

    host: Host
    path: Path
    source: Path
    repo: dict[str, Any]
    branch: str


def hosts() -> tuple[Host, Host]:
    return (
        Host(
            key="github",
            label="GitHub",
            hostname="github.com",
            root=Path(
                os.environ.get(
                    "HERDR_GITHUB_PROJECTS_DIR", "~/Development/github"
                )
            ).expanduser(),
            public_repos_only=True,
        ),
        Host(
            key="ebay",
            label="eBay",
            hostname=os.environ.get(
                "HERDR_EBAY_GITHUB_HOST", "github.corp.ebay.com"
            ),
            root=Path(
                os.environ.get("HERDR_EBAY_PROJECTS_DIR", "~/Development/ebay")
            ).expanduser(),
            public_repos_only=False,
        ),
    )


def state_root() -> Path:
    configured = os.environ.get("HERDR_WORKSPACE_STATE_DIR")
    if configured:
        return Path(configured).expanduser()
    plugin_state = os.environ.get("HERDR_PLUGIN_STATE_DIR")
    if plugin_state:
        return Path(plugin_state)
    return Path("~/.local/state/herdr/workspace-manager").expanduser()


def run(
    args: Sequence[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    check: bool = True,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        list(args),
        cwd=cwd,
        env=env,
        input=input_text,
        text=True,
        capture_output=True,
    )
    if check and completed.returncode:
        detail = completed.stderr.strip() or completed.stdout.strip()
        command = shlex.join(args)
        raise WorkspaceError(detail or f"Command failed: {command}")
    return completed


def require_commands(*commands: str) -> None:
    missing = [
        command
        for command in commands
        if shutil.which(command) is None
    ]
    if missing:
        raise WorkspaceError(
            "Required command(s) not found: " + ", ".join(missing)
        )


def clean_field(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def fzf_select(
    rows: Sequence[tuple[str, str]],
    *,
    prompt: str,
    header: str = "",
    multi: bool = False,
) -> list[str]:
    _, selected = fzf_select_event(
        rows,
        prompt=prompt,
        header=header,
        multi=multi,
    )
    return selected


def fzf_select_event(
    rows: Sequence[tuple[str, str]],
    *,
    prompt: str,
    header: str = "",
    multi: bool = False,
    expect: Sequence[str] = (),
) -> tuple[str, list[str]]:
    if not rows:
        raise WorkspaceError("Nothing is available for this action.")
    options = [
        FZF,
        "--delimiter=\t",
        "--with-nth=1",
        f"--prompt={prompt}",
        "--layout=reverse",
        "--border=rounded",
        "--height=100%",
        "--no-hscroll",
    ]
    if header:
        options.append(f"--header={header}")
    if multi:
        options.extend(("--multi", "--bind=tab:toggle+down"))
    if expect:
        options.append(f"--expect={','.join(expect)}")
    payload = "".join(f"{label}\t{key}\n" for label, key in rows)
    # Keep stderr attached to the popup TTY: fzf draws its UI there while
    # stdin carries candidates and stdout returns the selected record.
    selected = subprocess.run(
        options,
        input=payload,
        text=True,
        stdout=subprocess.PIPE,
    )
    if selected.returncode != 0 or not selected.stdout:
        raise Cancelled
    lines = selected.stdout.splitlines()
    pressed = ""
    if expect:
        pressed = lines.pop(0) if lines else ""
    if not lines:
        raise Cancelled
    return pressed, [line.rsplit("\t", 1)[-1] for line in lines]


def choose_one(
    rows: Sequence[tuple[str, str]], *, prompt: str, header: str = ""
) -> str:
    return fzf_select(rows, prompt=prompt, header=header)[0]


def choose_one_event(
    rows: Sequence[tuple[str, str]],
    *,
    prompt: str,
    header: str = "",
    expect: Sequence[str] = (),
) -> tuple[str, str]:
    pressed, selected = fzf_select_event(
        rows,
        prompt=prompt,
        header=header,
        expect=expect,
    )
    return pressed, selected[0]


def fzf_worktree_select_event(
    rows: Sequence[tuple[str, str, str]],
    *,
    prompt: str,
    header: str = "",
) -> tuple[str, str]:
    """Select a worktree without restarting fzf when its action changes."""

    if not rows:
        raise WorkspaceError("Nothing is available for this action.")

    options = [
        FZF,
        "--delimiter=\t",
        "--with-nth=1",
        "--id-nth=3",
        "--track",
        "--no-sort",
        f"--prompt={prompt}",
        "--layout=reverse",
        "--border=rounded",
        "--height=100%",
        "--no-hscroll",
    ]
    if header:
        options.append(f"--header={header}")

    with tempfile.TemporaryDirectory(prefix="herdr-picker-") as directory:
        temporary = Path(directory)
        state_path = temporary / "actions"
        candidates_path = temporary / "candidates"
        awk_path = temporary / "render.awk"
        state_path.write_text("", encoding="utf-8")
        candidates_path.write_text(
            "".join(
                f"{open_label}\t{new_label}\t{key}\n"
                for open_label, new_label, key in rows
            ),
            encoding="utf-8",
        )
        awk_path.write_text(
            """BEGIN {
    while ((getline line < state) > 0) {
        split(line, fields, "\\t")
        actions[fields[1]] = fields[2]
    }
    close(state)
}
{
    label = actions[$3] == "new" ? $2 : $1
    print label, $2, $3
}
""",
            encoding="utf-8",
        )
        quoted_state = shlex.quote(str(state_path))
        quoted_candidates = shlex.quote(str(candidates_path))
        quoted_awk = shlex.quote(str(awk_path))
        render = (
            "awk -F '\\t' -v OFS='\\t' "
            f"-v state={quoted_state} -f {quoted_awk} {quoted_candidates}"
        )
        bindings = []
        for key, action in (("left", "open"), ("right", "new")):
            update = (
                f"printf '%s\\t{action}\\n' {{3}} >> {quoted_state}"
            )
            bindings.append(
                f"{key}:execute-silent({update})+reload-sync({render})"
            )
        options.append(f"--bind={','.join(bindings)}")

        selected = subprocess.run(
            options,
            input=candidates_path.read_text(encoding="utf-8"),
            text=True,
            stdout=subprocess.PIPE,
        )
        if selected.returncode != 0 or not selected.stdout:
            raise Cancelled
        selected_key = selected.stdout.splitlines()[-1].rsplit("\t", 1)[-1]
        actions = {}
        for line in state_path.read_text(encoding="utf-8").splitlines():
            key, separator, action = line.partition("\t")
            if separator:
                actions[key] = action
        return selected_key, actions.get(selected_key, "open")


def prompt_text(prompt: str, *, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        value = input(f"{prompt}{suffix}: ").strip()
    except EOFError as error:
        raise Cancelled from error
    value = value or default
    if not value:
        raise Cancelled
    return value


def pause(message: str) -> None:
    print(f"\n{message}")
    try:
        input("\nPress Enter to continue...")
    except EOFError:
        pass


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", name.strip()).strip("-._")
    if not slug:
        raise WorkspaceError("Workspace name must contain a letter or number.")
    return slug


def repo_dir_name(full_name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "--", full_name).strip("-._")


def suggested_workspace_name(repos: Sequence[dict[str, Any]]) -> str:
    branch = next(
        (str(repo["branch"]) for repo in repos if repo.get("branch")),
        "",
    )
    if branch:
        return branch
    names = [
        str(repo["full_name"]).rsplit("/", 1)[-1]
        for repo in repos
        if repo.get("full_name")
    ]
    return "-".join(dict.fromkeys(names)) or "workspace"


def flatten_pages(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        flattened: list[dict[str, Any]] = []
        for item in value:
            if isinstance(item, list):
                flattened.extend(
                    entry for entry in item if isinstance(entry, dict)
                )
            elif isinstance(item, dict):
                flattened.append(item)
        return flattened
    return []


def repository_cache_path(host: Host) -> Path:
    return state_root() / "repository-cache" / f"{host.key}.json"


def read_repository_cache(host: Host) -> list[dict[str, Any]] | None:
    path = repository_cache_path(host)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if (
        not isinstance(value, dict)
        or value.get("version") != REPOSITORY_CACHE_VERSION
        or not isinstance(value.get("repos"), list)
    ):
        return None
    repos = value["repos"]
    if not all(
        isinstance(repo, dict) and repo.get("full_name") for repo in repos
    ):
        return None
    return repos


def write_repository_cache(host: Host, repos: Sequence[dict[str, Any]]) -> None:
    destination = repository_cache_path(host)
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(
                {
                    "version": REPOSITORY_CACHE_VERSION,
                    "repos": list(repos),
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        temporary.replace(destination)
    except OSError:
        # A read-only state directory should not prevent workspace creation.
        pass


def selection_history_path() -> Path:
    return state_root() / "selection-history.json"


def load_selection_history() -> dict[str, float]:
    try:
        value = json.loads(
            selection_history_path().read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(value, dict):
        return {}
    return {
        str(key): float(score)
        for key, score in value.items()
        if isinstance(score, (int, float))
    }


def mark_recent(history: dict[str, float], key: str) -> None:
    history[key] = time.time()
    destination = selection_history_path()
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(history, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary.replace(destination)
    except OSError:
        pass


def recent_sort_key(
    history: dict[str, float], key: str, alphabetical: str
) -> tuple[float, str]:
    return (-history.get(key, 0.0), alphabetical.lower())


def parse_gpg_secret_keys(
    output: str, email: str, *, now: float | None = None
) -> list[dict[str, Any]]:
    current_time = time.time() if now is None else now
    keys: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    def field(fields: Sequence[str], index: int) -> str:
        return fields[index] if len(fields) > index else ""

    def finish_current() -> None:
        if current is None or not current["fingerprint"]:
            return
        addresses = {
            address.casefold()
            for _, address in getaddresses(current["uids"])
            if address
        }
        if (
            email.casefold() in addresses
            and current["has_active_signing_key"]
        ):
            keys.append(current)

    for line in output.splitlines():
        fields = line.split(":")
        record_type = field(fields, 0)
        if record_type == "sec":
            finish_current()
            current = {
                "fingerprint": "",
                "key_id": field(fields, 4),
                "created": field(fields, 5),
                "expires": field(fields, 6),
                "uids": [],
                "has_active_signing_key": False,
            }
        if current is None:
            continue
        if record_type == "fpr" and not current["fingerprint"]:
            current["fingerprint"] = field(fields, 9)
        elif record_type == "uid":
            uid = clean_field(field(fields, 9))
            if uid:
                current["uids"].append(uid)
        if record_type not in {"sec", "ssb"}:
            continue
        validity = field(fields, 1)
        expires = field(fields, 6)
        capabilities = field(fields, 11)
        is_expired = expires.isdigit() and int(expires) <= current_time
        if (
            validity not in {"d", "e", "r"}
            and not is_expired
            and "s" in capabilities.casefold()
            and "D" not in capabilities
        ):
            current["has_active_signing_key"] = True

    finish_current()
    return keys


def gpg_secret_keys(email: str) -> list[dict[str, Any]]:
    completed = run(
        [
            GPG,
            "--batch",
            "--with-colons",
            "--fingerprint",
            "--list-secret-keys",
            email,
        ]
    )
    return parse_gpg_secret_keys(completed.stdout, email)


def gpg_key_label(key: dict[str, Any], email: str) -> str:
    matching_uid = next(
        (
            uid
            for uid in key["uids"]
            if email.casefold()
            in {
                address.casefold()
                for _, address in getaddresses([uid])
                if address
            }
        ),
        email,
    )
    key_id = key["key_id"] or key["fingerprint"][-16:]
    created = (
        time.strftime("%Y-%m-%d", time.localtime(int(key["created"])))
        if str(key["created"]).isdigit()
        else "unknown"
    )
    expiry = (
        time.strftime("%Y-%m-%d", time.localtime(int(key["expires"])))
        if str(key["expires"]).isdigit()
        else "never"
    )
    return f"{matching_uid}  [{key_id}]  created {created}, expires {expiry}"


def choose_gpg_signing_key(email: str) -> str:
    keys = gpg_secret_keys(email)
    if not keys:
        raise WorkspaceError(
            f"No usable secret GPG signing keys found for {email}."
        )
    return choose_one(
        [
            (gpg_key_label(key, email), str(key["fingerprint"]))
            for key in keys
        ],
        prompt="GPG signing key> ",
        header=f"Select the commit-signing key for {email}",
    )


def fetch_host_repos(host: Host) -> list[dict[str, Any]]:
    visibility = "public" if host.public_repos_only else "all"
    endpoint = (
        "/user/repos?affiliation=owner,collaborator,organization_member"
        f"&visibility={visibility}&sort=updated&per_page=100"
    )
    completed = run(
        [
            GH,
            "api",
            "--hostname",
            host.hostname,
            "--paginate",
            "--slurp",
            endpoint,
        ]
    )
    try:
        repos = flatten_pages(json.loads(completed.stdout))
    except json.JSONDecodeError as error:
        raise WorkspaceError(
            f"{host.label} returned an invalid repository list."
        ) from error

    result: list[dict[str, Any]] = []
    for repo in repos:
        if host.public_repos_only and repo.get("private"):
            continue
        full_name = repo.get("full_name")
        if not full_name:
            continue
        result.append(
            {
                "host_key": host.key,
                "host_label": host.label,
                "hostname": host.hostname,
                "full_name": full_name,
                "description": clean_field(repo.get("description")),
                "default_branch": repo.get("default_branch") or "main",
                "html_url": repo.get("html_url") or "",
            }
        )
    return result


def cached_host_repos(
    host: Host, *, refresh: bool = False
) -> list[dict[str, Any]]:
    if not refresh:
        cached = read_repository_cache(host)
        if cached is not None:
            return cached
    repos = fetch_host_repos(host)
    write_repository_cache(host, repos)
    return repos


def load_repository_catalog(
    all_hosts: Sequence[Host], *, refresh: bool = False
) -> list[dict[str, Any]]:
    repos: list[dict[str, Any]] = []
    errors: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=len(all_hosts)
    ) as executor:
        futures = {
            executor.submit(cached_host_repos, host, refresh=refresh): host
            for host in all_hosts
        }
        for future, host in futures.items():
            try:
                repos.extend(future.result())
            except WorkspaceError as error:
                errors.append(f"{host.label}: {error}")

    if not repos:
        detail = "\n".join(errors)
        raise WorkspaceError(
            "No repositories could be loaded from gh."
            + (f"\n\n{detail}" if detail else "")
            + "\n\nCheck `gh auth status` for both hosts."
        )
    if errors:
        print("Some repository sources were unavailable:", file=sys.stderr)
        for error in errors:
            print(f"  {error}", file=sys.stderr)
    return repos


def repository_selection_key(repo: dict[str, Any]) -> str:
    return f"{repo['hostname']}/{repo['full_name']}".lower()


def group_repositories(
    repos: Sequence[dict[str, Any]],
    history: dict[str, float] | None = None,
) -> list[tuple[tuple[str, str], list[dict[str, Any]]]]:
    history = history or {}
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for repo in repos:
        owner = str(repo["full_name"]).partition("/")[0]
        grouped.setdefault((repo["host_key"], owner), []).append(repo)
    return sorted(
        grouped.items(),
        key=lambda item: recent_sort_key(
            history,
            f"organization:{item[0][0]}/{item[0][1].lower()}",
            f"{item[1][0]['host_label']}/{item[0][1]}",
        ),
    )


def choose_repositories(all_hosts: Sequence[Host]) -> list[dict[str, Any]]:
    repos = load_repository_catalog(all_hosts)
    history = load_selection_history()
    host_by_key = {host.key: host for host in all_hosts}
    groups = group_repositories(repos, history)
    selected: dict[str, dict[str, Any]] = {}

    while True:
        organization_rows: list[tuple[str, str]] = []
        if selected:
            organization_rows.append(
                (
                    f"✓  Continue with {len(selected)} checked "
                    f"repositor{'y' if len(selected) == 1 else 'ies'}",
                    "action:done",
                )
            )
        organization_rows.append(
            (
                "↻  Refresh owners and repositories",
                "action:refresh",
            )
        )

        groups_by_key: dict[str, tuple[tuple[str, str], list[dict[str, Any]]]] = {}
        for index, group in enumerate(groups):
            (_, owner), organization_repos = group
            key = f"organization:{index}"
            groups_by_key[key] = group
            checked = sum(
                repository_selection_key(repo) in selected
                for repo in organization_repos
            )
            host_label = organization_repos[0]["host_label"]
            checked_label = f"  [{checked} checked]" if checked else ""
            organization_rows.append(
                (
                    f"{host_label:<7}  {owner}  "
                    f"({len(organization_repos)} repos){checked_label}",
                    key,
                )
            )

        organization_choice = choose_one(
            organization_rows,
            prompt="Owner> ",
            header="Choose an owner; checked repositories are preserved",
        )
        if organization_choice == "action:done":
            return list(selected.values())
        if organization_choice == "action:refresh":
            try:
                repos = load_repository_catalog(all_hosts, refresh=True)
            except WorkspaceError as error:
                pause(str(error))
                continue
            catalog_keys = {
                repository_selection_key(repo) for repo in repos
            }
            selected = {
                key: repo
                for key, repo in selected.items()
                if key in catalog_keys
            }
            groups = group_repositories(repos, history)
            continue

        (host_key, owner), organization_repos = groups_by_key[
            organization_choice
        ]
        mark_recent(
            history,
            f"organization:{host_key}/{owner.lower()}",
        )
        while True:
            repo_rows: list[tuple[str, str]] = [
                ("←  Back to owners", "action:back")
            ]
            if selected:
                repo_rows.append(
                    (
                        f"✓  Continue with {len(selected)} checked "
                        f"repositor{'y' if len(selected) == 1 else 'ies'}",
                        "action:done",
                    )
                )
            repo_rows.append(
                (
                    f"↻  Refresh repositories in {owner}",
                    "action:refresh",
                )
            )
            repos_by_key: dict[str, dict[str, Any]] = {}
            ordered_repos = sorted(
                organization_repos,
                key=lambda repo: recent_sort_key(
                    history,
                    f"repository:{repository_selection_key(repo)}",
                    str(repo["full_name"]),
                ),
            )
            for index, repo in enumerate(ordered_repos):
                key = f"repo:{index}"
                repos_by_key[key] = repo
                checked = (
                    "x" if repository_selection_key(repo) in selected else " "
                )
                name = str(repo["full_name"]).partition("/")[2]
                description = (
                    f"  —  {repo['description']}" if repo["description"] else ""
                )
                repo_rows.append(
                    (f"[{checked}]  {name}{description}", key)
                )

            try:
                pressed, repo_choice = choose_one_event(
                    repo_rows,
                    prompt=f"{owner}> ",
                    header=(
                        "Space checks/unchecks; Enter activates actions; "
                        "- or Escape returns"
                    ),
                    expect=("space", "-"),
                )
            except Cancelled:
                break
            if pressed == "-":
                break
            if pressed == "space" and repo_choice.startswith("repo:"):
                repo = repos_by_key[repo_choice]
                selection_key = repository_selection_key(repo)
                mark_recent(
                    history,
                    f"repository:{selection_key}",
                )
                if selection_key in selected:
                    del selected[selection_key]
                else:
                    selected[selection_key] = repo
                continue
            if pressed:
                continue
            if repo_choice == "action:back":
                break
            if repo_choice == "action:done":
                return list(selected.values())
            if repo_choice == "action:refresh":
                try:
                    refreshed = cached_host_repos(
                        host_by_key[host_key],
                        refresh=True,
                    )
                except WorkspaceError as error:
                    pause(str(error))
                    continue
                repos = [
                    repo for repo in repos if repo["host_key"] != host_key
                ] + refreshed
                catalog_keys = {
                    repository_selection_key(repo) for repo in repos
                }
                selected = {
                    key: repo
                    for key, repo in selected.items()
                    if key in catalog_keys
                }
                groups = group_repositories(repos, history)
                refreshed_group = next(
                    (
                        group
                        for group in groups
                        if group[0] == (host_key, owner)
                    ),
                    None,
                )
                if refreshed_group is None:
                    break
                organization_repos = refreshed_group[1]
        groups = group_repositories(repos, history)


def choose_repository(all_hosts: Sequence[Host]) -> dict[str, Any]:
    """Choose one repository without introducing a multi-repository change."""

    repos = load_repository_catalog(all_hosts)
    history = load_selection_history()
    groups = group_repositories(repos, history)

    while True:
        owner_rows: list[tuple[str, str]] = [
            ("↻  Refresh owners and repositories", "action:refresh")
        ]
        groups_by_key: dict[
            str, tuple[tuple[str, str], list[dict[str, Any]]]
        ] = {}
        for index, group in enumerate(groups):
            (_, owner), owner_repos = group
            key = f"owner:{index}"
            groups_by_key[key] = group
            owner_rows.append(
                (
                    f"{owner_repos[0]['host_label']:<9}  {owner}",
                    key,
                )
            )

        owner_choice = choose_one(
            owner_rows,
            prompt="Owner> ",
            header="Choose an owner; the next popup lists its repositories",
        )
        if owner_choice == "action:refresh":
            repos = load_repository_catalog(all_hosts, refresh=True)
            groups = group_repositories(repos, history)
            continue

        (host_key, owner), owner_repos = groups_by_key[owner_choice]
        mark_recent(history, f"organization:{host_key}/{owner.lower()}")
        while True:
            repo_rows: list[tuple[str, str]] = [
                ("←  Back to owners", "action:back"),
                (f"↻  Refresh repositories in {owner}", "action:refresh"),
            ]
            repos_by_key: dict[str, dict[str, Any]] = {}
            ordered_repos = sorted(
                owner_repos,
                key=lambda repo: recent_sort_key(
                    history,
                    f"repository:{repository_selection_key(repo)}",
                    str(repo["full_name"]),
                ),
            )
            for index, repo in enumerate(ordered_repos):
                key = f"repo:{index}"
                repos_by_key[key] = repo
                name = str(repo["full_name"]).partition("/")[2]
                description = (
                    f"  —  {repo['description']}"
                    if repo.get("description")
                    else ""
                )
                repo_rows.append((f"{name}{description}", key))

            try:
                pressed, repo_choice = choose_one_event(
                    repo_rows,
                    prompt=f"{owner}> ",
                    header=(
                        "Enter selects a repository; left or Escape returns"
                    ),
                    expect=("left",),
                )
            except Cancelled:
                break
            if pressed == "left":
                break
            if repo_choice == "action:back":
                break
            if repo_choice == "action:refresh":
                refreshed = load_repository_catalog(
                    all_hosts, refresh=True
                )
                repos = refreshed
                groups = group_repositories(repos, history)
                refreshed_group = next(
                    (
                        group
                        for group in groups
                        if group[0] == (host_key, owner)
                    ),
                    None,
                )
                if refreshed_group is None:
                    break
                owner_repos = refreshed_group[1]
                continue
            repo = repos_by_key[repo_choice]
            mark_recent(
                history,
                f"repository:{repository_selection_key(repo)}",
            )
            return repo
        groups = group_repositories(repos, history)


def canonical_remote(remote: str) -> tuple[str, str] | None:
    remote = remote.strip()
    if not remote:
        return None
    if re.match(r"^[^/@\s]+@[^:]+:", remote):
        _, remainder = remote.split("@", 1)
        hostname, path = remainder.split(":", 1)
    else:
        parsed = urlparse(remote)
        if not parsed.hostname:
            return None
        hostname = parsed.hostname
        path = parsed.path
    full_name = path.strip("/")
    if full_name.endswith(".git"):
        full_name = full_name[:-4]
    if full_name.count("/") < 1:
        return None
    return hostname.lower(), full_name.lower()


def git_output(source: Path, *args: str, check: bool = True) -> str:
    return run([GIT, "-C", str(source), *args], check=check).stdout.strip()


def parse_worktree_list(output: str) -> list[dict[str, str | bool]]:
    """Parse the stable porcelain form of `git worktree list`."""

    entries: list[dict[str, str | bool]] = []
    current: dict[str, str | bool] | None = None

    def finish() -> None:
        if current and current.get("path"):
            entries.append(current)

    for line in output.splitlines():
        if not line:
            finish()
            current = None
            continue
        if line.startswith("worktree "):
            finish()
            current = {
                "path": line.removeprefix("worktree "),
                "branch": "",
                "bare": False,
            }
            continue
        if current is None:
            continue
        if line == "bare":
            current["bare"] = True
        elif line.startswith("branch refs/heads/"):
            current["branch"] = line.removeprefix("branch refs/heads/")
        elif line == "detached":
            current["branch"] = ""

    finish()
    return entries


def default_branch_for_source(source: Path, fallback: str = "main") -> str:
    symbolic = git_output(
        source,
        "symbolic-ref",
        "--quiet",
        "--short",
        "refs/remotes/origin/HEAD",
        check=False,
    )
    if symbolic.startswith("origin/"):
        return symbolic.removeprefix("origin/")
    return fallback


def remote_default_branch(source: Path, fallback: str = "main") -> str:
    local = default_branch_for_source(source, "")
    if local:
        return local
    output = git_output(
        source,
        "ls-remote",
        "--symref",
        "origin",
        "HEAD",
        check=False,
    )
    match = re.search(r"ref: refs/heads/([^\s]+)\s+HEAD", output)
    return match.group(1) if match else (fallback or "main")


def repository_sources(host: Host) -> list[Path]:
    """Return normal repositories and manager-owned bare repositories."""

    if not host.root.is_dir():
        return []

    direct: list[Path] = []
    for candidate in host.root.iterdir():
        if candidate.name == ".herdr" or not candidate.is_dir():
            continue
        if (candidate / ".git").exists():
            direct.append(candidate)
            continue
        nested = sorted(
            (
                path
                for path in candidate.iterdir()
                if path.is_dir() and (path / ".git").exists()
            ),
            key=lambda path: (
                0 if path.name == "main" else 1,
                0 if (path / ".git").is_dir() else 1,
                path.name.casefold(),
            ),
        )
        if nested:
            direct.append(nested[0])
    direct.sort(
        key=lambda path: (
            0 if (path / ".git").is_dir() else 1,
            path.parent.name.casefold(),
            path.name.casefold(),
        )
    )

    caches = host.root / ".herdr" / "repositories"
    bare = (
        sorted(caches.glob("*.git"), key=lambda path: path.name.casefold())
        if caches.is_dir()
        else []
    )
    return direct + [path for path in bare if (path / "HEAD").exists()]


def worktrees_for_source(
    storage_host: Host,
    source: Path,
    all_hosts: Sequence[Host],
    host_by_hostname: dict[str, Host],
) -> list[WorktreeRecord]:
    source_path = source.resolve()
    entries = parse_worktree_list(
        git_output(
            source,
            "worktree",
            "list",
            "--porcelain",
            check=False,
        )
    )
    if (source / ".git").exists():
        primary = next(
            (
                entry
                for entry in entries
                if not entry.get("bare") and entry.get("path")
            ),
            None,
        )
        if primary:
            source_path = Path(
                str(primary["path"])
            ).expanduser().resolve()
    remote = git_output(
        source_path,
        "remote",
        "get-url",
        "origin",
        check=False,
    )
    canonical = canonical_remote(remote)
    if canonical:
        hostname, full_name = canonical
        repo_host = host_by_hostname.get(hostname, storage_host)
    else:
        hostname = storage_host.hostname
        full_name = source.name
        repo_host = storage_host

    records: list[WorktreeRecord] = []
    for entry in entries:
        if entry.get("bare"):
            continue
        path = Path(str(entry["path"])).expanduser().resolve()
        if not path.is_dir():
            continue
        worktree_host = next(
            (
                host
                for host in all_hosts
                if path_contains(host.root, path)
            ),
            None,
        )
        if worktree_host is None:
            continue
        repo = {
            "host_key": repo_host.key,
            "host_label": repo_host.label,
            "hostname": hostname,
            "full_name": full_name,
            "description": "",
            "default_branch": "",
        }
        records.append(
            WorktreeRecord(
                host=worktree_host,
                path=path,
                source=source_path,
                repo=repo,
                branch=str(entry.get("branch") or ""),
            )
        )
    return records


def local_worktrees(all_hosts: Sequence[Host]) -> list[WorktreeRecord]:
    """Discover every usable worktree beneath the configured project roots."""

    sources = [
        (host, source)
        for host in all_hosts
        for source in repository_sources(host)
    ]
    if not sources:
        return []
    host_by_hostname = {
        host.hostname.casefold(): host for host in all_hosts
    }
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=min(8, len(sources))
    ) as executor:
        futures = [
            executor.submit(
                worktrees_for_source,
                storage_host,
                source,
                all_hosts,
                host_by_hostname,
            )
            for storage_host, source in sources
        ]
        records: dict[str, WorktreeRecord] = {}
        for future in futures:
            for record in future.result():
                try:
                    key = str(record.path.resolve())
                except OSError:
                    key = str(record.path)
                records.setdefault(key, record)
    return list(records.values())


def repository_workspace_name(repo: dict[str, Any]) -> str:
    return str(repo["full_name"]).rsplit("/", 1)[-1]


def worktree_display_name(record: WorktreeRecord) -> str:
    repository = repository_workspace_name(record.repo)
    if record.path == record.source:
        return repository
    worktree_name = record.path.name
    workspace_root = (
        record.host.root / repository_workspace_name(record.repo)
    ).resolve()
    try:
        relative = record.path.resolve().relative_to(workspace_root)
    except (OSError, ValueError):
        relative = Path()
    if relative.parts:
        worktree_name = relative.as_posix()
    elif worktree_name.casefold() == repo_dir_name(
        str(record.repo["full_name"])
    ).casefold():
        worktree_name = record.path.parent.name
    return f"{repository}  {worktree_name}"


def worktree_row_label(record: WorktreeRecord, action: str = "open") -> str:
    actions = "[open] new" if action == "open" else "open [new]"
    return f"{record.host.label:<9}  {worktree_display_name(record)}   {actions}"


def worktree_history_key(record: WorktreeRecord) -> str:
    return f"project:{record.path.resolve()}"


def worktree_sort_key(
    history: dict[str, float], record: WorktreeRecord
) -> tuple[float, str]:
    return recent_sort_key(
        history,
        worktree_history_key(record),
        f"{record.host.label}/{record.repo['full_name']}/{record.path}",
    )


def find_existing_source(
    host: Host, full_name: str, *, hostname: str | None = None
) -> Path | None:
    if not host.root.is_dir():
        return None
    target = ((hostname or host.hostname).lower(), full_name.lower())
    for candidate in host.root.iterdir():
        if candidate.name == ".herdr" or not candidate.is_dir():
            continue
        if not (candidate / ".git").exists():
            continue
        remote = git_output(
            candidate, "remote", "get-url", "origin", check=False
        )
        if canonical_remote(remote) == target:
            return candidate
    return None


def prepare_source(
    host: Host,
    repo: dict[str, Any],
    search_hosts: Sequence[Host] = (),
) -> Path:
    host.root.mkdir(parents=True, exist_ok=True)
    candidate_hosts = (
        host,
        *(candidate for candidate in search_hosts if candidate.root != host.root),
    )
    for candidate in candidate_hosts:
        existing = find_existing_source(
            candidate,
            repo["full_name"],
            hostname=repo["hostname"],
        )
        if existing:
            return existing

    repositories_dir = host.root / ".herdr" / "repositories"
    repositories_dir.mkdir(parents=True, exist_ok=True)
    source = repositories_dir / f"{repo_dir_name(repo['full_name'])}.git"
    created_cache = not source.exists()
    if created_cache:
        print(f"\nCloning {repo['full_name']}...", flush=True)
        gh_env = dict(os.environ)
        gh_env["GH_HOST"] = repo["hostname"]
        run(
            [
                GH,
                "repo",
                "clone",
                repo["full_name"],
                str(source),
                "--",
                "--bare",
                "--single-branch",
                "--branch",
                str(repo["default_branch"]),
                "--filter=blob:none",
                "--no-tags",
            ],
            env=gh_env,
        )
    elif not (source / "HEAD").exists():
        raise WorkspaceError(
            f"Repository cache is not a bare git repository: {source}"
        )
    run(
        [
            GIT,
            "-C",
            str(source),
            "config",
            "remote.origin.fetch",
            "+refs/heads/*:refs/remotes/origin/*",
        ]
    )
    if created_cache:
        # Bare clones seed local branch refs. Managed worktrees instead create
        # or reset those refs from an explicitly fetched origin branch.
        for branch in local_branches(source):
            git_output(source, "update-ref", "-d", f"refs/heads/{branch}")
    return source


def local_branches(source: Path) -> set[str]:
    output = git_output(
        source,
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
        check=False,
    )
    return set(output.splitlines()) if output else set()


def occupied_branches(source: Path) -> set[str]:
    output = git_output(source, "worktree", "list", "--porcelain", check=False)
    return {
        line.removeprefix("branch refs/heads/")
        for line in output.splitlines()
        if line.startswith("branch refs/heads/")
    }


def branch_history_key(repo: dict[str, Any], branch: str) -> str:
    return (
        f"branch:{repo['hostname']}/{repo['full_name']}/{branch}"
    ).lower()


def validate_branch_name(name: str) -> None:
    result = run(
        [GIT, "check-ref-format", "--branch", name],
        check=False,
    )
    if result.returncode:
        raise WorkspaceError(f"Invalid branch name: {name}")


def fetch_remote_branch(source: Path, branch: str) -> None:
    validate_branch_name(branch)
    print(f"\nFetching latest origin/{branch}...", flush=True)
    git_output(
        source,
        "fetch",
        "--no-tags",
        "origin",
        f"+refs/heads/{branch}:refs/remotes/origin/{branch}",
    )


def remote_branch_exists(source: Path, branch: str) -> bool:
    result = run(
        [
            GIT,
            "-C",
            str(source),
            "ls-remote",
            "--exit-code",
            "--heads",
            "origin",
            branch,
        ],
        check=False,
    )
    if result.returncode == 0:
        return True
    if result.returncode == 2:
        return False
    detail = result.stderr.strip() or result.stdout.strip()
    raise WorkspaceError(
        detail or f"Could not check upstream branch: {branch}"
    )


def choose_branch(
    source: Path, repo: dict[str, Any]
) -> dict[str, str | bool]:
    default = str(repo["default_branch"])
    mode = choose_one(
        [
            ("Create a new branch", "__new__"),
            (f"Use latest default branch ({default})", "__default__"),
            ("Use another existing upstream branch", "__existing__"),
        ],
        prompt=f"{repo['full_name']} branch> ",
        header=(
            "Branches are fetched only after selection; type a branch name "
            "instead of loading the full upstream branch list"
        ),
    )
    history = load_selection_history()
    local = local_branches(source)

    if mode == "__new__":
        branch = prompt_text(f"New branch for {repo['full_name']}")
        validate_branch_name(branch)
        if branch in local or remote_branch_exists(source, branch):
            raise WorkspaceError(f"Branch already exists: {branch}")
        base = prompt_text("Base upstream branch", default=default)
        fetch_remote_branch(source, base)
        mark_recent(history, branch_history_key(repo, base))
        mark_recent(history, branch_history_key(repo, branch))
        return {
            "branch": branch,
            "start_point": f"origin/{base}",
            "create": True,
        }

    branch = (
        default
        if mode == "__default__"
        else prompt_text("Existing upstream branch", default=default)
    )
    fetch_remote_branch(source, branch)
    if branch in occupied_branches(source):
        raise WorkspaceError(
            f"Branch {branch!r} is already checked out. "
            "Create a new branch for this workspace instead."
        )
    mark_recent(history, branch_history_key(repo, branch))
    return {
        "branch": branch,
        "start_point": f"origin/{branch}",
        "create": branch not in local,
        "reset": branch in local,
    }


def manifests_dir() -> Path:
    return state_root() / "workspaces"


def manifest_path(slug: str) -> Path:
    return manifests_dir() / f"{slug}.json"


def save_manifest(manifest: dict[str, Any]) -> None:
    directory = manifests_dir()
    directory.mkdir(parents=True, exist_ok=True)
    destination = manifest_path(manifest["slug"])
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(destination)


def load_manifests() -> list[dict[str, Any]]:
    directory = manifests_dir()
    if not directory.is_dir():
        return []
    result = []
    for path in sorted(directory.glob("*.json")):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if (
            isinstance(value, dict)
            and value.get("slug")
            and isinstance(value.get("repos"), list)
        ):
            result.append(value)
    return result


def nested_worktree_exclusion(
    source: Path, destination: Path
) -> tuple[Path, str] | None:
    try:
        relative = destination.resolve().relative_to(source.resolve())
    except (OSError, ValueError):
        return None
    exclude_value = f"/{relative.as_posix().rstrip('/')}/"
    git_path = git_output(
        source,
        "rev-parse",
        "--git-path",
        "info/exclude",
    )
    exclude_path = Path(git_path)
    if not exclude_path.is_absolute():
        exclude_path = source / exclude_path
    return exclude_path, exclude_value


def add_nested_worktree_exclusion(
    source: Path, destination: Path
) -> None:
    exclusion = nested_worktree_exclusion(source, destination)
    if exclusion is None:
        return
    exclude_path, value = exclusion
    marker = f"# herdr-worktree {value}"
    existing = (
        exclude_path.read_text(encoding="utf-8")
        if exclude_path.is_file()
        else ""
    )
    if value in existing.splitlines():
        return
    exclude_path.parent.mkdir(parents=True, exist_ok=True)
    prefix = "" if not existing or existing.endswith("\n") else "\n"
    with exclude_path.open("a", encoding="utf-8") as exclude_file:
        exclude_file.write(f"{prefix}{marker}\n{value}\n")


def remove_nested_worktree_exclusion(
    source: Path, destination: Path
) -> None:
    exclusion = nested_worktree_exclusion(source, destination)
    if exclusion is None:
        return
    exclude_path, value = exclusion
    if not exclude_path.is_file():
        return
    marker = f"# herdr-worktree {value}"
    lines = exclude_path.read_text(encoding="utf-8").splitlines()
    cleaned: list[str] = []
    index = 0
    while index < len(lines):
        if (
            lines[index] == marker
            and index + 1 < len(lines)
            and lines[index + 1] == value
        ):
            index += 2
            continue
        cleaned.append(lines[index])
        index += 1
    exclude_path.write_text(
        "".join(f"{line}\n" for line in cleaned),
        encoding="utf-8",
    )


def add_worktree(
    source: Path,
    destination: Path,
    selection: dict[str, str | bool],
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    args = [GIT, "-C", str(source), "worktree", "add"]
    if selection.get("reset"):
        args.extend(("-B", str(selection["branch"])))
    elif selection["create"]:
        args.extend(("-b", str(selection["branch"])))
    args.extend((str(destination), str(selection["start_point"])))
    run(args)
    add_nested_worktree_exclusion(source, destination)


def configure_github_worktree(
    source: Path, destination: Path, signing_key: str
) -> None:
    git_output(source, "config", "extensions.worktreeConfig", "true")
    settings = (
        ("core.bare", "false"),
        ("user.name", GITHUB_AUTHOR_NAME),
        ("user.email", GITHUB_AUTHOR_EMAIL),
        ("user.signingKey", signing_key),
        ("gpg.format", "openpgp"),
        ("gpg.program", GPG),
        ("commit.gpgSign", "true"),
    )
    for key, value in settings:
        git_output(destination, "config", "--worktree", key, value)


def remove_worktree(
    source: Path, destination: Path, *, force: bool = False
) -> None:
    args = [GIT, "-C", str(source), "worktree", "remove"]
    if force:
        args.append("--force")
    args.append(str(destination))
    run(args)
    remove_nested_worktree_exclusion(source, destination)
    for parent in (destination.parent, destination.parent.parent):
        try:
            parent.rmdir()
        except OSError:
            break


def host_for_path(
    all_hosts: Sequence[Host], path: Path, fallback: Host
) -> Host:
    return next(
        (
            host
            for host in all_hosts
            if path_contains(host.root, path)
        ),
        fallback,
    )


def workspace_name_for_path(
    host: Host, path: Path, repo: dict[str, Any]
) -> str:
    try:
        relative = path.resolve().relative_to(host.root.resolve())
    except (OSError, ValueError):
        relative = Path()
    if relative.parts and relative.parts[0] != ".herdr":
        return relative.parts[0]
    return repository_workspace_name(repo)


def default_branch_selection(
    source: Path, repo: dict[str, Any]
) -> dict[str, str | bool]:
    """Fetch and select the repository's default branch, never another base."""

    default = str(repo.get("default_branch") or "")
    if not default:
        default = remote_default_branch(source)
    fetch_remote_branch(source, default)
    return {
        "branch": "",
        "default_branch": default,
        "start_point": f"origin/{default}",
        "create": True,
    }


def worktree_manifest_slug(repo: dict[str, Any], slug: str) -> str:
    return f"{repo_dir_name(str(repo['full_name']))}--{slug}"


def create_new_worktree(
    *,
    repo: dict[str, Any],
    source: Path,
    storage_host: Host,
    branch_name: str | None = None,
    workspace_name: str | None = None,
) -> dict[str, Any]:
    """Create one branch/worktree and open it as a one-repository workspace."""

    repo = dict(repo)
    branch = (branch_name or prompt_text("Branch name")).strip()
    if not branch:
        raise Cancelled
    validate_branch_name(branch)
    selection = default_branch_selection(source, repo)
    if (
        branch in local_branches(source)
        or branch in occupied_branches(source)
        or remote_branch_exists(source, branch)
    ):
        raise WorkspaceError(
            f"A branch or worktree named {branch!r} already exists."
        )

    storage_host.root.mkdir(parents=True, exist_ok=True)
    workspace_name = workspace_name or repository_workspace_name(repo)
    destination = storage_host.root / workspace_name / branch
    if not path_contains(storage_host.root, destination):
        raise WorkspaceError(
            f"Worktree path escapes the configured root: {destination}"
        )
    if destination.exists():
        raise WorkspaceError(
            f"Worktree folder already exists: {destination}"
        )

    selection["branch"] = branch
    manifest_slug = worktree_manifest_slug(
        repo, repo_dir_name(branch)
    )
    if manifest_path(manifest_slug).exists():
        raise WorkspaceError(
            f"A managed worktree for branch {branch!r} already exists."
        )
    workspace_label = f"{workspace_name}/{branch}"

    signing_key = ""
    if repo.get("host_key") == "github":
        require_commands(GPG)
        signing_key = choose_gpg_signing_key(GITHUB_AUTHOR_EMAIL)

    created = False
    try:
        add_worktree(source, destination, selection)
        created = True
        if repo.get("host_key") == "github":
            configure_github_worktree(source, destination, signing_key)
        manifest = {
            "version": 2,
            "name": workspace_label,
            "slug": manifest_slug,
            "repos": [
                {
                    "host_key": repo["host_key"],
                    "hostname": repo["hostname"],
                    "full_name": repo["full_name"],
                    "default_branch": str(
                        selection.get("default_branch") or repo.get(
                            "default_branch"
                        ) or "main"
                    ),
                    "branch": branch,
                    "source": str(source),
                    "path": str(destination),
                }
            ],
        }
        save_manifest(manifest)
    except (KeyboardInterrupt, OSError, WorkspaceError) as error:
        if created:
            try:
                remove_worktree(source, destination)
            except WorkspaceError:
                pass
        if isinstance(error, OSError):
            raise WorkspaceError(
                f"Could not save worktree metadata for {destination}: {error}"
            ) from error
        raise

    history = load_selection_history()
    mark_recent(history, f"workspace:{manifest['slug']}")
    mark_recent(history, f"project:{destination.resolve()}")
    mark_recent(history, f"repository:{repository_selection_key(repo)}")
    open_managed_worktree(manifest)
    return manifest


def create_worktree_from_existing(
    record: WorktreeRecord, all_hosts: Sequence[Host]
) -> dict[str, Any]:
    storage_host = host_for_path(all_hosts, record.path, record.host)
    return create_new_worktree(
        repo=record.repo,
        source=record.source,
        storage_host=storage_host,
        workspace_name=workspace_name_for_path(
            storage_host, record.path, record.repo
        ),
    )


def create_workspace(all_hosts: Sequence[Host]) -> None:
    require_commands(GH, GIT)
    repo = choose_repository(all_hosts)
    selected_host = next(host for host in all_hosts if host.key == repo["host_key"])
    source = prepare_source(selected_host, repo, all_hosts)
    storage_host = host_for_path(all_hosts, source, selected_host)
    create_new_worktree(
        repo=repo,
        source=source,
        storage_host=storage_host,
        workspace_name=workspace_name_for_path(
            storage_host, source, repo
        ),
    )


def json_command(args: Sequence[str]) -> dict[str, Any]:
    completed = run(args)
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise WorkspaceError(
            f"Command returned invalid JSON: {shlex.join(args)}"
        ) from error
    return value if isinstance(value, dict) else {}


def nested_values(value: Any, key: str) -> Iterable[Any]:
    if isinstance(value, dict):
        if key in value:
            yield value[key]
        for child in value.values():
            yield from nested_values(child, key)
    elif isinstance(value, list):
        for child in value:
            yield from nested_values(child, key)


def first_nested(value: Any, key: str) -> str:
    return next((str(item) for item in nested_values(value, key) if item), "")


def pane_records() -> list[dict[str, Any]]:
    value = json_command([HERDR, "pane", "list"])
    panes = next(nested_values(value, "panes"), [])
    return [pane for pane in panes if isinstance(pane, dict)]


def path_contains(parent: Path, child: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except (OSError, ValueError):
        return False


def active_workspace_for(paths: Sequence[Path]) -> str:
    try:
        panes = pane_records()
    except WorkspaceError:
        return ""
    for pane in panes:
        cwd = pane.get("cwd")
        if not cwd:
            continue
        if any(path_contains(path, Path(cwd)) for path in paths):
            return str(pane.get("workspace_id") or "")
    return ""


def start_dependency_install(cwd: Path) -> None:
    command_parts = shlex.split(INSTALL_COMMAND)
    if not command_parts:
        return
    if shutil.which(command_parts[0]) is None:
        print(
            f"Warning: dependency installer not found: {command_parts[0]}",
            file=sys.stderr,
        )
        return
    try:
        subprocess.Popen(
            command_parts,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as error:
        print(
            f"Warning: failed to start {INSTALL_COMMAND!r} in {cwd}: {error}",
            file=sys.stderr,
        )


def start_pi(pane_id: str, cwd: Path) -> None:
    command_parts = shlex.split(PI_COMMAND)
    if not command_parts:
        return
    if shutil.which(command_parts[0]) is None:
        print(
            f"Warning: workspace command not found: {command_parts[0]}",
            file=sys.stderr,
        )
        return
    completed = run(
        [HERDR, "pane", "run", pane_id, PI_COMMAND],
        check=False,
    )
    if completed.returncode:
        detail = completed.stderr.strip() or completed.stdout.strip()
        print(
            f"Warning: failed to start {PI_COMMAND!r} in {cwd}: {detail}",
            file=sys.stderr,
        )


def create_herdr_workspace(
    *, name: str, directories: Sequence[tuple[str, Path]], slug: str = ""
) -> None:
    if not directories:
        raise WorkspaceError(f"Workspace {name!r} has no repository folders.")
    workspace_env = (
        ["--env", f"HERDR_MANAGED_WORKSPACE={slug}"] if slug else []
    )
    first_label, first_path = directories[0]
    created = json_command(
        [
            HERDR,
            "workspace",
            "create",
            "--cwd",
            str(first_path),
            "--label",
            name,
            *workspace_env,
            "--focus",
        ]
    )
    workspace_id = first_nested(created, "workspace_id")
    pane_id = first_nested(created, "pane_id")
    if not workspace_id or not pane_id:
        raise WorkspaceError("Herdr did not return a workspace and root pane.")
    start_dependency_install(first_path)
    start_pi(pane_id, first_path)

    for label, path in directories[1:]:
        tab = json_command(
            [
                HERDR,
                "tab",
                "create",
                "--workspace",
                workspace_id,
                "--cwd",
                str(path),
                "--label",
                label,
                *workspace_env,
                "--no-focus",
            ]
        )
        tab_pane_id = first_nested(tab, "pane_id")
        if not tab_pane_id:
            raise WorkspaceError(f"Herdr did not return a pane for {label}.")
        start_dependency_install(path)
        start_pi(tab_pane_id, path)


def open_managed_worktree(manifest: dict[str, Any]) -> None:
    repo = manifest["repos"][0]
    source = Path(repo["source"])
    path = Path(repo["path"])
    if not path.is_dir():
        raise WorkspaceError(f"Worktree folder is missing: {path}")
    existing = active_workspace_for([path])
    if existing:
        run([HERDR, "workspace", "focus", existing])
        return
    worktree_label = str(repo.get("branch") or path.name)
    opened = json_command(
        [
            HERDR,
            "worktree",
            "open",
            "--cwd",
            str(source),
            "--path",
            str(path),
            "--label",
            worktree_label,
            "--focus",
        ]
    )
    pane_id = first_nested(opened, "pane_id")
    if not pane_id:
        raise WorkspaceError("Herdr did not return a worktree root pane.")
    start_dependency_install(path)
    start_pi(pane_id, path)


def open_managed_workspace(manifest: dict[str, Any]) -> None:
    directories = [
        (repo["full_name"], Path(repo["path"]))
        for repo in manifest["repos"]
        if repo.get("full_name")
        and repo.get("path")
        and Path(repo["path"]).is_dir()
    ]
    missing = len(manifest["repos"]) - len(directories)
    if not directories:
        raise WorkspaceError(
            f"All folders for workspace {manifest['name']!r} are missing."
        )
    paths = [path for _, path in directories]
    existing = active_workspace_for(paths)
    if existing:
        run([HERDR, "workspace", "focus", existing])
        return
    if missing:
        print(
            f"Warning: {missing} repository folder(s) are missing.",
            file=sys.stderr,
        )
    create_herdr_workspace(
        name=manifest["name"],
        directories=directories,
        slug=manifest["slug"],
    )


def local_projects(all_hosts: Sequence[Host]) -> list[tuple[Host, Path]]:
    projects: list[tuple[Host, Path]] = []
    for host in all_hosts:
        if not host.root.is_dir():
            continue
        for path in host.root.iterdir():
            if (
                path.name == ".herdr"
                or not path.is_dir()
                or not (path / ".git").exists()
            ):
                continue
            projects.append((host, path))
    return sorted(projects, key=lambda item: (item[0].label, item[1].name.lower()))


def open_existing_worktree(record: WorktreeRecord) -> None:
    if not record.path.is_dir():
        raise WorkspaceError(f"Worktree folder is missing: {record.path}")
    existing = active_workspace_for([record.path])
    if existing:
        run([HERDR, "workspace", "focus", existing])
        return
    create_herdr_workspace(
        name=worktree_display_name(record),
        directories=[(str(record.repo["full_name"]), record.path)],
    )


def choose_worktree_action(
    records: Sequence[WorktreeRecord],
) -> tuple[str, str]:
    """Return a picker key and either `open` or `new`."""

    rows: list[tuple[str, str, str]] = [
        (
            "+  Create a new worktree from GitHub",
            "+  Create a new worktree from GitHub",
            "action:create",
        ),
        (
            "-  Close the current workspace",
            "-  Close the current workspace",
            "action:close",
        ),
    ]
    choices: dict[str, WorktreeRecord] = {}
    for index, record in enumerate(records):
        key = f"worktree:{index}"
        choices[key] = record
        rows.append(
            (
                worktree_row_label(record, "open"),
                worktree_row_label(record, "new"),
                key,
            )
        )

    choice, action = fzf_worktree_select_event(
        rows,
        prompt="Workspace> ",
        header=(
            "Enter opens the selected action; left/right selects "
            "[open] or [new]"
        ),
    )
    if choice in {"action:create", "action:close"}:
        return choice, "open"
    if choice not in choices:
        raise WorkspaceError("The selected worktree is no longer available.")
    return choice, action


def open_workspace(all_hosts: Sequence[Host]) -> None:
    history = load_selection_history()
    records = sorted(
        local_worktrees(all_hosts),
        key=lambda record: worktree_sort_key(history, record),
    )
    choices = {
        f"worktree:{index}": record
        for index, record in enumerate(records)
    }
    choice, action = choose_worktree_action(records)
    if choice == "action:create":
        create_workspace(all_hosts)
        return
    if choice == "action:close":
        close_workspace()
        return

    record = choices[choice]
    mark_recent(history, worktree_history_key(record))
    mark_recent(
        history,
        f"repository:{repository_selection_key(record.repo)}",
    )
    if action == "new":
        create_worktree_from_existing(record, all_hosts)
    else:
        open_existing_worktree(record)


def workspace_records() -> list[dict[str, Any]]:
    value = json_command([HERDR, "workspace", "list"])
    records = next(nested_values(value, "workspaces"), [])
    return [record for record in records if isinstance(record, dict)]


def current_workspace_to_close() -> dict[str, Any]:
    records = workspace_records()
    focused = next(
        (
            record
            for record in records
            if record.get("focused") and record.get("workspace_id")
        ),
        None,
    )
    if focused:
        return focused

    active = (
        os.environ.get("HERDR_ACTIVE_WORKSPACE_ID")
        or os.environ.get("HERDR_WORKSPACE_ID")
        or ""
    )
    from_environment = next(
        (
            record
            for record in records
            if str(record.get("workspace_id") or "") == active
        ),
        None,
    )
    if from_environment:
        return from_environment
    raise WorkspaceError("Herdr did not report a current workspace to close.")


def manifest_for_workspace(
    workspace_id: str, manifests: Sequence[dict[str, Any]]
) -> dict[str, Any] | None:
    workspace_panes = [
        pane
        for pane in pane_records()
        if str(pane.get("workspace_id") or "") == workspace_id
    ]
    for manifest in manifests:
        paths = [
            Path(repo["path"])
            for repo in manifest["repos"]
            if repo.get("path")
        ]
        if any(
            cwd
            and any(path_contains(path, Path(cwd)) for path in paths)
            for cwd in (pane.get("cwd") for pane in workspace_panes)
        ):
            return manifest
    return None


def delete_managed_workspace(manifest: dict[str, Any]) -> None:
    require_commands(GIT)
    for repo in manifest["repos"]:
        path = Path(repo["path"])
        if path.exists():
            remove_worktree(Path(repo["source"]), path, force=True)
    path = manifest_path(manifest["slug"])
    if path.exists():
        path.unlink()


def project_folders_for_workspace(
    workspace_id: str, all_hosts: Sequence[Host]
) -> list[Path]:
    folders: set[Path] = set()
    workspace_cwds = [
        Path(pane["cwd"])
        for pane in pane_records()
        if str(pane.get("workspace_id") or "") == workspace_id
        and pane.get("cwd")
    ]
    for host in all_hosts:
        try:
            root = host.root.resolve()
        except OSError:
            continue
        for cwd in workspace_cwds:
            try:
                relative = cwd.resolve().relative_to(root)
            except (OSError, ValueError):
                continue
            if not relative.parts or relative.parts[0] == ".herdr":
                continue
            project = host.root / relative.parts[0]
            if project.is_dir():
                folders.add(project)
    return sorted(folders, key=lambda path: str(path).lower())


def delete_project_folders(
    folders: Sequence[Path], all_hosts: Sequence[Host]
) -> None:
    allowed_roots = {host.root.resolve() for host in all_hosts}
    for folder in folders:
        if (
            folder.name == ".herdr"
            or folder.parent.resolve() not in allowed_roots
        ):
            raise WorkspaceError(
                f"Refusing to delete a folder outside configured roots: {folder}"
            )
        try:
            if folder.is_symlink():
                folder.unlink()
            elif folder.exists():
                shutil.rmtree(folder)
        except OSError as error:
            raise WorkspaceError(
                f"Could not completely delete {folder}: {error}"
            ) from error


def folder_choice_labels(count: int) -> tuple[str, str]:
    noun = "folder" if count == 1 else "folders"
    return (
        f"Close workspace and keep {noun}",
        f"Close workspace and permanently delete {noun}",
    )


def background_task_log_path() -> Path:
    return state_root() / "background-tasks.log"


def start_background_workspace_deletion(
    workspace_id: str,
    manifest: dict[str, Any] | None,
    folders: Sequence[Path],
) -> None:
    if manifest:
        action = "_background-delete-managed"
        arguments = [workspace_id, str(manifest["slug"])]
    else:
        action = "_background-delete-projects"
        arguments = [workspace_id, *(str(folder) for folder in folders)]
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        action,
        *arguments,
    ]
    log_path = background_task_log_path()
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("ab") as log:
            subprocess.Popen(
                command,
                cwd=Path.home(),
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
    except OSError as error:
        raise WorkspaceError(
            f"Could not start background workspace deletion: {error}"
        ) from error


def perform_background_deletion(
    action: str, arguments: Sequence[str]
) -> None:
    if len(arguments) < 2:
        raise WorkspaceError("Background deletion arguments are incomplete.")
    workspace_id = arguments[0]
    run([HERDR, "workspace", "close", workspace_id])
    if action == "_background-delete-managed":
        slug = arguments[1]
        manifest = next(
            (
                manifest
                for manifest in load_manifests()
                if str(manifest.get("slug") or "") == slug
            ),
            None,
        )
        if manifest is None:
            raise WorkspaceError(
                f"Managed workspace manifest no longer exists: {slug}"
            )
        delete_managed_workspace(manifest)
        return
    if action == "_background-delete-projects":
        delete_project_folders(
            [Path(folder) for folder in arguments[1:]],
            hosts(),
        )
        return
    raise WorkspaceError(f"Unknown background deletion action: {action}")


def close_workspace(workspace: dict[str, Any] | None = None) -> None:
    workspace = workspace or current_workspace_to_close()
    workspace_id = str(workspace["workspace_id"])
    label = clean_field(
        workspace.get("label") or workspace.get("name") or workspace_id
    )
    all_hosts = hosts()
    manifest = manifest_for_workspace(workspace_id, load_manifests())
    if manifest:
        folders = [
            Path(repo["path"])
            for repo in manifest["repos"]
            if repo.get("path")
        ]
    else:
        folders = project_folders_for_workspace(workspace_id, all_hosts)

    if folders:
        keep_label, delete_label = folder_choice_labels(len(folders))
        folder_list = "\n".join(str(folder) for folder in folders)
        choice = choose_one(
            [
                (keep_label, "keep"),
                (delete_label, "delete"),
                ("Cancel", "cancel"),
            ],
            prompt="Close current workspace> ",
            header=f"{label}\n{folder_list}",
        )
    else:
        choice = choose_one(
            [
                ("Close current workspace", "keep"),
                ("Cancel", "cancel"),
            ],
            prompt="Close current workspace> ",
            header=f"{label}\nNo project folder was found under configured roots.",
        )

    if choice == "cancel":
        raise Cancelled
    if choice == "delete":
        start_background_workspace_deletion(
            workspace_id,
            manifest,
            folders,
        )
        return
    run([HERDR, "workspace", "close", workspace_id])


def close_current_pane_or_workspace() -> None:
    workspace = current_workspace_to_close()
    workspace_id = str(workspace["workspace_id"])
    pane_count = int(workspace.get("pane_count") or 0)
    if pane_count <= 1:
        close_workspace(workspace)
        return

    panes = [
        pane
        for pane in pane_records()
        if str(pane.get("workspace_id") or "") == workspace_id
    ]
    pane = next((pane for pane in panes if pane.get("focused")), None)
    if pane is None:
        environment_pane_id = os.environ.get("HERDR_PANE_ID", "")
        pane = next(
            (
                pane
                for pane in panes
                if str(pane.get("pane_id") or "") == environment_pane_id
            ),
            None,
        )
    if pane is None or not pane.get("pane_id"):
        raise WorkspaceError("Herdr did not report a current pane to close.")
    run([HERDR, "pane", "close", str(pane["pane_id"])])


def main(
    action: str = "open", action_arguments: Sequence[str] = ()
) -> int:
    try:
        if action.startswith("_background-delete-"):
            require_commands(HERDR)
            perform_background_deletion(action, action_arguments)
            return 0
        require_commands(HERDR, FZF, GIT)
        if action == "open":
            open_workspace(hosts())
        elif action == "close":
            close_workspace()
        elif action == "close-pane":
            close_current_pane_or_workspace()
        else:
            raise WorkspaceError(f"Unknown workspace action: {action}")
        return 0
    except Cancelled:
        return 0
    except KeyboardInterrupt:
        return 130
    except WorkspaceError as error:
        pause(str(error))
        return 1


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "open"
    raise SystemExit(main(action, sys.argv[2:]))
