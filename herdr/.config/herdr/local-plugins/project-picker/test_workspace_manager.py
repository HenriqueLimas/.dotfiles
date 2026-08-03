import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("workspace_manager.py")
SPEC = importlib.util.spec_from_file_location("workspace_manager", MODULE_PATH)
assert SPEC and SPEC.loader
workspace_manager = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = workspace_manager
SPEC.loader.exec_module(workspace_manager)


class WorkspaceManagerTest(unittest.TestCase):
    def test_slugify_keeps_branch_friendly_characters(self):
        self.assertEqual(workspace_manager.slugify("My feature / 42"), "My-feature-42")

    def test_slugify_rejects_punctuation_only_name(self):
        with self.assertRaises(workspace_manager.WorkspaceError):
            workspace_manager.slugify("...")

    def test_suggested_workspace_name_prefers_branch_name(self):
        self.assertEqual(
            workspace_manager.suggested_workspace_name(
                [
                    {
                        "full_name": "open-source/marko",
                        "branch": "feature/new-parser",
                    }
                ]
            ),
            "feature/new-parser",
        )

    def test_suggested_workspace_name_falls_back_to_repo_names(self):
        self.assertEqual(
            workspace_manager.suggested_workspace_name(
                [
                    {"full_name": "open-source/marko"},
                    {"full_name": "team/translator"},
                ]
            ),
            "marko-translator",
        )
        self.assertEqual(
            workspace_manager.suggested_workspace_name(
                [{"full_name": "team/translator"}]
            ),
            "translator",
        )

    def test_dependency_install_starts_ni_without_waiting(self):
        cwd = Path("/workspace")
        with (
            mock.patch.object(workspace_manager, "INSTALL_COMMAND", "ni"),
            mock.patch.object(
                workspace_manager.shutil,
                "which",
                return_value="/usr/local/bin/ni",
            ),
            mock.patch.object(
                workspace_manager.subprocess, "Popen"
            ) as popen,
        ):
            workspace_manager.start_dependency_install(cwd)

        popen.assert_called_once_with(
            ["ni"],
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

    def test_parse_worktree_list_reads_bare_and_linked_entries(self):
        entries = workspace_manager.parse_worktree_list(
            "\n".join(
                [
                    "worktree /repo.git",
                    "HEAD abc",
                    "bare",
                    "",
                    "worktree /workspace/demo",
                    "HEAD def",
                    "branch refs/heads/demo",
                    "",
                    "worktree /workspace/detached",
                    "HEAD ghi",
                    "detached",
                ]
            )
        )

        self.assertEqual(entries[0]["bare"], True)
        self.assertEqual(entries[1]["branch"], "demo")
        self.assertEqual(entries[2]["branch"], "")

    def test_repository_sources_discovers_nested_workspace_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = root / "marko-bindings"
            main = workspace / "main"
            feature = workspace / "feature"
            (main / ".git").mkdir(parents=True)
            feature.mkdir()
            (feature / ".git").write_text(
                "gitdir: ../main/.git/worktrees/feature\n",
                encoding="utf-8",
            )
            host = workspace_manager.Host(
                key="github",
                label="GitHub",
                hostname="github.com",
                root=root,
                public_repos_only=True,
            )

            sources = workspace_manager.repository_sources(host)

        self.assertEqual(sources, [main])

    def test_worktree_picker_defaults_to_open_and_toggles_with_right(self):
        host = workspace_manager.Host(
            key="ebay",
            label="eBay",
            hostname="github.corp.ebay.com",
            root=Path("/projects/ebay"),
            public_repos_only=False,
        )
        record = workspace_manager.WorktreeRecord(
            host=host,
            path=Path("/projects/ebay/evo-web"),
            source=Path("/projects/ebay/evo-web"),
            repo={
                "host_key": "ebay",
                "hostname": host.hostname,
                "full_name": "eBay/evo-web",
                "default_branch": "main",
            },
            branch="main",
        )
        with mock.patch.object(
            workspace_manager,
            "fzf_worktree_select_event",
            return_value=("worktree:0", "new"),
        ) as choose:
            choice, action = workspace_manager.choose_worktree_action(
                [record]
            )

        self.assertEqual((choice, action), ("worktree:0", "new"))
        rows = choose.call_args.args[0]
        self.assertIn("evo-web", rows[2][0])
        self.assertIn("└─", rows[3][0])
        self.assertIn("[open] new", rows[3][0])
        self.assertIn("open [new]", rows[3][1])

    def test_worktree_picker_groups_worktrees_under_workspace(self):
        host = workspace_manager.Host(
            key="github",
            label="GitHub",
            hostname="github.com",
            root=Path("/projects"),
            public_repos_only=True,
        )
        repo = {
            "host_key": "github",
            "hostname": host.hostname,
            "full_name": "team/repo",
            "default_branch": "main",
        }
        records = [
            workspace_manager.WorktreeRecord(
                host=host,
                path=Path(f"/projects/repo/{name}"),
                source=Path("/projects/repo/main"),
                repo=repo,
                branch=name,
            )
            for name in ("main", "feature")
        ]
        with mock.patch.object(
            workspace_manager,
            "fzf_worktree_select_event",
            return_value=("workspace:0", "new"),
        ) as choose:
            choice, action = workspace_manager.choose_worktree_action(records)

        self.assertEqual((choice, action), ("worktree:0", "open"))
        rows = choose.call_args.args[0]
        self.assertIn("repo", rows[2][0])
        self.assertIn("├─", rows[3][0])
        self.assertIn("└─", rows[4][0])
        self.assertEqual(rows[2][3], "GitHub repo")
        self.assertEqual(rows[3][3], "GitHub repo")
        self.assertEqual(rows[4][3], "GitHub repo")

    def test_worktree_tree_uses_path_beneath_workspace(self):
        host = workspace_manager.Host(
            key="github",
            label="GitHub",
            hostname="github.com",
            root=Path("/projects"),
            public_repos_only=True,
        )
        record = workspace_manager.WorktreeRecord(
            host=host,
            path=Path("/projects/repo/local-folder"),
            source=Path("/projects/repo/main"),
            repo={"full_name": "team/repo"},
            branch="feature/branch-name",
        )

        self.assertEqual(
            workspace_manager.worktree_tree_name(record, "repo"),
            "local-folder",
        )
        root_record = workspace_manager.WorktreeRecord(
            host=host,
            path=Path("/projects/repo"),
            source=Path("/projects/repo"),
            repo={"full_name": "team/repo"},
            branch="master",
        )
        self.assertEqual(
            workspace_manager.worktree_tree_name(root_record, "repo"),
            "main",
        )

    def test_grouped_worktrees_puts_default_branch_first(self):
        host = workspace_manager.Host(
            key="github",
            label="GitHub",
            hostname="github.com",
            root=Path("/projects"),
            public_repos_only=True,
        )
        repo = {
            "host_key": "github",
            "hostname": host.hostname,
            "full_name": "team/repo",
            "default_branch": "main",
        }
        records = [
            workspace_manager.WorktreeRecord(
                host=host,
                path=Path(f"/projects/repo/{branch}"),
                source=Path("/projects/repo/main"),
                repo=repo,
                branch=branch,
            )
            for branch in ("feature", "main", "release")
        ]

        groups = workspace_manager.grouped_worktrees(records)

        self.assertEqual(
            [record.branch for _, record in groups[0][1]],
            ["main", "feature", "release"],
        )

    def test_open_worktree_repairs_existing_sidebar_labels(self):
        path = Path("/projects/workspace/feature")
        with (
            mock.patch.object(Path, "is_dir", return_value=True),
            mock.patch.object(
                workspace_manager,
                "active_workspace_for",
                side_effect=["parent-id", "worktree-id"],
            ),
            mock.patch.object(workspace_manager, "run") as run,
            mock.patch.object(workspace_manager, "json_command") as command,
        ):
            workspace_manager.open_worktree(
                source=Path("/projects/workspace/main"),
                path=path,
                workspace_name="workspace",
                branch="feature/test",
            )

        self.assertEqual(
            run.call_args_list,
            [
                mock.call(
                    [
                        "herdr",
                        "workspace",
                        "rename",
                        "parent-id",
                        "workspace",
                    ]
                ),
                mock.call(
                    [
                        "herdr",
                        "workspace",
                        "rename",
                        "worktree-id",
                        "feature/test",
                    ]
                ),
                mock.call(
                    ["herdr", "workspace", "focus", "worktree-id"]
                ),
            ],
        )
        command.assert_not_called()

    def test_open_existing_worktree_uses_herdr_worktree_open(self):
        record = workspace_manager.WorktreeRecord(
            host=workspace_manager.Host(
                key="github",
                label="GitHub",
                hostname="github.com",
                root=Path("/projects"),
                public_repos_only=True,
            ),
            path=Path("/projects/repo/feature"),
            source=Path("/projects/repo/main"),
            repo={"full_name": "team/repo"},
            branch="feature",
        )
        with (
            mock.patch.object(Path, "is_dir", return_value=True),
            mock.patch.object(
                workspace_manager, "active_workspace_for", return_value=""
            ),
            mock.patch.object(
                workspace_manager,
                "json_command",
                return_value={"pane_id": "pane"},
            ) as command,
            mock.patch.object(workspace_manager, "start_dependency_install"),
            mock.patch.object(workspace_manager, "start_pi"),
        ):
            workspace_manager.open_existing_worktree(record)

        self.assertEqual(
            command.call_args_list,
            [
                mock.call(
                    [
                        "herdr",
                        "worktree",
                        "open",
                        "--cwd",
                        "/projects/repo/main",
                        "--path",
                        "/projects/repo/main",
                        "--label",
                        "repo",
                        "--no-focus",
                    ]
                ),
                mock.call(
                    [
                        "herdr",
                        "worktree",
                        "open",
                        "--cwd",
                        "/projects/repo/main",
                        "--path",
                        "/projects/repo/feature",
                        "--focus",
                    ]
                ),
            ],
        )

    def test_worktree_picker_uses_native_arrow_bindings(self):
        completed = subprocess.CompletedProcess(
            args=["fzf"],
            returncode=0,
            stdout="open\tnew\tworkspace\tworktree:0\n",
            stderr="",
        )
        with mock.patch.object(
            workspace_manager.subprocess,
            "run",
            return_value=completed,
        ) as run:
            selected = workspace_manager.fzf_worktree_select_event(
                [("open", "new", "worktree:0", "workspace")],
                prompt="Workspace> ",
            )

        self.assertEqual(selected, ("worktree:0", "open"))
        options = run.call_args.args[0]
        self.assertIn("--track", options)
        self.assertIn("--disabled", options)
        self.assertIn("--id-nth=4", options)
        binding = next(option for option in options if option.startswith("--bind="))
        self.assertIn("change:reload-sync", binding)
        self.assertIn("left:execute-silent", binding)
        self.assertIn("right:execute-silent", binding)
        self.assertIn("reload-sync", binding)
        self.assertIn("{4}", binding)
        self.assertNotIn("--expect=", " ".join(options))

    def test_default_branch_selection_never_prompts_for_another_branch(self):
        repo = {
            "hostname": "github.com",
            "full_name": "team/repo",
            "default_branch": "develop",
        }
        with mock.patch.object(
            workspace_manager, "fetch_remote_branch"
        ) as fetch:
            selection = workspace_manager.default_branch_selection(
                Path("/repo"), repo
            )

        fetch.assert_called_once_with(Path("/repo"), "develop")
        self.assertEqual(selection["start_point"], "origin/develop")
        self.assertEqual(selection["default_branch"], "develop")

    def test_new_worktree_uses_workspace_and_branch_path(self):
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        project_root = Path(root.name) / "ebay"
        host = workspace_manager.Host(
            key="ebay",
            label="eBay",
            hostname="github.corp.ebay.com",
            root=project_root,
            public_repos_only=False,
        )
        repo = {
            "host_key": "ebay",
            "hostname": host.hostname,
            "full_name": "eBay/evo-web",
            "default_branch": "main",
        }
        source = project_root / "evo-web"
        with (
            tempfile.TemporaryDirectory() as state,
            mock.patch.dict(
                workspace_manager.os.environ,
                {"HERDR_WORKSPACE_STATE_DIR": state},
            ),
            mock.patch.object(
                workspace_manager,
                "default_branch_selection",
                return_value={
                    "branch": "",
                    "default_branch": "main",
                    "start_point": "origin/main",
                    "create": True,
                },
            ),
            mock.patch.object(workspace_manager, "validate_branch_name"),
            mock.patch.object(
                workspace_manager, "local_branches", return_value=set()
            ),
            mock.patch.object(
                workspace_manager, "occupied_branches", return_value=set()
            ),
            mock.patch.object(
                workspace_manager, "remote_branch_exists", return_value=False
            ),
            mock.patch.object(workspace_manager, "add_worktree") as add,
            mock.patch.object(
                workspace_manager, "open_managed_worktree"
            ) as open_worktree,
        ):
            manifest = workspace_manager.create_new_worktree(
                repo=repo,
                source=source,
                storage_host=host,
                branch_name="feature/my-branch",
            )

        destination = host.root / "evo-web" / "feature" / "my-branch"
        self.assertEqual(Path(manifest["repos"][0]["path"]), destination)
        self.assertEqual(manifest["repos"][0]["branch"], "feature/my-branch")
        self.assertEqual(manifest["workspace_name"], "evo-web")
        add.assert_called_once()
        self.assertEqual(add.call_args.args[:2], (source, destination))
        open_worktree.assert_called_once_with(manifest)

    def test_open_managed_worktree_uses_herdr_worktree_membership(self):
        path = Path("/projects/ebay/evo-web/feature/test")
        manifest = {
            "workspace_name": "evo-web",
            "repos": [
                {
                    "source": "/projects/ebay/evo-web/main",
                    "path": str(path),
                    "branch": "feature/test",
                    "full_name": "eBay/evo-web",
                }
            ]
        }
        with (
            mock.patch.object(Path, "is_dir", return_value=True),
            mock.patch.object(
                workspace_manager, "active_workspace_for", return_value=""
            ),
            mock.patch.object(
                workspace_manager,
                "json_command",
                return_value={"workspace_id": "workspace", "pane_id": "pane"},
            ) as command,
            mock.patch.object(
                workspace_manager, "start_dependency_install"
            ) as install,
            mock.patch.object(workspace_manager, "start_pi") as start_pi,
        ):
            workspace_manager.open_managed_worktree(manifest)

        self.assertEqual(
            command.call_args_list,
            [
                mock.call(
                    [
                        "herdr",
                        "worktree",
                        "open",
                        "--cwd",
                        "/projects/ebay/evo-web/main",
                        "--path",
                        "/projects/ebay/evo-web/main",
                        "--label",
                        "evo-web",
                        "--no-focus",
                    ]
                ),
                mock.call(
                    [
                        "herdr",
                        "worktree",
                        "open",
                        "--cwd",
                        "/projects/ebay/evo-web/main",
                        "--path",
                        str(path),
                        "--focus",
                    ]
                ),
            ],
        )
        install.assert_called_once_with(path)
        start_pi.assert_called_once_with("pane", path)

    def test_new_herdr_workspace_installs_each_directory_in_background(self):
        first = Path("/workspace/first")
        second = Path("/workspace/second")
        with (
            mock.patch.object(
                workspace_manager,
                "json_command",
                side_effect=[
                    {"workspace_id": "workspace", "pane_id": "pane-1"},
                    {"pane_id": "pane-2"},
                ],
            ),
            mock.patch.object(
                workspace_manager, "start_dependency_install"
            ) as install,
            mock.patch.object(workspace_manager, "start_pi"),
        ):
            workspace_manager.create_herdr_workspace(
                name="feature",
                directories=[("first", first), ("second", second)],
            )

        self.assertEqual(
            install.call_args_list,
            [mock.call(first), mock.call(second)],
        )

    def test_group_repositories_separates_hosts_and_owners(self):
        repos = [
            {
                "host_key": "github",
                "host_label": "GitHub",
                "hostname": "github.com",
                "full_name": "marko-js/marko",
            },
            {
                "host_key": "github",
                "host_label": "GitHub",
                "hostname": "github.com",
                "full_name": "marko-js/language-server",
            },
            {
                "host_key": "ebay",
                "host_label": "eBay",
                "hostname": "github.corp.ebay.com",
                "full_name": "marko-js/internal-tools",
            },
        ]
        groups = workspace_manager.group_repositories(repos)
        self.assertEqual(
            [
                (group_key, [repo["full_name"] for repo in group_repos])
                for group_key, group_repos in groups
            ],
            [
                (("ebay", "marko-js"), ["marko-js/internal-tools"]),
                (
                    ("github", "marko-js"),
                    ["marko-js/marko", "marko-js/language-server"],
                ),
            ],
        )
        recent_groups = workspace_manager.group_repositories(
            repos,
            {"organization:github/marko-js": 10.0},
        )
        self.assertEqual(recent_groups[0][0], ("github", "marko-js"))

    def test_choose_branch_fetches_only_latest_default_branch(self):
        repo = {
            "hostname": "github.com",
            "full_name": "team/repo",
            "default_branch": "main",
        }
        with (
            mock.patch.object(
                workspace_manager,
                "local_branches",
                return_value={"main"},
            ),
            mock.patch.object(
                workspace_manager,
                "occupied_branches",
                return_value=set(),
            ),
            mock.patch.object(
                workspace_manager,
                "choose_one",
                return_value="__default__",
            ) as choose_one,
            mock.patch.object(
                workspace_manager,
                "fetch_remote_branch",
            ) as fetch,
            mock.patch.object(
                workspace_manager,
                "load_selection_history",
                return_value={},
            ),
            mock.patch.object(workspace_manager, "mark_recent"),
        ):
            selection = workspace_manager.choose_branch(Path("/repo"), repo)

        self.assertEqual(
            selection,
            {
                "branch": "main",
                "start_point": "origin/main",
                "create": False,
                "reset": True,
            },
        )
        self.assertEqual(
            choose_one.call_args.args[0],
            [
                ("Create a new branch", "__new__"),
                ("Use latest default branch (main)", "__default__"),
                ("Use another existing upstream branch", "__existing__"),
            ],
        )
        fetch.assert_called_once_with(Path("/repo"), "main")

    def test_new_branch_accepts_typed_non_default_base(self):
        repo = {
            "hostname": "github.com",
            "full_name": "team/repo",
            "default_branch": "main",
        }
        with (
            mock.patch.object(
                workspace_manager, "choose_one", return_value="__new__"
            ),
            mock.patch.object(
                workspace_manager,
                "prompt_text",
                side_effect=["feature/new", "release"],
            ),
            mock.patch.object(
                workspace_manager, "local_branches", return_value=set()
            ),
            mock.patch.object(
                workspace_manager,
                "remote_branch_exists",
                return_value=False,
            ),
            mock.patch.object(
                workspace_manager, "fetch_remote_branch"
            ) as fetch,
            mock.patch.object(
                workspace_manager,
                "load_selection_history",
                return_value={},
            ),
            mock.patch.object(workspace_manager, "mark_recent"),
            mock.patch.object(workspace_manager, "validate_branch_name"),
        ):
            selection = workspace_manager.choose_branch(Path("/repo"), repo)

        self.assertEqual(
            selection,
            {
                "branch": "feature/new",
                "start_point": "origin/release",
                "create": True,
            },
        )
        fetch.assert_called_once_with(Path("/repo"), "release")

    def test_fzf_event_reports_space_separately_from_selected_row(self):
        completed = subprocess.CompletedProcess(
            args=["fzf"],
            returncode=0,
            stdout="space\n[x] repo\trepo:0\n",
            stderr="",
        )
        with mock.patch.object(
            workspace_manager.subprocess,
            "run",
            return_value=completed,
        ):
            pressed, selected = workspace_manager.choose_one_event(
                [("[ ] repo", "repo:0")],
                prompt="Repo> ",
                expect=("space",),
            )
        self.assertEqual((pressed, selected), ("space", "repo:0"))

    def test_fzf_event_reports_minus_separately_from_selected_row(self):
        completed = subprocess.CompletedProcess(
            args=["fzf"],
            returncode=0,
            stdout="-\n[x] repo\trepo:0\n",
            stderr="",
        )
        with mock.patch.object(
            workspace_manager.subprocess,
            "run",
            return_value=completed,
        ):
            pressed, selected = workspace_manager.choose_one_event(
                [("[ ] repo", "repo:0")],
                prompt="Repo> ",
                expect=("space", "-"),
            )
        self.assertEqual((pressed, selected), ("-", "repo:0"))

    def test_minus_returns_from_repositories_to_owner_page(self):
        host = workspace_manager.Host(
            key="github",
            label="GitHub",
            hostname="github.com",
            root=Path("/projects"),
            public_repos_only=True,
        )
        repos = [
            {
                "host_key": "github",
                "host_label": "GitHub",
                "hostname": "github.com",
                "full_name": "team/repo",
                "description": "",
            }
        ]
        with (
            mock.patch.object(
                workspace_manager,
                "load_repository_catalog",
                return_value=repos,
            ),
            mock.patch.object(
                workspace_manager,
                "load_selection_history",
                return_value={},
            ),
            mock.patch.object(
                workspace_manager,
                "choose_one",
                side_effect=[
                    "organization:0",
                    workspace_manager.Cancelled(),
                ],
            ) as choose_one,
            mock.patch.object(
                workspace_manager,
                "choose_one_event",
                return_value=("-", "repo:0"),
            ),
            mock.patch.object(workspace_manager, "mark_recent"),
        ):
            with self.assertRaises(workspace_manager.Cancelled):
                workspace_manager.choose_repositories((host,))

        self.assertEqual(choose_one.call_count, 2)

    def test_repository_cache_round_trip(self):
        host = workspace_manager.Host(
            key="github",
            label="GitHub",
            hostname="github.com",
            root=Path("/projects"),
            public_repos_only=True,
        )
        repos = [{"full_name": "team/repo"}]
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(
                workspace_manager.os.environ,
                {"HERDR_WORKSPACE_STATE_DIR": directory},
            ):
                workspace_manager.write_repository_cache(host, repos)
                self.assertEqual(
                    workspace_manager.read_repository_cache(host),
                    repos,
                )

    def test_repository_cache_rejects_legacy_unversioned_catalog(self):
        host = workspace_manager.Host(
            key="github",
            label="GitHub",
            hostname="github.com",
            root=Path("/projects"),
            public_repos_only=True,
        )
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(
                workspace_manager.os.environ,
                {"HERDR_WORKSPACE_STATE_DIR": directory},
            ):
                cache_path = workspace_manager.repository_cache_path(host)
                cache_path.parent.mkdir(parents=True)
                cache_path.write_text(
                    '[{"full_name": "team/repo"}]\n',
                    encoding="utf-8",
                )
                self.assertIsNone(
                    workspace_manager.read_repository_cache(host)
                )

    def test_public_host_repos_include_user_and_organization_owners(self):
        host = workspace_manager.Host(
            key="github",
            label="GitHub",
            hostname="github.com",
            root=Path("/projects"),
            public_repos_only=True,
        )
        api_repos = [
            {
                "full_name": "HenriqueLimas/dotfiles",
                "private": False,
                "owner": {"type": "User"},
            },
            {
                "full_name": "marko-js/marko",
                "private": False,
                "owner": {"type": "Organization"},
            },
            {
                "full_name": "HenriqueLimas/private-repo",
                "private": True,
                "owner": {"type": "User"},
            },
        ]
        completed = subprocess.CompletedProcess(
            args=["gh"],
            returncode=0,
            stdout=json.dumps([api_repos]),
            stderr="",
        )
        with mock.patch.object(
            workspace_manager,
            "run",
            return_value=completed,
        ) as run:
            repos = workspace_manager.fetch_host_repos(host)

        self.assertEqual(
            [repo["full_name"] for repo in repos],
            ["HenriqueLimas/dotfiles", "marko-js/marko"],
        )
        self.assertIn("visibility=public", run.call_args.args[0][-1])

    def test_fetch_remote_branch_fetches_only_requested_branch(self):
        source = Path("/repo")
        with (
            mock.patch.object(workspace_manager, "validate_branch_name"),
            mock.patch.object(
                workspace_manager, "git_output"
            ) as git_output,
        ):
            workspace_manager.fetch_remote_branch(source, "feature/test")

        git_output.assert_called_once_with(
            source,
            "fetch",
            "--no-tags",
            "origin",
            "+refs/heads/feature/test:refs/remotes/origin/feature/test",
        )

    def test_parse_gpg_secret_keys_filters_by_email_and_signing_use(self):
        def record(record_type, **values):
            fields = [""] * 12
            fields[0] = record_type
            indexes = {
                "validity": 1,
                "key_id": 4,
                "created": 5,
                "expires": 6,
                "value": 9,
                "capabilities": 11,
            }
            for key, value in values.items():
                fields[indexes[key]] = str(value)
            return ":".join(fields)

        output = "\n".join(
            [
                record(
                    "sec",
                    validity="u",
                    key_id="AAAABBBBCCCCDDDD",
                    created=1700000000,
                    capabilities="c",
                ),
                record("fpr", value="A" * 40),
                record(
                    "uid",
                    value=(
                        "HenriqueLimas "
                        "<henrique.ramos.limas@gmail.com>"
                    ),
                ),
                record(
                    "ssb",
                    validity="u",
                    expires=2000000000,
                    capabilities="s",
                ),
                record(
                    "sec",
                    validity="u",
                    key_id="EEEEFFFF00001111",
                    created=1700000000,
                    capabilities="sc",
                ),
                record("fpr", value="B" * 40),
                record("uid", value="Other <other@example.com>"),
                record(
                    "sec",
                    validity="e",
                    key_id="2222333344445555",
                    created=1600000000,
                    capabilities="sc",
                ),
                record("fpr", value="C" * 40),
                record(
                    "uid",
                    value="Old <henrique.ramos.limas@gmail.com>",
                ),
            ]
        )

        keys = workspace_manager.parse_gpg_secret_keys(
            output,
            "henrique.ramos.limas@gmail.com",
            now=1800000000,
        )

        self.assertEqual(len(keys), 1)
        self.assertEqual(keys[0]["fingerprint"], "A" * 40)
        self.assertEqual(keys[0]["key_id"], "AAAABBBBCCCCDDDD")

    def test_choose_gpg_signing_key_lists_matching_keys(self):
        keys = [
            {
                "fingerprint": "A" * 40,
                "key_id": "AAAABBBBCCCCDDDD",
                "created": "1700000000",
                "expires": "",
                "uids": [
                    "HenriqueLimas <henrique.ramos.limas@gmail.com>"
                ],
            }
        ]
        with (
            mock.patch.object(
                workspace_manager,
                "gpg_secret_keys",
                return_value=keys,
            ),
            mock.patch.object(
                workspace_manager,
                "choose_one",
                return_value="A" * 40,
            ) as choose_one,
        ):
            selected = workspace_manager.choose_gpg_signing_key(
                "henrique.ramos.limas@gmail.com"
            )

        self.assertEqual(selected, "A" * 40)
        self.assertIn(
            "AAAABBBBCCCCDDDD",
            choose_one.call_args.args[0][0][0],
        )

    def test_canonical_remote_supports_ssh_and_https(self):
        self.assertEqual(
            workspace_manager.canonical_remote("git@github.com:OpenAI/codex.git"),
            ("github.com", "openai/codex"),
        )
        self.assertEqual(
            workspace_manager.canonical_remote(
                "https://github.corp.ebay.com/Org/Repo.git"
            ),
            ("github.corp.ebay.com", "org/repo"),
        )

    def test_prepare_source_reuses_existing_repository_without_fetching(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "repo"
            source.mkdir()
            host = workspace_manager.Host(
                key="github",
                label="GitHub",
                hostname="github.com",
                root=root,
                public_repos_only=True,
            )
            with (
                mock.patch.object(
                    workspace_manager,
                    "find_existing_source",
                    return_value=source,
                ),
                mock.patch.object(
                    workspace_manager, "git_output"
                ) as git_output,
            ):
                result = workspace_manager.prepare_source(
                    host,
                    {
                        "hostname": "github.com",
                        "full_name": "team/repo",
                        "default_branch": "main",
                    },
                )

        self.assertEqual(result, source)
        git_output.assert_not_called()

    def test_prepare_source_searches_both_development_roots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            github = workspace_manager.Host(
                key="github",
                label="GitHub",
                hostname="github.com",
                root=root / "github",
                public_repos_only=True,
            )
            ebay = workspace_manager.Host(
                key="ebay",
                label="eBay",
                hostname="github.corp.ebay.com",
                root=root / "ebay",
                public_repos_only=False,
            )
            source = ebay.root / "evo-web"
            with mock.patch.object(
                workspace_manager,
                "find_existing_source",
                side_effect=[None, source],
            ) as find:
                result = workspace_manager.prepare_source(
                    github,
                    {
                        "hostname": "github.com",
                        "full_name": "eBay/evo-web",
                        "default_branch": "main",
                    },
                    (github, ebay),
                )

        self.assertEqual(result, source)
        self.assertEqual(
            [call.args[0] for call in find.call_args_list],
            [github, ebay],
        )
        self.assertTrue(
            all(
                call.kwargs["hostname"] == "github.com"
                for call in find.call_args_list
            )
        )

    def test_flatten_pages_accepts_gh_slurp_shape(self):
        pages = [[{"full_name": "one/a"}], [{"full_name": "two/b"}]]
        self.assertEqual(
            workspace_manager.flatten_pages(pages),
            [{"full_name": "one/a"}, {"full_name": "two/b"}],
        )

    def test_path_contains_accepts_child_but_not_sibling(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            child = root / "src"
            sibling = Path(directory) / "repo-other"
            child.mkdir(parents=True)
            sibling.mkdir()
            self.assertTrue(workspace_manager.path_contains(root, child))
            self.assertFalse(workspace_manager.path_contains(root, sibling))

    def test_local_projects_includes_git_folders_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            git_repo = root / "repo"
            plain_folder = root / "notes"
            hidden_repo = root / ".dotfiles"
            herdr_state = root / ".herdr"
            for path in (git_repo, plain_folder, hidden_repo, herdr_state):
                path.mkdir()
            (git_repo / ".git").mkdir()
            (root / "README.md").touch()
            host = workspace_manager.Host(
                key="github",
                label="GitHub",
                hostname="github.com",
                root=root,
                public_repos_only=True,
            )

            projects = workspace_manager.local_projects((host,))

            self.assertEqual(
                [path.name for _, path in projects],
                ["repo"],
            )

    def test_current_workspace_to_close_uses_focused_workspace(self):
        with (
            mock.patch.object(
                workspace_manager,
                "workspace_records",
                return_value=[
                    {"workspace_id": "other", "focused": False},
                    {
                        "workspace_id": "current",
                        "label": "Current project",
                        "focused": True,
                    },
                ],
            ),
            mock.patch.dict(
                workspace_manager.os.environ,
                {"HERDR_WORKSPACE_ID": "other"},
            ),
        ):
            workspace = workspace_manager.current_workspace_to_close()

        self.assertEqual(workspace["workspace_id"], "current")

    def test_project_folders_are_derived_from_current_workspace_panes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current = root / "current"
            other = root / "other"
            (current / "src").mkdir(parents=True)
            other.mkdir()
            host = workspace_manager.Host(
                key="github",
                label="GitHub",
                hostname="github.com",
                root=root,
                public_repos_only=True,
            )
            with mock.patch.object(
                workspace_manager,
                "pane_records",
                return_value=[
                    {"workspace_id": "current", "cwd": str(current / "src")},
                    {"workspace_id": "other", "cwd": str(other)},
                ],
            ):
                folders = workspace_manager.project_folders_for_workspace(
                    "current", (host,)
                )

        self.assertEqual(folders, [current])

    def test_close_workspace_queues_current_folder_deletion(self):
        folder = Path("/projects/current")
        hosts = (mock.sentinel.host,)
        with (
            mock.patch.object(
                workspace_manager,
                "current_workspace_to_close",
                return_value={
                    "workspace_id": "current",
                    "label": "Current project",
                },
            ),
            mock.patch.object(workspace_manager, "hosts", return_value=hosts),
            mock.patch.object(workspace_manager, "load_manifests", return_value=[]),
            mock.patch.object(
                workspace_manager,
                "manifest_for_workspace",
                return_value=None,
            ),
            mock.patch.object(
                workspace_manager,
                "project_folders_for_workspace",
                return_value=[folder],
            ),
            mock.patch.object(
                workspace_manager,
                "choose_one",
                return_value="delete",
            ) as choose_one,
            mock.patch.object(
                workspace_manager,
                "start_background_workspace_deletion",
            ) as start_deletion,
            mock.patch.object(workspace_manager, "run") as run,
        ):
            workspace_manager.close_workspace()

        self.assertEqual(
            choose_one.call_args.args[0],
            [
                ("Close workspace and keep folder", "keep"),
                ("Close workspace and permanently delete folder", "delete"),
                ("Cancel", "cancel"),
            ],
        )
        self.assertEqual(
            choose_one.call_args.kwargs["header"],
            "Current project\n/projects/current",
        )
        start_deletion.assert_called_once_with(
            "current",
            None,
            [folder],
        )
        run.assert_not_called()

    def test_background_deletion_is_detached_and_logged(self):
        folder = Path("/projects/current")
        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.dict(
                workspace_manager.os.environ,
                {"HERDR_WORKSPACE_STATE_DIR": directory},
            ),
            mock.patch.object(
                workspace_manager.subprocess, "Popen"
            ) as popen,
        ):
            workspace_manager.start_background_workspace_deletion(
                "current",
                None,
                [folder],
            )

        command = popen.call_args.args[0]
        self.assertEqual(
            command,
            [
                sys.executable,
                str(Path(workspace_manager.__file__).resolve()),
                "_background-delete-projects",
                "current",
                str(folder),
            ],
        )
        self.assertEqual(popen.call_args.kwargs["cwd"], Path.home())
        self.assertEqual(
            popen.call_args.kwargs["stdin"], subprocess.DEVNULL
        )
        self.assertEqual(
            popen.call_args.kwargs["stderr"], subprocess.STDOUT
        )
        self.assertTrue(popen.call_args.kwargs["start_new_session"])

    def test_background_worker_closes_workspace_before_deleting_folder(self):
        folder = Path("/projects/current")
        all_hosts = (mock.sentinel.host,)
        events = []

        def record_close(*_args, **_kwargs):
            events.append("close")

        def record_delete(*_args, **_kwargs):
            events.append("delete")

        with (
            mock.patch.object(
                workspace_manager, "run", side_effect=record_close
            ) as run,
            mock.patch.object(
                workspace_manager,
                "delete_project_folders",
                side_effect=record_delete,
            ) as delete,
            mock.patch.object(
                workspace_manager, "hosts", return_value=all_hosts
            ),
        ):
            workspace_manager.perform_background_deletion(
                "_background-delete-projects",
                ["current", str(folder)],
            )

        self.assertEqual(events, ["close", "delete"])
        run.assert_called_once_with(
            [workspace_manager.HERDR, "workspace", "close", "current"]
        )
        delete.assert_called_once_with([folder], all_hosts)

    def test_delete_project_folders_removes_full_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = root / "project"
            project.mkdir()
            (project / "untracked.txt").write_text("delete me", encoding="utf-8")
            host = workspace_manager.Host(
                key="github",
                label="GitHub",
                hostname="github.com",
                root=root,
                public_repos_only=True,
            )

            workspace_manager.delete_project_folders([project], (host,))

            self.assertFalse(project.exists())

    def test_prefix_x_closes_focused_pane_when_workspace_has_multiple(self):
        workspace = {"workspace_id": "current", "pane_count": 2}
        with (
            mock.patch.object(
                workspace_manager,
                "current_workspace_to_close",
                return_value=workspace,
            ),
            mock.patch.object(
                workspace_manager,
                "pane_records",
                return_value=[
                    {
                        "workspace_id": "current",
                        "pane_id": "current-pane",
                        "focused": True,
                    },
                    {
                        "workspace_id": "current",
                        "pane_id": "other-pane",
                        "focused": False,
                    },
                ],
            ),
            mock.patch.object(workspace_manager, "close_workspace") as close,
            mock.patch.object(workspace_manager, "run") as run,
        ):
            workspace_manager.close_current_pane_or_workspace()

        close.assert_not_called()
        run.assert_called_once_with(
            [workspace_manager.HERDR, "pane", "close", "current-pane"]
        )

    def test_prefix_x_prompts_for_workspace_when_closing_last_pane(self):
        workspace = {"workspace_id": "current", "pane_count": 1}
        with (
            mock.patch.object(
                workspace_manager,
                "current_workspace_to_close",
                return_value=workspace,
            ),
            mock.patch.object(workspace_manager, "close_workspace") as close,
            mock.patch.object(workspace_manager, "pane_records") as panes,
        ):
            workspace_manager.close_current_pane_or_workspace()

        close.assert_called_once_with(workspace)
        panes.assert_not_called()

    def test_main_dispatches_close_action(self):
        with (
            mock.patch.object(workspace_manager, "require_commands"),
            mock.patch.object(workspace_manager, "close_workspace") as close,
            mock.patch.object(workspace_manager, "open_workspace") as open_,
        ):
            result = workspace_manager.main("close")

        self.assertEqual(result, 0)
        close.assert_called_once_with()
        open_.assert_not_called()

    def test_nested_worktree_is_ignored_and_exclusion_is_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "workspace"
            source.mkdir()

            def git(*args):
                return subprocess.run(
                    ["git", "-C", str(source), *args],
                    check=True,
                    text=True,
                    capture_output=True,
                )

            git("init", "-b", "main")
            (source / "README.md").write_text("test\n", encoding="utf-8")
            git("add", "README.md")
            git(
                "-c",
                "user.name=Workspace Test",
                "-c",
                "user.email=workspace@example.test",
                "-c",
                "commit.gpgSign=false",
                "commit",
                "-m",
                "initial",
            )
            git(
                "update-ref",
                "refs/remotes/origin/main",
                "refs/heads/main",
            )

            destination = source / "feature" / "test"
            workspace_manager.add_worktree(
                source,
                destination,
                {
                    "branch": "feature/test",
                    "start_point": "origin/main",
                    "create": True,
                },
            )

            self.assertEqual(git("status", "--porcelain").stdout, "")
            exclude_path = Path(
                git("rev-parse", "--git-path", "info/exclude").stdout.strip()
            )
            if not exclude_path.is_absolute():
                exclude_path = source / exclude_path
            self.assertIn(
                "/feature/test/",
                exclude_path.read_text(encoding="utf-8").splitlines(),
            )

            workspace_manager.remove_worktree(source, destination)

            self.assertFalse(destination.exists())
            self.assertNotIn(
                "# herdr-worktree /feature/test/",
                exclude_path.read_text(encoding="utf-8"),
            )

    def test_add_and_remove_new_branch_worktree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()

            def git(*args):
                return subprocess.run(
                    ["git", "-C", str(source), *args],
                    check=True,
                    text=True,
                    capture_output=True,
                )

            git("init", "--bare", "-b", "main")
            subprocess.run(
                ["git", "-C", str(source), "fast-import", "--quiet"],
                input=(
                    "blob\nmark :1\ndata 5\ntest\n"
                    "commit refs/heads/main\nmark :2\n"
                    "author Workspace Test <workspace@example.test> 0 +0000\n"
                    "committer Workspace Test <workspace@example.test> 0 +0000\n"
                    "data 7\ninitial\nM 100644 :1 README.md\n\n"
                ),
                check=True,
                text=True,
                capture_output=True,
            )
            git(
                "update-ref",
                "refs/remotes/origin/main",
                "refs/heads/main",
            )

            destination = root / "workspaces" / "demo" / "repo"
            workspace_manager.add_worktree(
                source,
                destination,
                {
                    "branch": "feature/test",
                    "start_point": "origin/main",
                    "create": True,
                },
            )
            workspace_manager.configure_github_worktree(
                source,
                destination,
                "A" * 40,
            )
            branch = subprocess.run(
                [
                    "git",
                    "-C",
                    str(destination),
                    "branch",
                    "--show-current",
                ],
                check=True,
                text=True,
                capture_output=True,
            ).stdout.strip()
            self.assertEqual(branch, "feature/test")
            worktree_config = {
                key: value
                for key, value in (
                    line.split(" ", 1)
                    for line in subprocess.run(
                        [
                            "git",
                            "-C",
                            str(destination),
                            "config",
                            "--worktree",
                            "--get-regexp",
                            (
                                "^(user\\.(name|email|signingkey)"
                                "|gpg\\.(format|program)"
                                "|commit\\.gpgsign|core\\.bare)$"
                            ),
                        ],
                        check=True,
                        text=True,
                        capture_output=True,
                    ).stdout.splitlines()
                )
            }
            self.assertEqual(
                worktree_config,
                {
                    "core.bare": "false",
                    "user.name": "HenriqueLimas",
                    "user.email": "henrique.ramos.limas@gmail.com",
                    "user.signingkey": "A" * 40,
                    "gpg.format": "openpgp",
                    "gpg.program": "gpg",
                    "commit.gpgsign": "true",
                },
            )

            workspace_manager.remove_worktree(source, destination)
            self.assertFalse(destination.exists())

            git("branch", "release", "main")
            git(
                "update-ref",
                "refs/remotes/origin/release",
                "refs/heads/main",
            )
            release_destination = root / "workspaces" / "release" / "repo"
            workspace_manager.add_worktree(
                source,
                release_destination,
                {
                    "branch": "release",
                    "start_point": "origin/release",
                    "create": False,
                    "reset": True,
                },
            )
            release_branch = subprocess.run(
                [
                    "git",
                    "-C",
                    str(release_destination),
                    "branch",
                    "--show-current",
                ],
                check=True,
                text=True,
                capture_output=True,
            ).stdout.strip()
            self.assertEqual(release_branch, "release")
            workspace_manager.remove_worktree(source, release_destination)


if __name__ == "__main__":
    unittest.main()
