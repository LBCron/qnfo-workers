// The deployed folded reviser, not the retired standalone snapshot.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPaper } from "../_shared/paper-format.js";

const src = readFileSync(new URL("../qnfo-research-exec/worker.js", import.meta.url), "utf8");
const a = src.indexOf("function standardizeBody(");
const b = src.indexOf('__name(standardizeBody, "standardizeBody");', a);
assert.ok(a > 0 && b > a);
const standardize = new Function("formatPaper", src.slice(a, b) + "; return standardizeBody;")(formatPaper);

test("folded reviser preserves metadata without leaking it into prose", () => {
  const title = "Quantifying Structural Unification";
  const input = "---\nauthor: R\ntitle: " + title + "\naliases:\n  - " + title + "\n---\n\n## " + title + "\n\n**Author:** R\n**Affiliation:** QNFO\n**ORCID:** 1\n**Version:** 2.1.0\n\nThis work deconstructs progress.\n\n## 1. Introduction\n\nText.\n";
  const body = standardize(input, title);
  const f = formatPaper(body, { title });
  assert.match(body, /aliases:\n  - Quantifying Structural Unification/);
  assert.match(body, /affiliation: "QNFO"/);
  assert.doesNotMatch(f.content, /Author|Affiliation|ORCID|Version|^---/m);
  assert.match(f.content, /^## Abstract\n\nThis work deconstructs progress\./);
  assert.equal(standardize(body, title), body);
  assert.match(src, /row\.corrected_md = formatPaper\(row\.corrected_md/);
  assert.match(src, /action\.corrected_md = formatPaper\(action\.corrected_md/g);
});
