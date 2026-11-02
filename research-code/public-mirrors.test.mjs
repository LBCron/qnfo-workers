import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readme = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const index = readme("./README.md");

for (const name of ["agentic-collapse", "ignorance-audit"]) {
  test(`${name} documents its public source install`, () => {
    const url = `https://github.com/QNFO/${name}`;
    assert.ok(index.includes(url), `${name} public repository is linked from the index`);
    assert.ok(index.includes(`pip install git+${url}.git`), `${name} source install is documented`);
    assert.ok(readme(`./${name}/README.md`).includes(`pip install git+${url}.git`), `${name} README uses the source install`);
  });
}

test("ultrametric-lean documents a public checkout and build", () => {
  const url = "https://github.com/QNFO/ultrametric-lean";
  assert.ok(index.includes(url), "public Lean repository is linked from the index");
  assert.match(readme("./ultrametric-lean/README.md"), /git clone https:\/\/github\.com\/QNFO\/ultrametric-lean\.git[\s\S]*lake build/);
});
