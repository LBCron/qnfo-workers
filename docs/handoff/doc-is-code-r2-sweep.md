# Handoff: R2 document sweep and PR self-audit (DOC-IS-CODE-1, SELF-AUDIT-1)

State: scripts/r2_doc_audit.mjs, r2_list_keys.mjs, r2_file_issues.mjs, self_audit_pr.mjs, tests, workflow r2-doc-audit.yml and the Self-audit steps in pr-checks.yml (PR-CHECK-CAP-5-1: steps, not a job) are in this PR.
Sample run (12 of 290 qnfo-projects document keys): 6 orphans. Full run needs the repository Cloudflare token, so dispatch r2-doc-audit.yml after merge.
Next (code-task lines):
- code-task: qnfo-agents weekly CMDLINE-MAINTAIN-1 sweep calls workflow_dispatch of r2-doc-audit.yml
- code-task: scripts/r2_doc_audit.mjs also read qnfo-ddocs text for rule ids and owner_documents rows (the --texts input)
- code-task: add roadmap_implementation insert from out/roadmap.jsonl in r2_file_issues.mjs
Verify: node scripts/r2_doc_audit.test.mjs; gh workflow run r2-doc-audit.yml; the run summary shows orphan and filed counts.
