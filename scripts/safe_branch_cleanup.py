#!/usr/bin/env python3
"""
Safe branch cleanup with comprehensive pre-deletion verification.

FAILURE MODES ADDRESSED:
1. Deleting branches with unmerged commits
2. Deleting branches without checking ahead/behind status
3. No verification of dangling commits before cleanup
4. No dry-run mode
5. No rollback capability
6. Insufficient logging

ROOT CAUSE: Rushed execution without verification of merge status.
"""

import subprocess
import json
import sys
import re
import urllib.request
from datetime import datetime
from typing import Dict, List, Set, Tuple

class BranchCleanupAuditor:
    def __init__(self, dry_run: bool = True):
        self.dry_run = dry_run
        self.protected_branches = {'main', 'fleet-artifacts'}
        self.remote_heads = {}
        self.findings = {
            'safe_to_delete': [],
            'has_unmerged_commits': [],
            'has_open_pr': [],
            'has_active_work': [],
            'protected': [],
            'errors': []
        }
        
    @staticmethod
    def checked(*args):
        """A failed read is unknown, never evidence that a branch is merged."""
        return subprocess.run(list(args), capture_output=True, text=True,
                              errors='replace', check=True).stdout.strip()

    def refresh_remote_heads(self):
        # Explicit refspec: some checkouts fetch only main by default.
        self.checked('git', 'fetch', '--prune', '--no-tags', 'origin',
                     '+refs/heads/*:refs/remotes/origin/*')
        raw = self.checked('git', 'ls-remote', '--heads', 'origin')
        heads = {}
        for line in raw.splitlines():
            sha, ref = line.split()
            if not re.fullmatch(r'[0-9a-f]{40,64}', sha) or not ref.startswith('refs/heads/'):
                raise ValueError('invalid remote head listing')
            heads[ref[len('refs/heads/'):]] = sha
        if 'main' not in heads:
            raise ValueError('remote main is missing')
        self.remote_heads = heads

    def get_all_branches(self) -> List[str]:
        return sorted(self.remote_heads)
    
    def get_open_pr_branches(self) -> Set[str]:
        """Get branches with open PRs."""
        prs = json.loads(self.checked('gh', 'pr', 'list', '--repo', 'QNFO/qnfo-workers',
                                      '--state', 'open', '--json', 'headRefName', '--limit', '1000'))
        if not isinstance(prs, list) or len(prs) >= 1000:
            raise ValueError('incomplete open pull request listing')
        return {pr['headRefName'] for pr in prs}

    def get_active_work(self):
        raw = self.checked('git', 'worktree', 'list', '--porcelain')
        branches = {line[len('branch refs/heads/'):] for line in raw.splitlines()
                    if line.startswith('branch refs/heads/')}
        heads = {line[5:] for line in raw.splitlines() if line.startswith('HEAD ')}
        with urllib.request.urlopen('https://qnfo-deploy-guard.q08.workers.dev/work-locks', timeout=30) as response:
            ledger = json.load(response)
        if not isinstance(ledger.get('claims'), list) or not isinstance(ledger.get('in_flight'), list):
            raise ValueError('invalid work-claim ledger')
        paths = set()
        for item in ledger['claims'] + ledger['in_flight']:
            for key in ('branch', 'ref'):
                if item.get(key):
                    branches.add(item[key].removeprefix('refs/heads/'))
            key = item.get('key', '')
            path = key[5:] if key.startswith('file:') else item.get('path')
            if path:
                paths.add(path)
        return branches, heads, paths

    def has_active_work(self, branch, sha, activity):
        branches, heads, paths = activity
        if branch in branches or sha in heads:
            return True
        # Preserve a claimed path's last-commit branch even when the ledger has no branch field.
        changed = set(self.checked('git', 'diff-tree', '--root', '-m', '--no-commit-id',
                                   '--name-only', '-r', sha).splitlines())
        return bool(changed & paths)
    
    def check_unmerged_commits(self, branch: str) -> Tuple[bool, int]:
        """
        Check if branch has commits not in main.
        Returns (has_unmerged, commit_count)
        """
        sha = self.remote_heads[branch]
        # Resolve fetched refs and compare their exact values with the remote snapshot.
        for name in ('main', branch):
            if self.checked('git', 'rev-parse', '--verify', f'refs/remotes/origin/{name}^{{commit}}') != self.remote_heads[name]:
                raise ValueError('remote changed while auditing ' + name)
        count = int(self.checked('git', 'rev-list', '--count', self.remote_heads['main'] + '..' + sha))
        return count > 0, count
    
    def get_branch_last_commit_date(self, branch: str) -> str:
        """Get the last commit date for a branch."""
        return self.checked('git', 'log', '-1', '--format=%ai', self.remote_heads[branch])
    
    def audit_all_branches(self):
        """Comprehensive audit of all branches."""
        print("=== BRANCH CLEANUP AUDIT ===\n")
        print(f"Mode: {'DRY RUN' if self.dry_run else 'LIVE DELETION'}\n")
        
        # Get all data
        self.refresh_remote_heads()
        all_branches = self.get_all_branches()
        open_pr_branches = self.get_open_pr_branches()
        activity = self.get_active_work()
        
        print(f"Total branches: {len(all_branches)}")
        print(f"Open PR branches: {len(open_pr_branches)}\n")
        
        # Audit each branch
        for branch in all_branches:
            # Skip protected
            if branch in self.protected_branches:
                self.findings['protected'].append(branch)
                continue
            
            # Check open PR
            if branch in open_pr_branches:
                self.findings['has_open_pr'].append(branch)
                continue
            
            # Check for unmerged commits
            try:
                sha = self.remote_heads[branch]
                if self.has_active_work(branch, sha, activity):
                    self.findings['has_active_work'].append(branch)
                    continue
                has_unmerged, count = self.check_unmerged_commits(branch)
                last_commit = self.get_branch_last_commit_date(branch)
                
                if has_unmerged:
                    self.findings['has_unmerged_commits'].append({
                        'branch': branch,
                        'unmerged_count': count,
                        'last_commit': last_commit
                    })
                else:
                    self.findings['safe_to_delete'].append({
                        'branch': branch,
                        'sha': sha,
                        'last_commit': last_commit
                    })
            except Exception as e:
                self.findings['errors'].append({
                    'branch': branch,
                    'error': str(e)
                })
    
    def print_report(self):
        """Print comprehensive audit report."""
        print("\n" + "="*80)
        print("AUDIT REPORT")
        print("="*80 + "\n")
        
        # Protected branches
        print(f"PROTECTED BRANCHES ({len(self.findings['protected'])}):")
        for branch in self.findings['protected']:
            print(f"  ✓ {branch}")
        print()
        print(f"BRANCHES WITH ACTIVE WORK ({len(self.findings['has_active_work'])}):")
        for branch in self.findings['has_active_work']:
            print(f"  ✓ {branch}")
        print()
        
        # Branches with open PRs
        print(f"BRANCHES WITH OPEN PRs ({len(self.findings['has_open_pr'])}):")
        for branch in self.findings['has_open_pr']:
            print(f"  ✓ {branch}")
        print()
        
        # CRITICAL: Branches with unmerged commits
        print(f"⚠️  BRANCHES WITH UNMERGED COMMITS ({len(self.findings['has_unmerged_commits'])}):")
        print("    THESE MUST NOT BE DELETED WITHOUT REVIEW!\n")
        for item in self.findings['has_unmerged_commits']:
            print(f"  ⚠️  {item['branch']}")
            print(f"      Unmerged commits: {item['unmerged_count']}")
            print(f"      Last commit: {item['last_commit']}")
        print()
        
        # Safe to delete
        print(f"SAFE TO DELETE ({len(self.findings['safe_to_delete'])}):")
        print("    (All commits are in main)\n")
        for item in self.findings['safe_to_delete'][:10]:
            print(f"  ✓ {item['branch']} (last: {item['last_commit']})")
        if len(self.findings['safe_to_delete']) > 10:
            print(f"  ... and {len(self.findings['safe_to_delete']) - 10} more")
        print()
        
        # Errors
        if self.findings['errors']:
            print(f"ERRORS ({len(self.findings['errors'])}):")
            for item in self.findings['errors']:
                print(f"  ✗ {item['branch']}: {item['error']}")
            print()
    
    def save_audit_log(self):
        """Save complete audit log."""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'branch-cleanup-audit-{timestamp}.json'
        
        with open(filename, 'w') as f:
            json.dump(self.findings, f, indent=2)
        
        print(f"\n✓ Audit log saved to: {filename}")
        return filename
    
    def check_dangling_commits(self) -> List[Dict]:
        """
        Check for dangling commits after deletion.
        This detects any orphaned commits that might contain lost work.
        """
        print("\nChecking for dangling commits...")
        output = self.checked('git', 'fsck', '--lost-found')
        
        dangling = []
        for line in output.split('\n'):
            if 'dangling commit' in line:
                commit_sha = line.split()[-1]
                # Get commit details
                details = self.checked('git', 'show', '--stat', '--oneline', commit_sha)
                dangling.append({
                    'sha': commit_sha,
                    'details': details[:500]  # First 500 chars
                })
        
        return dangling
    
    def execute_safe_cleanup(self):
        """Only delete branches that are verified safe."""
        if self.dry_run:
            print("\n⚠️  DRY RUN MODE - No branches will be deleted")
            return
        
        # Double confirmation required for live deletion
        print("\n" + "="*80)
        print("READY TO DELETE BRANCHES")
        print("="*80)
        print(f"\nBranches to delete: {len(self.findings['safe_to_delete'])}")
        print(f"Branches preserved (unmerged): {len(self.findings['has_unmerged_commits'])}")
        print(f"Branches preserved (open PR): {len(self.findings['has_open_pr'])}")
        
        confirm = input("\nType 'DELETE' to proceed: ")
        if confirm != 'DELETE':
            print("Aborted.")
            return
        
        deleted = []
        failed = []
        
        for item in self.findings['safe_to_delete']:
            branch = item['branch']
            try:
                self.delete_verified_branch(item)
                deleted.append(branch)
                print(f"  ✓ Deleted: {branch}")
            except Exception as e:
                failed.append({'branch': branch, 'error': str(e)})
                print(f"  ✗ Error: {branch}: {e}")
        
        print(f"\n✓ Deleted: {len(deleted)}")
        print(f"✗ Failed: {len(failed)}")
        
        # CRITICAL: Check for dangling commits after deletion
        dangling = self.check_dangling_commits()
        if dangling:
            print("\n" + "="*80)
            print("⚠️  CRITICAL: DANGLING COMMITS DETECTED AFTER DELETION")
            print("="*80)
            print(f"\nFound {len(dangling)} dangling commits - possible data loss!")
            print("These commits are orphaned and need immediate review:\n")
            for item in dangling:
                print(f"Commit: {item['sha']}")
                print(item['details'])
                print("-" * 40)
            print("\nAction required: Review these commits and create recovery branches if needed.")
        else:
            print("\n✓ No dangling commits detected - cleanup was safe.")

    def delete_verified_branch(self, item):
        """Recheck all protections and use the audited SHA as a server-side deletion lease."""
        branch, sha = item['branch'], item['sha']
        self.refresh_remote_heads()
        if branch in self.protected_branches or self.remote_heads.get(branch) != sha:
            raise ValueError('protected branch or changed remote head: ' + branch)
        if branch in self.get_open_pr_branches() or self.has_active_work(branch, sha, self.get_active_work()):
            raise ValueError('branch has an open pull request or active work: ' + branch)
        if self.check_unmerged_commits(branch)[0]:
            raise ValueError('branch has unmerged commits: ' + branch)
        # Unlike REST ref deletion, this atomically refuses a head changed after the recheck.
        self.checked('git', 'push', '--force-with-lease=refs/heads/' + branch + ':' + sha,
                     'origin', ':refs/heads/' + branch)

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Safe branch cleanup with verification')
    parser.add_argument('--live', action='store_true', help='Execute live deletion (default is dry-run)')
    args = parser.parse_args()
    
    auditor = BranchCleanupAuditor(dry_run=not args.live)
    
    auditor.audit_all_branches()
    auditor.print_report()
    auditor.save_audit_log()
    
    if auditor.findings['has_unmerged_commits']:
        print("\n" + "="*80)
        print("⚠️  WARNING: UNMERGED COMMITS DETECTED")
        print("="*80)
        print("\nThe following branches have commits not in main:")
        for item in auditor.findings['has_unmerged_commits']:
            print(f"  • {item['branch']} ({item['unmerged_count']} commits)")
        print("\nThese branches will NOT be deleted.")
        print("Review them manually before deletion.")
    
    if not auditor.dry_run:
        auditor.execute_safe_cleanup()

if __name__ == '__main__':
    main()
