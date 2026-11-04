// PAPER-INTERNAL-APPENDIX-SWEEP-1: leaked pipeline appendices are removed; real sections stay; a drastic strip is refused.
import assert from "node:assert/strict";
import { sweepInternalAppendices as stripInternalAppendices } from "./worker.js";
const para = "Substantive paragraph of the argument. ".repeat(40) + "\n\n";
const doc = "# T\n\n## Abstract\n\n" + para.repeat(12) + "## Conclusion\n\n" + para.repeat(6) + "## Appendix A. Divergence report\n\n**D1.** Draft A concludes.\n\n### Detail\n\nmore notes\n\n## Appendix B. Claim attribution\n| id | s |\n|---|---|\n| C1 | x |\n\n## References\n\n[1] Real reference.\n";
const r = stripInternalAppendices(doc);
assert.ok(r.removed > 0);
assert.ok(!/Divergence report|Claim attribution|Draft A concludes|more notes/.test(r.body));
assert.match(r.body, /## Conclusion/); assert.match(r.body, /## References\n\n\[1\] Real reference\./);
assert.equal(stripInternalAppendices("# T\n\n## A\n\n" + para.repeat(20)).removed, 0, "clean paper unchanged");
const tiny = "# T\n\n" + para.repeat(3) + "## Appendix A. Divergence report\n\nx\n";
assert.ok(stripInternalAppendices(tiny).refused, "a strip that leaves a short paper is refused");
assert.equal(stripInternalAppendices(tiny).body, tiny);
console.log("internal-appendix-sweep: all assertions passed");
