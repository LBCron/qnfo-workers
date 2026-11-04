// The deployed folded reviser, not the retired standalone snapshot.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPaper } from "../_shared/paper-format.js";

const src = readFileSync(new URL("../qnfo-research-exec/worker.js", import.meta.url), "utf8");
const a = src.indexOf("function standardizeBody(");
const b = src.indexOf('__name(standardizeBody, "standardizeBody");', a);
assert.ok(a > 0 && b > a);
const ca = src.indexOf("// PAPER-CANONICAL-1:BEGIN"), cb = src.indexOf("// PAPER-CANONICAL-1:END");
assert.ok(ca > 0 && cb > ca);
const standardize = new Function("formatPaper", src.slice(ca, cb) + "\n" + src.slice(a, b) + "; return standardizeBody;")(formatPaper);

test("folded reviser stores the new-release shape: metadata and history stay out of the body", () => {
  const title = "Quantifying Structural Unification";
  const input = "---\nauthor: R\ntitle: " + title + "\naliases:\n  - " + title + "\n---\n\n## " + title + "\n\n**Author:** R\n**Affiliation:** QNFO\n**ORCID:** 1\n**Version:** 2.1.0\n\nThis work deconstructs progress.\n\n## 1. Introduction\n\nText.\n\n## Version History\n\n- Version 2.1.0: revised.\n\n## References\n\n[1] A.\n";
  const body = standardize(input, title);
  assert.equal(body, "# " + title + "\n\n## Abstract\n\nThis work deconstructs progress.\n\n## 1. Introduction\n\nText.\n\n## References\n\n[1] A.\n");
  assert.equal(standardize(body, title), body);
  assert.match(src, /row\.corrected_md = canonicalBody\(row\.corrected_md/);
  assert.match(src, /action\.corrected_md = canonicalBody\(action\.corrected_md/g);
});
