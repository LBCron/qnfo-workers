import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import upload_youtube


class UploadPrivacyTests(unittest.TestCase):
    def test_private_is_the_default(self):
        self.assertEqual(upload_youtube.privacy_status(), "private")

    def test_public_requires_explicit_opt_in(self):
        self.assertEqual(upload_youtube.privacy_status(public=True), "public")


if __name__ == "__main__":
    unittest.main()
