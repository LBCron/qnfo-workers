# ignorance-audit

The Universal Ignorance Audit (Rowan Brad Quni-Gudzinas, papers.qnfo.org)
as a small, dependency-free Python library: the fifteen-question, five-phase instrument, its administration protocol as
machine checks, a model-agnostic way to run it with any text model, and a scorer for the method's own pre-registered
claim about AI-assisted research.

- **Claim (the paper's, CHECK 2028):** applied to AI-assisted research outputs, the audit catches at least one category
  of error (scaffold, map-territory or protected ignorance) that standard verification misses.
- **Test:** `ignorance_audit.score` takes audit findings, baseline-verifier findings and optional adjudicated ground
  truth per document, and reports what the audit adds, per category, with precision where ground truth exists.
- **Status:** instrument and protocol checks 0.1.0; the claim is pre-registered and untested. This library is the
  harness for testing it.

```
pip install git+https://github.com/QNFO/ignorance-audit.git
pip install .                         # from a local checkout
ignorance-audit questions             # the instrument and the protocol
ignorance-audit new "the JPCUB metric" > audit.json
ignorance-audit check audit.json      # exit 1 and a list of protocol violations until complete
ignorance-audit render audit.json > audit.md
ignorance-audit score cases.jsonl     # CHECK 2028 scoring
```

```python
from ignorance_audit import Audit, administer

audit = Audit(target="our claim that error correction is a Landauer machine")
audit.answer(1, "We assume the erasure count is the only dissipative step ...")
audit.answer(11, "Not obviously embodied", inapplicable=True, stretch="the unease is about who pays the energy")
print(audit.problems())               # protocol rule 2: every question answered, stretch when inapplicable

# Run it with any model: a function from prompt to answer. No provider is built in.
audit = administer("the agentic collapse model", model=lambda prompt: my_client.complete(prompt))
print(audit.to_markdown())
next_pass = audit.next_pass()         # protocol rule 6: Question 15 seeds the next pass
```

What the protocol checks enforce (paper section 3.3): the target is stated (rule 1); all fifteen questions are answered
and a question judged inapplicable carries a stretch (rule 2); the Question 15 answer seeds the next pass (rule 6).
Rules 3 to 5 (write it down, do not resolve early, allow silence) are practices, and `administer` states rule 4 in
every prompt.

What it does not do: decide whether an answer is good. The paper's meta-audit says reproducibility is low by design;
two auditors produce different answers. The scorer measures what an audit adds over a baseline, not answer quality.

CHECK 2028 case file, one JSON object per line:

```
{"doc_id": "paper-17", "audit_found": ["e1","e4"], "baseline_found": ["e1"], "truth": ["e1","e4"], "category": {"e4": "scaffold"}}
```

## Licence

Source-available under the QNFO Unified License Agreement v2.1 (`LicenseRef-QNFO-ULA-2.1`), whose Software Terms
(section 12) cover code: free for personal use, teaching, published research and non-profit or public work, with a
patent license for those uses. Any use that generates money, including use inside a company, a paid or ad-funded
service, or paid deliverables, needs a separate agreement (section 10.7). Changes you share stay under the same
license, with their source. This is not an open source license (section 12.8). Full text: `LICENSE` and
https://legal.qnfo.org/.
