import importlib.util
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

    def test_suggested_workspace_name_uses_selected_repo_names(self):
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

    def test_group_repositories_separates_hosts_and_organizations(self):
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

    def test_choose_branch_selects_mode_before_listing_existing_branches(self):
        repo = {
            "hostname": "github.com",
            "full_name": "team/repo",
            "default_branch": "main",
        }
        with (
            mock.patch.object(
                workspace_manager,
                "ref_names",
                return_value=["feature", "main"],
            ),
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
                "local_branch_matches_origin",
                return_value=True,
            ),
            mock.patch.object(
                workspace_manager,
                "choose_one",
                side_effect=["__existing__", "feature"],
            ) as choose_one,
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
                "branch": "feature",
                "start_point": "origin/feature",
                "create": True,
                "reset": False,
            },
        )
        self.assertEqual(
            choose_one.call_args_list[0].args[0],
            [
                ("↻  Refresh branches from origin", "__refresh__"),
                ("Use an existing branch", "__existing__"),
                ("Create a new branch", "__new__"),
            ],
        )
        self.assertEqual(
            choose_one.call_args_list[1].args[0],
            [
                ("↻  Refresh branches from origin", "__refresh__"),
                ("main", "main"),
                ("feature", "feature"),
            ],
        )

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

    def test_repository_cache_round_trip(self):
        host = workspace_manager.Host(
            key="github",
            label="GitHub",
            hostname="github.com",
            root=Path("/projects"),
            public_org_repos_only=True,
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

    def test_branch_order_prefers_recent_then_default(self):
        repo = {
            "hostname": "github.com",
            "full_name": "team/repo",
            "default_branch": "main",
        }
        history = {
            workspace_manager.branch_history_key(repo, "feature"): 10.0
        }
        self.assertEqual(
            workspace_manager.order_branches(
                ["other", "main", "feature"],
                repo=repo,
                history=history,
            ),
            ["feature", "main", "other"],
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

            git("init", "-b", "main")
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
