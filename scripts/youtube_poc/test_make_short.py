import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_short


class PrepareDirectorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_article_slug_runs_existing_director_and_returns_short_directory(self):
        with patch.object(make_short.subprocess, "run") as run:
            path, name = make_short.prepare_director(None, "plain-article-42", self.tmp.name)

        self.assertEqual(name, "plain-article-42")
        self.assertEqual(path, Path(self.tmp.name) / "short-plain-article-42" / "director.json")
        run.assert_called_once_with(
            [
                sys.executable,
                "-I",
                str(make_short.HERE / "make_director.py"),
                "plain-article-42",
                "--out",
                str(path),
            ],
            check=True,
        )

    def test_director_file_mode_is_preserved(self):
        path, name = make_short.prepare_director("directors/example.json", None, self.tmp.name)
        self.assertEqual(path, Path("directors/example.json"))
        self.assertEqual(name, "example")

    def test_article_slug_rejects_path_input(self):
        with self.assertRaisesRegex(ValueError, "article slug"):
            make_short.prepare_director(None, "../outside", self.tmp.name)

    def test_requires_exactly_one_input(self):
        with self.assertRaisesRegex(ValueError, "either"):
            make_short.prepare_director("director.json", "plain-article", self.tmp.name)
        with self.assertRaisesRegex(ValueError, "provide"):
            make_short.prepare_director(None, None, self.tmp.name)


if __name__ == "__main__":
    unittest.main()
