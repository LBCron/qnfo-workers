# Disaster Recovery: service-failure resolution sequence

## 1 STOP. Do not check the provider status page. Do not blame the platform.
- WHY: External errors are rare; self-caused config mutations are common (BLAME-EXTERNAL-1).
- SCOPE: Any endpoint/domain/service failure.
- CONNECTOR: BY

## 2 CHANGE AUDIT: enumerate every change made to the failing zone/account/service in the last 7 days.
- WHY: The most common root cause is a change made by this system minutes/hours/days earlier (CHANGE-AUDIT-FIRST-1).
- SCOPE: DNS records, routing rules, firewall rules, worker filters, bindings, deployments, secrets, rate limits, re-registrations.
  - 2.1 git log across owning repos
  - 2.2 handoff files + task_dod_register recent rows
  - 2.3 memory_recall + tape_search
  - 2.4 Cloudflare audit logs when available

## 3 DIFFERENTIAL PROOF: compare the failing component against a sibling that works.
- WHY: The difference IS the root cause (canonical: 10/11 domains worked; only qnfo.org - the one with DROP rules - failed).
- SCOPE: Sibling domains, sibling routes, sibling workers.
- CONNECTOR: PROOF

## 4 REVERT/ROLLBACK the suspicious change BEFORE trying anything else.
- WHY: If the service recovers, the change was the cause; document it as an anti-pattern and never re-introduce it.
- SCOPE: Rollback = deploy revert, rule delete, config restore.
- CONNECTOR: PROOF

## 5 ONLY AFTER steps 1-4 exhaust every local mutation hypothesis: consider external causes.
- WHY: Prevents misdiagnosing self-damage as external failure (the 2026-08-10 email-10002 case was self-inflicted DROP rules, never a platform incident).
- SCOPE: External attribution requires a differential test first.
- CONNECTOR: BY

When a service fails, the first diagnostic question is 'What did I change recently?' not 'Is the platform down?'. Execute the sequence in order; each step cites its evidence.
