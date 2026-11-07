"""Offline deletion-safety tests; no Cloudflare or GitHub mutation is performed."""
import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from safe_branch_cleanup import BranchCleanupAuditor


class BranchCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.remote = root / 'remote.git'
        self.repo = root / 'repo'
        self.git('init', '--bare', str(self.remote), cwd=root)
        self.git('init', '-b', 'main', str(self.repo), cwd=root)
        self.git('config', 'user.email', 'fixture@example.test')
        self.git('config', 'user.name', 'Fixture')
        (self.repo / 'file.txt').write_text('base\n')
        self.git('add', 'file.txt')
        self.git('commit', '-m', 'base')
        self.git('remote', 'add', 'origin', str(self.remote))
        self.git('push', 'origin', 'main')
        # Reproduce the actual checkout's main-only fetch configuration.
        self.git('config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main')
        self.git('push', 'origin', 'HEAD:refs/heads/merged')
        self.previous = Path.cwd()
        os.chdir(self.repo)
        self.addCleanup(os.chdir, self.previous)
        self.auditor = BranchCleanupAuditor()
        self.auditor.refresh_remote_heads()
        self.sha = self.auditor.remote_heads['merged']

    def git(self, *args, cwd=None):
        return subprocess.run(['git', *args], cwd=cwd or self.repo, check=True,
                              capture_output=True, text=True).stdout.strip()

    def test_fetches_all_remote_heads_even_with_main_only_config(self):
        self.assertEqual(self.auditor.get_all_branches(), ['main', 'merged'])
        self.assertEqual(self.git('rev-parse', 'origin/merged'), self.sha)

    def test_unmerged_is_measured_against_remote_main_not_local_main(self):
        self.git('switch', '-c', 'feature')
        (self.repo / 'file.txt').write_text('feature\n')
        self.git('commit', '-am', 'unmerged feature')
        self.git('push', 'origin', 'feature')
        self.git('branch', '-f', 'main', 'HEAD')
        self.auditor.refresh_remote_heads()
        self.assertEqual(self.auditor.check_unmerged_commits('feature'), (True, 1))

    def test_failed_git_read_cannot_report_merged(self):
        self.git('update-ref', '-d', 'refs/remotes/origin/merged')
        with self.assertRaises(subprocess.CalledProcessError):
            self.auditor.check_unmerged_commits('merged')

    def test_failed_github_read_and_incomplete_listing_fail_closed(self):
        with patch.object(self.auditor, 'checked', side_effect=subprocess.CalledProcessError(1, ['gh'])):
            with self.assertRaises(subprocess.CalledProcessError):
                self.auditor.get_open_pr_branches()
        with patch.object(self.auditor, 'checked', return_value=json.dumps([{'headRefName': 'x'}] * 1000)):
            with self.assertRaises(ValueError):
                self.auditor.get_open_pr_branches()

    def test_missing_claim_ledger_fails_closed(self):
        with patch('urllib.request.urlopen', side_effect=OSError('offline')):
            with self.assertRaises(OSError):
                self.auditor.get_active_work()

    def test_claimed_path_and_checked_out_branch_are_preserved(self):
        activity = ({'merged'}, set(), set())
        self.assertTrue(self.auditor.has_active_work('merged', self.sha, activity))
        self.assertTrue(self.auditor.has_active_work('merged', self.sha, (set(), {self.sha}, set())))
        self.assertTrue(self.auditor.has_active_work('merged', self.sha, (set(), set(), {'file.txt'})))

    def deletion_context(self, prs=None):
        stack = contextlib.ExitStack()
        stack.enter_context(patch.object(self.auditor, 'get_open_pr_branches', return_value=prs or set()))
        stack.enter_context(patch.object(self.auditor, 'get_active_work', return_value=(set(), set(), set())))
        return stack

    def test_open_pr_and_protected_branch_cannot_be_deleted(self):
        with self.deletion_context({'merged'}):
            with self.assertRaisesRegex(ValueError, 'open pull request'):
                self.auditor.delete_verified_branch({'branch': 'merged', 'sha': self.sha})
        with self.deletion_context():
            with self.assertRaisesRegex(ValueError, 'protected'):
                self.auditor.delete_verified_branch({'branch': 'main', 'sha': self.sha})
        self.assertIn('fleet-artifacts', self.auditor.protected_branches)
        self.assertIn('refs/heads/merged', self.git('ls-remote', '--heads', 'origin'))

    def test_changed_head_after_audit_is_preserved(self):
        (self.repo / 'file.txt').write_text('new work\n')
        self.git('commit', '-am', 'new work')
        self.git('push', 'origin', 'HEAD:refs/heads/merged')
        with self.deletion_context():
            with self.assertRaisesRegex(ValueError, 'changed remote head'):
                self.auditor.delete_verified_branch({'branch': 'merged', 'sha': self.sha})
        self.assertIn('refs/heads/merged', self.git('ls-remote', '--heads', 'origin'))

    def test_lease_rejects_race_between_final_recheck_and_push(self):
        # Make another reachable commit without changing the snapshot being checked.
        (self.repo / 'file.txt').write_text('racing work\n')
        self.git('commit', '-am', 'racing work')
        raced = self.git('rev-parse', 'HEAD')
        original = self.auditor.checked

        def checked(*args):
            if args[:2] == ('git', 'push'):
                # Another writer advances the remote after every client-side protection.
                self.git('push', 'origin', 'HEAD:refs/heads/merged')
            return original(*args)

        with self.deletion_context(), patch.object(self.auditor, 'checked', side_effect=checked):
            with self.assertRaises(subprocess.CalledProcessError):
                self.auditor.delete_verified_branch({'branch': 'merged', 'sha': self.sha})
        self.assertTrue(self.git('ls-remote', '--heads', 'origin', 'merged').startswith(raced))

    def test_merged_unchanged_inactive_branch_can_be_deleted_conditionally(self):
        with self.deletion_context():
            self.auditor.delete_verified_branch({'branch': 'merged', 'sha': self.sha})
        self.assertEqual(self.git('ls-remote', '--heads', 'origin', 'merged'), '')

    def test_dry_run_never_deletes(self):
        with patch.object(self.auditor, 'delete_verified_branch') as delete, contextlib.redirect_stdout(io.StringIO()):
            self.auditor.execute_safe_cleanup()
        delete.assert_not_called()


if __name__ == '__main__':
    unittest.main()
