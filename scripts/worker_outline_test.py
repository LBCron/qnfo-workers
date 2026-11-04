#!/usr/bin/env python3
"""WORKER-OUTLINE-1 tests. Run: python scripts/worker_outline_test.py"""
import contextlib
import io
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import worker_outline as W  # noqa: E402

SRC = """var VERSION = "1";
async function alpha(env) {
  const a = 1;
  return a;
}
function beta() {
  return "__LONG__";
}
export async function gamma() { return 1; }
var tail = 2;
"""


def run(args, src=SRC.replace("__LONG__", "x" * 400)):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "worker.js")
        with open(p, "w", encoding="utf-8", newline="") as f:
            f.write(src)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = W.main([p] + args)
    return rc, buf.getvalue()


class Outline(unittest.TestCase):
    def test_lists_top_level_functions_with_lines(self):
        rc, out = run([])
        self.assertEqual(rc, 0)
        names = [l.split()[-1] for l in out.strip().splitlines()]
        self.assertEqual(names, ["alpha", "beta", "gamma"])
        self.assertTrue(out.splitlines()[0].split()[0] == "2")

    def test_grep_filters_case_insensitively(self):
        _, out = run(["--grep", "ALP"])
        self.assertEqual(len(out.strip().splitlines()), 1)

    def test_show_prints_only_that_function_and_cuts_long_lines(self):
        rc, out = run(["--show", "beta"])
        self.assertEqual(rc, 0)
        self.assertIn("// beta lines 6-8", out)
        self.assertNotIn("alpha", out)
        self.assertIn("...[+", out)
        _, full = run(["--show", "beta", "--full"])
        self.assertNotIn("...[+", full)

    def test_show_unknown_suggests_similar(self):
        rc, out = run(["--show", "alph"])
        self.assertEqual(rc, 1)
        self.assertIn("alpha", out)

    def test_find_reports_line_numbers(self):
        rc, out = run(["--find", "const a"])
        self.assertEqual(rc, 0)
        self.assertTrue(out.startswith("3:"))
        self.assertEqual(run(["--find", "nope"])[0], 1)

    def test_real_worker_outline_is_much_smaller_than_the_file(self):
        p = os.path.join(W.ROOT, "qnfo-github-steward", "worker.js")
        if not os.path.isfile(p):
            self.skipTest("worker not present")
        fns = W.outline(W.load(p))
        self.assertGreater(len(fns), 30)
        self.assertLess(len(fns), 400)


if __name__ == "__main__":
    unittest.main()
