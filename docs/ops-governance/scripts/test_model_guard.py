import copy
import io
import json
import os
import tempfile
import unittest
from contextlib import ExitStack, redirect_stdout
from unittest.mock import patch

import model_guard


class ClaudeGatewayModelGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "settings.json")
        self.settings_patch = patch.object(model_guard, "CLAUDE_SETTINGS_PATH", self.path)
        self.settings_patch.start()
        self.addCleanup(self.settings_patch.stop)

    def write_settings(self, d):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(d, f)

    def settings(self):
        return {
            "model": "opus",
            "availableModels": ["opus", "sonnet"],
            "permissions": {"allow": ["Read"]},
            "env": {
                "ANTHROPIC_BASE_URL": "https://gateway.ai.cloudflare.com/v1/account/default/anthropic",
                "ANTHROPIC_AUTH_TOKEN": "test-placeholder",
                "ANTHROPIC_MODEL": "claude-opus-5.5",
                "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-5.5",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-opus-5.5",
                "CLAUDE_CODE_SUBAGENT_MODEL": "opus",
                "ANTHROPIC_SMALL_FAST_MODEL": "haiku",
            },
        }

    def test_downgrades_opus_and_preserves_credentials_and_other_settings(self):
        original = self.settings()
        self.write_settings(original)
        result = model_guard.claude_model_guard()
        live = model_guard.jload(self.path)
        self.assertEqual(result["model_state"], "fixed")
        self.assertEqual(result["model_readback"], [])
        self.assertEqual(live["model"], "claude-sonnet-5.5")
        self.assertEqual(live["availableModels"], ["claude-sonnet-5.5"])
        for key in ("ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL",
                    "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                    "CLAUDE_CODE_SUBAGENT_MODEL"):
            self.assertEqual(live["env"][key], "claude-sonnet-5.5")
        for key in ("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_SMALL_FAST_MODEL"):
            self.assertEqual(live["env"][key], original["env"][key])
        self.assertEqual(live["permissions"], original["permissions"])
        self.assertNotIn("test-placeholder", json.dumps(result))

    def test_idempotent_and_repairs_reintroduced_opus(self):
        self.write_settings(self.settings())
        model_guard.claude_model_guard()
        with patch.object(model_guard, "atomic_json") as write:
            self.assertEqual(model_guard.claude_model_guard()["model_state"], "clean")
            write.assert_not_called()
        d = model_guard.jload(self.path)
        d["model"] = "opus"
        d["env"]["ANTHROPIC_SMALL_FAST_MODEL"] = "claude-opus-5.5"
        self.write_settings(d)
        self.assertEqual(model_guard.claude_model_guard()["model_state"], "fixed")
        self.assertEqual(model_guard.jload(self.path)["env"]["ANTHROPIC_SMALL_FAST_MODEL"],
                         "claude-sonnet-5.5")

    def test_unrelated_gateways_unchanged(self):
        urls = [
            "https://api.anthropic.com",
            "https://gateway.ai.cloudflare.com/v1/account/other/anthropic",
            "https://gateway.ai.cloudflare.com.attacker.invalid/v1/account/default/anthropic",
            "https://attacker.invalid/v1/account/default/anthropic",
            "http://gateway.ai.cloudflare.com/v1/account/default/anthropic",
            "https://gateway.ai.cloudflare.com/v1/account/default/not-anthropic",
            "https://gateway.ai.cloudflare.com/v1/account/default/anthropic/extra",
            "",
        ]
        for url in urls:
            with self.subTest(url=url):
                d = self.settings()
                d["env"]["ANTHROPIC_BASE_URL"] = url
                self.write_settings(d)
                with open(self.path, "rb") as f:
                    before = f.read()
                self.assertEqual(model_guard.claude_model_guard()["model_state"], "not-default-gateway")
                with open(self.path, "rb") as f:
                    self.assertEqual(f.read(), before)

    def test_preserves_settings_updated_concurrently_before_write(self):
        self.write_settings(self.settings())
        original_load = model_guard.jload
        original_write = model_guard.atomic_json_if_unchanged
        write_count = 0

        def write_after_concurrent_update(path, data, expected):
            nonlocal write_count
            write_count += 1
            if write_count == 1:
                concurrent = original_load(path)
                concurrent["permissions"] = {"allow": ["Read", "Write"]}
                concurrent["env"]["ANTHROPIC_AUTH_TOKEN"] = "updated-placeholder"
                self.write_settings(concurrent)
            return original_write(path, data, expected)

        with patch.object(model_guard, "atomic_json_if_unchanged",
                          side_effect=write_after_concurrent_update):
            result = model_guard.claude_model_guard()

        live = original_load(self.path)
        self.assertEqual(result["model_state"], "fixed")
        self.assertEqual(write_count, 2)
        self.assertEqual(live["permissions"], {"allow": ["Read", "Write"]})
        self.assertEqual(live["env"]["ANTHROPIC_AUTH_TOKEN"], "updated-placeholder")

    def test_preserves_non_opus_haiku_override(self):
        d = self.settings()
        d["env"]["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = "claude-3-haiku"
        self.write_settings(d)

        model_guard.claude_model_guard()

        self.assertEqual(model_guard.jload(self.path)["env"]["ANTHROPIC_DEFAULT_HAIKU_MODEL"],
                         "claude-3-haiku")

    def test_compat_endpoint_and_missing_model_defaults(self):
        d = {"env": {"ANTHROPIC_BASE_URL":
                    "https://gateway.ai.cloudflare.com/v1/account/default/compat/"}}
        self.write_settings(d)
        self.assertEqual(model_guard.claude_model_guard()["model_state"], "fixed")
        self.assertEqual(model_guard.jload(self.path)["model"], "claude-sonnet-5.5")

    def test_missing_settings_do_not_create_a_client(self):
        self.assertEqual(model_guard.claude_model_guard()["model_state"], "settings-missing")
        self.assertFalse(os.path.exists(self.path))

    def test_invalid_json_is_not_overwritten(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{")
        with self.assertRaises(json.JSONDecodeError):
            model_guard.claude_model_guard()
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(f.read(), "{")

    def test_failed_write_detected_by_readback(self):
        self.write_settings(self.settings())
        with patch.object(model_guard, "atomic_json_if_unchanged", return_value=True):
            result = model_guard.claude_model_guard()
        self.assertEqual(result["model_state"], "verify-failed")
        self.assertIn("model", result["model_readback"])

    def test_policy_does_not_mutate_input(self):
        d = self.settings()
        before = copy.deepcopy(d)
        model_guard.claude_model_drift(d)
        self.assertEqual(d, before)

    def run_main(self):
        output = io.StringIO()
        with ExitStack() as stack:
            for name in ("DB", "JS", "CHATBOX"):
                stack.enter_context(patch.object(model_guard, name,
                                                 os.path.join(self.tmp.name, "missing-" + name)))
            stack.enter_context(patch.object(model_guard, "auto_candidate_paths", return_value=[]))
            stack.enter_context(patch.object(model_guard, "_claude_prompt_canon", return_value=""))
            stack.enter_context(patch.object(model_guard, "shared_doctrine_parity", return_value={}))
            stack.enter_context(redirect_stdout(output))
            rc = model_guard.main()
        return rc, json.loads(output.getvalue())

    def test_main_reports_verified_model_repair(self):
        self.write_settings(self.settings())
        rc, output = self.run_main()
        self.assertEqual(rc, 0)
        self.assertEqual(output["stores"]["claude"]["model_state"], "fixed")
        self.assertEqual(output["stores"]["claude"]["client"], "claude-code")

    def test_main_redacts_errors_and_returns_nonzero(self):
        self.write_settings(self.settings())
        with patch.object(model_guard, "atomic_json_if_unchanged",
                          side_effect=OSError("test-placeholder")):
            rc, output = self.run_main()
        self.assertEqual(rc, 1)
        self.assertEqual(output["stores"]["claude"]["model_error"], "settings-check-failed")
        self.assertNotIn("test-placeholder", json.dumps(output))

    def test_main_reports_failed_readback(self):
        self.write_settings(self.settings())
        with patch.object(model_guard, "atomic_json_if_unchanged", return_value=True):
            rc, output = self.run_main()
        self.assertEqual(rc, 2)
        self.assertEqual(output["stores"]["claude"]["model_state"], "verify-failed")

    def test_main_preserves_malformed_settings(self):
        for d in ([], {"env": []}, {"env": {"ANTHROPIC_BASE_URL": []}}):
            with self.subTest(settings=d):
                self.write_settings(d)
                rc, output = self.run_main()
                self.assertEqual(model_guard.jload(self.path), d)
                self.assertEqual(rc, 1)
                self.assertEqual(output["stores"]["claude"]["model_error"], "settings-check-failed")


if __name__ == "__main__":
    unittest.main()
