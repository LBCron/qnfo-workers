## Implementation

Issue: <!-- Refs #issue; name the implementation paths and outcome. -->

## Definition of done (CODE-CHANGE-REQUIRED-1)

- [ ] This PR implements the remedy in code, an applied migration, or executable configuration.
- [ ] The issue is linked and changed implementation paths are identified.
- [ ] Relevant regression checks pass.
- [ ] The required outcome is verified after canonical deployment before the issue is closed.
- [ ] Deploy probes (DEPLOY-PROBES-1): a changed worker's `<worker>/probes.json` names what must still work after its deploy (a route with a marker the page really shows, D1 statements the change touches as `explain`), or this description carries `probes: none (<reason>)`. `scripts/deploy_probes.py --check-pr` fails the PR otherwise; a probe that passed before the deploy and fails after it reverts the push.

Empty, investigation-only, and documentation-only PRs are not deliverables. If the implementation already exists, record evidence on the issue instead of opening a no-change PR.
