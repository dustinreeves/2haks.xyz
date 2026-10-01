"""Run from the api/ folder:  python3 -m unittest discover -s tests"""

import copy
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path

from app.cards import CardError, load_projects, save_projects, validate_card, validate_projects

GOOD = {
    "slug": "demo-app",
    "name": "Demo App",
    "launch_date": "2026-10-01",
    "url": "https://demo-app.2haks.xyz",
    "description": "A demo.",
    "author": "Tripp",
    "examples": {"api": ["curl https://demo-app.2haks.xyz/api/health"], "cli": []},
}

REPO_PROJECTS = Path(__file__).resolve().parents[2] / "projects.json"


def changed(**fields):
    card = copy.deepcopy(GOOD)
    card.update(fields)
    return card


class ValidateCardTests(unittest.TestCase):
    def test_good_card_passes(self):
        self.assertEqual(validate_card(copy.deepcopy(GOOD)), GOOD)

    def test_bad_cards_fail(self):
        bad = {
            "missing field": {k: v for k, v in GOOD.items() if k != "url"},
            "unknown field": changed(colour="blue"),
            "slug with capitals": changed(slug="Demo"),
            "slug with spaces": changed(slug="demo app"),
            "empty name": changed(name=""),
            "padded name": changed(name=" Demo "),
            "http url": changed(url="http://demo.2haks.xyz"),
            "url without host": changed(url="https://"),
            "fake date": changed(launch_date="2026-02-30"),
            "compact date": changed(launch_date="20261001"),
            "unknown author": changed(author="Bob"),
            "long description": changed(description="x" * 301),
            "examples missing cli": changed(examples={"api": []}),
            "example not text": changed(examples={"api": [1], "cli": []}),
            "examples not lists": changed(examples={"api": "curl", "cli": []}),
        }
        for label, card in bad.items():
            with self.subTest(label):
                with self.assertRaises(CardError):
                    validate_card(card)

    def test_all_authors_allowed(self):
        for author in ("Dustin", "Tripp", "Co-authored"):
            validate_card(changed(author=author))


class ValidateProjectsTests(unittest.TestCase):
    def test_duplicate_slugs_fail(self):
        with self.assertRaises(CardError):
            validate_projects({"projects": [GOOD, GOOD]})

    def test_wrong_shape_fails(self):
        for data in ([GOOD], {"projects": GOOD}, {"projects": [], "extra": 1}):
            with self.subTest(data=data), self.assertRaises(CardError):
                validate_projects(data)

    def test_repo_projects_json_is_valid(self):
        self.assertTrue(load_projects(REPO_PROJECTS))


class SaveLoadTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "projects.json"

    def tearDown(self):
        self.dir.cleanup()

    def test_round_trip_keeps_mode_and_leaves_no_temp_files(self):
        self.path.write_text('{"projects": []}\n', encoding="utf-8")
        os.chmod(self.path, 0o664)
        save_projects(self.path, [GOOD])
        self.assertEqual(load_projects(self.path), [GOOD])
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o664)
        self.assertEqual(os.listdir(self.dir.name), ["projects.json"])

    def test_invalid_save_leaves_file_alone(self):
        original = '{"projects": []}\n'
        self.path.write_text(original, encoding="utf-8")
        with self.assertRaises(CardError):
            save_projects(self.path, [changed(author="Bob")])
        self.assertEqual(self.path.read_text(encoding="utf-8"), original)

    def test_broken_json_reports_line(self):
        self.path.write_text('{"projects": [\n', encoding="utf-8")
        with self.assertRaisesRegex(CardError, "line 2"):
            load_projects(self.path)

    def test_missing_file(self):
        with self.assertRaises(CardError):
            load_projects(self.path)

    def test_unicode_is_kept(self):
        card = changed(description="Fun with émojis 🎉")
        save_projects(self.path, [card])
        self.assertIn("🎉", self.path.read_text(encoding="utf-8"))
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["projects"][0], card)


if __name__ == "__main__":
    unittest.main()
