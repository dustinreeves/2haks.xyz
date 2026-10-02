"""Tests for the CLI's edit and remove commands.

Run from the api/ folder:  python3 -m unittest discover -s tests
Every test works on a temporary copy, never on the real projects.json.
"""

import contextlib
import copy
import importlib.machinery
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CLI_PATH = Path(__file__).resolve().parents[2] / "cli" / "showcase"
_loader = importlib.machinery.SourceFileLoader("showcase_cli", str(CLI_PATH))
_spec = importlib.util.spec_from_loader("showcase_cli", _loader)
cli = importlib.util.module_from_spec(_spec)
_loader.exec_module(cli)

CARD = {
    "slug": "demo-app",
    "name": "Demo App",
    "launch_date": "2026-10-01",
    "url": "https://demo-app.2haks.xyz",
    "description": "A demo.",
    "author": "Tripp",
    "examples": {"api": ["curl https://demo-app.2haks.xyz/api/health"], "cli": ["demo list"]},
}
OTHER = {**copy.deepcopy(CARD), "slug": "other", "name": "Other", "url": "https://other.2haks.xyz"}


class CliTestCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.file = Path(tmp.name) / "projects.json"
        self.write([CARD, OTHER])

    def write(self, projects):
        self.file.write_text(json.dumps({"projects": projects}), encoding="utf-8")

    def read(self):
        return json.loads(self.file.read_text(encoding="utf-8"))["projects"]

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(["--file", str(self.file), *argv])
        return code, out.getvalue(), err.getvalue()


class EditTests(CliTestCase):
    def test_changes_only_given_fields(self):
        code, out, _ = self.run_cli("edit", "demo-app", "--name", "Demo 2", "--author", "Co-authored")
        self.assertEqual(code, 0)
        self.assertIn("Updated 'demo-app'", out)
        card = self.read()[0]
        self.assertEqual(card["name"], "Demo 2")
        self.assertEqual(card["author"], "Co-authored")
        self.assertEqual(card["description"], CARD["description"])
        self.assertEqual(card["examples"], CARD["examples"])
        self.assertEqual(self.read()[1], OTHER)

    def test_examples_replace_and_clear(self):
        code, _, _ = self.run_cli("edit", "demo-app", "--cli-example", "a", "--cli-example", "b",
                                  "--clear-api-examples")
        self.assertEqual(code, 0)
        self.assertEqual(self.read()[0]["examples"], {"api": [], "cli": ["a", "b"]})

    def test_invalid_value_leaves_file_alone(self):
        before = self.file.read_bytes()
        code, _, err = self.run_cli("edit", "demo-app", "--launch-date", "2026-13-40")
        self.assertEqual(code, 1)
        self.assertIn("launch_date", err)
        self.assertEqual(self.file.read_bytes(), before)

    def test_unknown_slug(self):
        code, _, err = self.run_cli("edit", "nope", "--name", "X")
        self.assertEqual(code, 1)
        self.assertIn("no project called 'nope'", err)

    def test_nothing_to_change(self):
        code, _, err = self.run_cli("edit", "demo-app")
        self.assertEqual(code, 1)
        self.assertIn("nothing to change", err)
        code, _, err = self.run_cli("edit", "demo-app", "--name", CARD["name"])
        self.assertEqual(code, 1)
        self.assertIn("nothing to change", err)


class RemoveTests(CliTestCase):
    def test_remove_with_yes(self):
        code, out, _ = self.run_cli("remove", "demo-app", "--yes")
        self.assertEqual(code, 0)
        self.assertIn("Removed 'demo-app'", out)
        self.assertEqual(self.read(), [OTHER])

    def test_without_terminal_needs_yes(self):
        with mock.patch.object(cli.sys.stdin, "isatty", return_value=False):
            code, _, err = self.run_cli("remove", "demo-app")
        self.assertEqual(code, 1)
        self.assertIn("--yes", err)
        self.assertEqual(len(self.read()), 2)

    def test_confirm_by_typing_slug(self):
        with mock.patch.object(cli.sys.stdin, "isatty", return_value=True), \
                mock.patch("builtins.input", return_value="demo-app"):
            code, _, _ = self.run_cli("remove", "demo-app")
        self.assertEqual(code, 0)
        self.assertEqual(self.read(), [OTHER])

    def test_wrong_confirmation_keeps_card(self):
        with mock.patch.object(cli.sys.stdin, "isatty", return_value=True), \
                mock.patch("builtins.input", return_value="y"):
            code, _, err = self.run_cli("remove", "demo-app")
        self.assertEqual(code, 1)
        self.assertIn("not removed", err)
        self.assertEqual(len(self.read()), 2)

    def test_unknown_slug(self):
        code, _, err = self.run_cli("remove", "nope", "--yes")
        self.assertEqual(code, 1)
        self.assertIn("no project called 'nope'", err)


if __name__ == "__main__":
    unittest.main()
