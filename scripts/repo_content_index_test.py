import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import repo_content_index as m  # noqa: E402

OVERLOAD = (200, {"success": False, "errors": [{"code": 7429, "message": "D1 DB is overloaded"}]})
OK = (200, {"success": True, "result": [{"results": [{"id": 1}]}]})


class QRetry(unittest.TestCase):
    def test_retries_overload_then_succeeds(self):
        waits = []
        with mock.patch.object(m, "d1", side_effect=[OVERLOAD, OVERLOAD, OK]) as d:
            rows, err = m.q("a", "t", "db", "SELECT 1", sleep=waits.append)
        self.assertEqual((rows, err), ([{"id": 1}], None))
        self.assertEqual(d.call_count, 3)
        self.assertEqual(waits, [3, 8])

    def test_gives_up_after_budget(self):
        waits = []
        with mock.patch.object(m, "d1", return_value=OVERLOAD) as d:
            rows, err = m.q("a", "t", "db", "SELECT 1", sleep=waits.append)
        self.assertIsNone(rows)
        self.assertEqual(err[0]["code"], 7429)
        self.assertEqual(d.call_count, len(m.D1_RETRY_DELAYS) + 1)

    def test_non_transient_error_is_not_retried(self):
        bad = (400, {"success": False, "errors": [{"code": 7400, "message": "syntax"}]})
        with mock.patch.object(m, "d1", return_value=bad) as d:
            rows, err = m.q("a", "t", "db", "SELEC", sleep=lambda s: None)
        self.assertIsNone(rows)
        self.assertEqual(d.call_count, 1)


if __name__ == "__main__":
    unittest.main()
