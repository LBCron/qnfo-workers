import copy, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import profile_pack as pp


class T(unittest.TestCase):
    def setUp(self):
        self.led = pp.load()
        self.pack = pp.build(self.led)

    def test_pack_verifies(self):
        self.assertEqual(pp.verify(self.pack, self.led), [])

    def test_limits(self):
        self.assertLessEqual(len(self.pack["headline"]), pp.HEADLINE_MAX)
        self.assertLessEqual(len(self.pack["skills"]), pp.SKILLS_MAX)

    def test_invented_claim_fails(self):
        bad = copy.deepcopy(self.pack)
        bad["experience"][0]["bullets"].append("Led a team of 500 engineers.")
        self.assertTrue(pp.verify(bad, self.led))

    def test_drift(self):
        self.assertEqual(pp.drift(self.pack, pp.render_md(self.pack)), [])
        self.assertIn("headline", pp.drift(self.pack, "empty profile"))

    def test_jsonld(self):
        self.assertEqual(self.pack["json_ld"]["@type"], "Person")

    def test_json_resume(self):
        r = pp.json_resume(self.pack, self.led)
        self.assertEqual(len(r["work"]), len(self.pack["experience"]))
        self.assertEqual(r["basics"]["label"], self.pack["headline"])


if __name__ == "__main__":
    unittest.main()
