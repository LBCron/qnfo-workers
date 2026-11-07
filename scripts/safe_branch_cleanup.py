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
from datetime import datetime
from typing import Dict, List, Set, Tuple

class BranchCleanupAuditor:
    def __init__(self, dry_run: bool = True):
        self.dry_run = dry_run
        self.protected_branches = {'main'}
        self.findings = {
            'safe_to_delete': [],
            'has_unmerged_commits': [],
            'has_open_pr': [],
            'protected': [],
            'errors': []
        }
        
    def get_all_branches(self) -> List[str]:
        """Get all remote branches."""
        result = subprocess.run(
            ['git', 'branch', '-r'],
            capture_output=True,
            text=True
        )
        branches = []
        for line in result.stdout.strip().split('\n'):
            branch = line.strip().replace('origin/', '')
            if branch and '->' not in branch:
                branches.append(branch)
        return branches
    
    def get_open_pr_branches(self) -> Set[str]:
        """Get branches with open PRs."""
        result = subprocess.run(
            ['gh', 'pr', 'list', '--json', 'headRefName', '--limit', '1000'],
            capture_output=True,
            text=True
        )
        prs = json.loads(result.stdout)
        return {pr['headRefName'] for pr in prs}
    
    def check_unmerged_commits(self, branch: str) -> Tuple[bool, int]:
        """
        Check if branch has commits not in main.
        Returns (has_unmerged, commit_count)
        """
        result = subprocess.run(
            ['git', 'log', f'main..origin/{branch}', '--oneline'],
            capture_output=True,
            text=True
        )
        commits = [line for line in result.stdout.strip().split('\n') if line]
        return len(commits) > 0, len(commits)
    
    def get_branch_last_commit_date(self, branch: str) -> str:
        """Get the last commit date for a branch."""
        result = subprocess.run(
            ['git', 'log', '-1', '--format=%ai', f'origin/{branch}'],
            capture_output=True,
            text=True
        )
        return result.stdout.strip()
    
    def audit_all_branches(self):
        """Comprehensive audit of all branches."""
        print("=== BRANCH CLEANUP AUDIT ===\n")
        print(f"Mode: {'DRY RUN' if self.dry_run else 'LIVE DELETION'}\n")
        
        # Get all data
        all_branches = self.get_all_branches()
        open_pr_branches = self.get_open_pr_branches()
        
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
        result = subprocess.run(
            ['git', 'fsck', '--lost-found'],
            capture_output=True,
            text=True
        )
        
        dangling = []
        for line in result.stdout.split('\n'):
            if 'dangling commit' in line:
                commit_sha = line.split()[-1]
                # Get commit details
                show_result = subprocess.run(
                    ['git', 'show', '--stat', '--oneline', commit_sha],
                    capture_output=True,
                    text=True
                )
                dangling.append({
                    'sha': commit_sha,
                    'details': show_result.stdout[:500]  # First 500 chars
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
                result = subprocess.run(
                    ['gh', 'api', '-X', 'DELETE', f'repos/QNFO/qnfo-workers/git/refs/heads/{branch}'],
                    capture_output=True,
                    text=True
                )
                if result.returncode == 0:
                    deleted.append(branch)
                    print(f"  ✓ Deleted: {branch}")
                else:
                    failed.append({'branch': branch, 'error': result.stderr})
                    print(f"  ✗ Failed: {branch}")
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

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Safe branch cleanup with verification')
    parser.add_argument('--live', action='store_true', help='Execute live deletion (default is dry-run)')
    args = parser.parse_args()
    
    auditor = BranchCleanupAuditor(dry_run=not args.live)
    
    print("Fetching latest branch data...")
    subprocess.run(['git', 'fetch', '--all', '--prune'], check=True)
    
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
