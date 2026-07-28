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
                        "Escape returns"
                    ),
                    expect=("space",),
                )
            except Cancelled:
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


def find_existing_source(host: Host, full_name: str) -> Path | None:
    if not host.root.is_dir():
        return None
    target = (host.hostname.lower(), full_name.lower())
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


def prepare_source(host: Host, repo: dict[str, Any]) -> Path:
    host.root.mkdir(parents=True, exist_ok=True)
    existing = find_existing_source(host, repo["full_name"])
    if existing:
        source = existing
    else:
        repositories_dir = host.root / ".herdr" / "repositories"
        repositories_dir.mkdir(parents=True, exist_ok=True)
        source = repositories_dir / f"{repo_dir_name(repo['full_name'])}.git"
        created_cache = not source.exists()
        if created_cache:
            gh_env = dict(os.environ)
            gh_env["GH_HOST"] = host.hostname
            run(
                [
                    GH,
                    "repo",
                    "clone",
                    repo["full_name"],
                    str(source),
                    "--",
                    "--bare",
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
    if not existing and created_cache:
        git_output(source, "fetch", "--prune", "origin")
        # A bare clone initially copies remote heads into local heads. Remove
        # those seed refs after fetching origin/* so a selected existing
        # branch is created from the current remote tip.
        for branch in local_branches(source):
            git_output(source, "update-ref", "-d", f"refs/heads/{branch}")
    return source


def ref_names(source: Path, prefix: str) -> list[str]:
    output = git_output(
        source,
        "for-each-ref",
        "--format=%(refname:strip=3)",
        prefix,
        check=False,
    )
    return [line for line in output.splitlines() if line and line != "HEAD"]


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


def local_branch_matches_origin(source: Path, branch: str) -> bool:
    local = git_output(
        source,
        "rev-parse",
        "--verify",
        f"refs/heads/{branch}",
        check=False,
    )
    remote = git_output(
        source,
        "rev-parse",
        "--verify",
        f"refs/remotes/origin/{branch}",
        check=False,
    )
    return bool(local and remote and local == remote)


def refresh_branches(source: Path) -> None:
    git_output(source, "fetch", "--prune", "origin")


def branch_history_key(repo: dict[str, Any], branch: str) -> str:
    return (
        f"branch:{repo['hostname']}/{repo['full_name']}/{branch}"
    ).lower()


def order_branches(
    branches: Iterable[str],
    *,
    repo: dict[str, Any],
    history: dict[str, float],
) -> list[str]:
    default = repo["default_branch"]
    return sorted(
        set(branches),
        key=lambda branch: (
            -history.get(branch_history_key(repo, branch), 0.0),
            0 if branch == default else 1,
            branch.lower(),
        ),
    )


def validate_branch_name(name: str) -> None:
    result = run(
        [GIT, "check-ref-format", "--branch", name],
        check=False,
    )
    if result.returncode:
        raise WorkspaceError(f"Invalid branch name: {name}")


def choose_branch(
    source: Path, repo: dict[str, Any]
) -> dict[str, str | bool]:
    history = load_selection_history()
    while True:
        remote = order_branches(
            ref_names(source, "refs/remotes/origin"),
            repo=repo,
            history=history,
        )
        local = local_branches(source)
        occupied = occupied_branches(source)
        available = order_branches(
            (
                branch
                for branch in remote
                if branch not in occupied
                and (
                    branch not in local
                    or local_branch_matches_origin(source, branch)
                )
            ),
            repo=repo,
            history=history,
        )

        mode_rows: list[tuple[str, str]] = [
            ("↻  Refresh branches from origin", "__refresh__")
        ]
        if available:
            mode_rows.append(("Use an existing branch", "__existing__"))
        if remote:
            mode_rows.append(("Create a new branch", "__new__"))
        mode = choose_one(
            mode_rows,
            prompt=f"{repo['full_name']} branch> ",
            header="Choose branch mode or refresh the cached branch list",
        )
        if mode == "__refresh__":
            try:
                refresh_branches(source)
            except WorkspaceError as error:
                pause(str(error))
            continue
        if mode == "__existing__":
            choice = choose_one(
                [
                    ("↻  Refresh branches from origin", "__refresh__"),
                    *((branch, branch) for branch in available),
                ],
                prompt=f"{repo['full_name']} existing branch> ",
                header=(
                    "Remote branches only; checked-out or divergent local "
                    "branches are hidden"
                ),
            )
            if choice == "__refresh__":
                try:
                    refresh_branches(source)
                except WorkspaceError as error:
                    pause(str(error))
                continue
            mark_recent(history, branch_history_key(repo, choice))
            return {
                "branch": choice,
                "start_point": f"origin/{choice}",
                "create": choice not in local,
                "reset": choice in local,
            }

        base = choose_one(
            [
                ("↻  Refresh branches from origin", "__refresh__"),
                *(
                    (
                        f"{branch}  (default)"
                        if branch == repo["default_branch"]
                        else branch,
                        branch,
                    )
                    for branch in remote
                ),
            ],
            prompt=f"{repo['full_name']} base> ",
            header="Select the starting point for the new branch",
        )
        if base == "__refresh__":
            try:
                refresh_branches(source)
            except WorkspaceError as error:
                pause(str(error))
            continue
        mark_recent(history, branch_history_key(repo, base))
        branch = prompt_text(f"New branch for {repo['full_name']}")
        validate_branch_name(branch)
        if branch in local or branch in remote:
            raise WorkspaceError(f"Branch already exists: {branch}")
        mark_recent(history, branch_history_key(repo, branch))
        return {
            "branch": branch,
            "start_point": f"origin/{base}",
            "create": True,
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


def remove_worktree(source: Path, destination: Path) -> None:
    run([GIT, "-C", str(source), "worktree", "remove", str(destination)])
    for parent in (destination.parent, destination.parent.parent):
        try:
            parent.rmdir()
        except OSError:
            break


def create_workspace(all_hosts: Sequence[Host]) -> None:
    require_commands(GH, GIT)
    selected_repos = choose_repositories(all_hosts)
    github_signing_key = ""
    if any(repo["host_key"] == "github" for repo in selected_repos):
        require_commands(GPG)
        github_signing_key = choose_gpg_signing_key(GITHUB_AUTHOR_EMAIL)
    host_by_key = {host.key: host for host in all_hosts}
    prepared: list[dict[str, Any]] = []
    for repo in selected_repos:
        host = host_by_key[repo["host_key"]]
        source = prepare_source(host, repo)
        branch = choose_branch(source, repo)
        prepared.append(
            {
                **repo,
                **branch,
                "source": str(source),
            }
        )

    name = prompt_text(
        "Workspace name",
        default=suggested_workspace_name(selected_repos),
    )
    slug = slugify(name)
    if manifest_path(slug).exists():
        raise WorkspaceError(f"A managed workspace named {name!r} already exists.")

    seen_destinations: set[Path] = set()
    for repo in prepared:
        host = host_by_key[repo["host_key"]]
        destination = (
            host.root
            / ".herdr"
            / "workspaces"
            / slug
            / repo_dir_name(repo["full_name"])
        )
        if destination in seen_destinations or destination.exists():
            raise WorkspaceError(
                f"Workspace repository path already exists: {destination}"
            )
        seen_destinations.add(destination)
        repo["path"] = str(destination)

    created: list[dict[str, Any]] = []
    try:
        for repo in prepared:
            add_worktree(
                Path(repo["source"]),
                Path(repo["path"]),
                repo,
            )
            if repo["host_key"] == "github":
                configure_github_worktree(
                    Path(repo["source"]),
                    Path(repo["path"]),
                    github_signing_key,
                )
            created.append(repo)
    except (WorkspaceError, KeyboardInterrupt):
        for repo in reversed(created):
            try:
                remove_worktree(
                    Path(repo["source"]), Path(repo["path"])
                )
            except WorkspaceError:
                pass
        raise

    manifest = {
        "version": 1,
        "name": name,
        "slug": slug,
        "repos": [
            {
                "host_key": repo["host_key"],
                "hostname": repo["hostname"],
                "full_name": repo["full_name"],
                "default_branch": repo["default_branch"],
                "branch": repo["branch"],
                "source": repo["source"],
                "path": repo["path"],
            }
            for repo in prepared
        ],
    }
    save_manifest(manifest)
    history = load_selection_history()
    mark_recent(history, f"workspace:{manifest['slug']}")
    open_managed_workspace(manifest)


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
        start_pi(tab_pane_id, path)


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
                path.name.startswith(".")
                or not path.is_dir()
                or not (path / ".git").exists()
            ):
                continue
            projects.append((host, path))
    return sorted(projects, key=lambda item: (item[0].label, item[1].name.lower()))


def open_workspace(all_hosts: Sequence[Host]) -> None:
    history = load_selection_history()
    manifests = sorted(
        load_manifests(),
        key=lambda manifest: recent_sort_key(
            history,
            f"workspace:{manifest['slug']}",
            str(manifest["name"]),
        ),
    )
    rows: list[tuple[str, str]] = [
        ("+  Add a new multi-repository workspace", "action:create"),
        ("-  Delete or close a workspace", "action:close"),
    ]
    choices: dict[str, tuple[str, Any]] = {
        "action:create": ("create", None),
        "action:close": ("close", None),
    }
    for index, manifest in enumerate(manifests):
        valid = sum(
            1
            for repo in manifest["repos"]
            if repo.get("path") and Path(repo["path"]).is_dir()
        )
        key = f"managed:{index}"
        active = (
            "  [open]"
            if active_workspace_for(
                [
                    Path(repo["path"])
                    for repo in manifest["repos"]
                    if repo.get("path")
                ]
            )
            else ""
        )
        rows.append(
            (
                f"Workspace  {manifest['name']}  ({valid} repos){active}",
                key,
            )
        )
        choices[key] = ("managed", manifest)
    projects = sorted(
        local_projects(all_hosts),
        key=lambda item: recent_sort_key(
            history,
            f"project:{item[1].resolve()}",
            f"{item[0].label}/{item[1].name}",
        ),
    )
    for index, (host, path) in enumerate(projects):
        key = f"project:{index}"
        active = "  [open]" if active_workspace_for([path]) else ""
        rows.append((f"{host.label:<9}  {path.name}{active}", key))
        choices[key] = ("project", path)

    choice = choose_one(
        rows,
        prompt="Workspace> ",
        header="Actions, managed workspaces, and existing repositories",
    )
    kind, value = choices[choice]
    if kind == "create":
        create_workspace(all_hosts)
        return
    if kind == "close":
        close_workspace()
        return
    if kind == "managed":
        mark_recent(history, f"workspace:{value['slug']}")
        open_managed_workspace(value)
        return
    path = Path(value)
    mark_recent(history, f"project:{path.resolve()}")
    existing = active_workspace_for([path])
    if existing:
        run([HERDR, "workspace", "focus", existing])
        return
    create_herdr_workspace(
        name=path.name,
        directories=[(path.name, path)],
    )


def workspace_records() -> list[dict[str, Any]]:
    value = json_command([HERDR, "workspace", "list"])
    records = next(nested_values(value, "workspaces"), [])
    return [record for record in records if isinstance(record, dict)]


def choose_workspace_to_close() -> str:
    active = (
        os.environ.get("HERDR_ACTIVE_WORKSPACE_ID")
        or os.environ.get("HERDR_WORKSPACE_ID")
        or ""
    )
    records = workspace_records()
    ids = {
        str(record.get("workspace_id"))
        for record in records
        if record.get("workspace_id")
    }
    if active and active in ids:
        return active
    rows = []
    for record in records:
        workspace_id = str(record.get("workspace_id") or "")
        label = clean_field(
            record.get("label") or record.get("name") or workspace_id
        )
        if workspace_id:
            rows.append((label, workspace_id))
    return choose_one(rows, prompt="Close> ")


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


def dirty_worktrees(manifest: dict[str, Any]) -> list[Path]:
    dirty = []
    for repo in manifest["repos"]:
        path = Path(repo["path"])
        if not path.is_dir():
            continue
        status = git_output(
            path,
            "status",
            "--porcelain",
            "--untracked-files=normal",
        )
        if status:
            dirty.append(path)
    return dirty


def delete_managed_workspace(manifest: dict[str, Any]) -> None:
    require_commands(GIT)
    dirty = dirty_worktrees(manifest)
    if dirty:
        formatted = "\n".join(f"  {path}" for path in dirty)
        raise WorkspaceError(
            "Refusing to delete worktrees with uncommitted or untracked files:\n"
            + formatted
        )
    for repo in manifest["repos"]:
        path = Path(repo["path"])
        if path.exists():
            remove_worktree(Path(repo["source"]), path)
    path = manifest_path(manifest["slug"])
    if path.exists():
        path.unlink()


def close_workspace() -> None:
    workspace_id = choose_workspace_to_close()
    manifest = manifest_for_workspace(workspace_id, load_manifests())
    if manifest:
        choice = choose_one(
            [
                ("Keep workspace folders and close Herdr workspace", "keep"),
                (
                    "Delete clean managed worktrees and close Herdr workspace",
                    "delete",
                ),
                ("Cancel", "cancel"),
            ],
            prompt="Close workspace> ",
            header=manifest["name"],
        )
        if choice == "cancel":
            raise Cancelled
        if choice == "delete":
            delete_managed_workspace(manifest)
    else:
        choice = choose_one(
            [
                ("Keep project folder and close Herdr workspace", "keep"),
                ("Cancel", "cancel"),
            ],
            prompt="Close workspace> ",
            header="This folder is not manager-owned and will not be deleted",
        )
        if choice == "cancel":
            raise Cancelled
    run([HERDR, "workspace", "close", workspace_id])


def main() -> int:
    try:
        require_commands(HERDR, FZF)
        all_hosts = hosts()
        open_workspace(all_hosts)
        return 0
    except Cancelled:
        return 0
    except KeyboardInterrupt:
        return 130
    except WorkspaceError as error:
        pause(str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
