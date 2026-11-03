#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { versionAtLeast } from "./version-at-least.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "qnfo-ops", "oauth-broker.mjs");
const marker = "// SINGLE-MODULE-INLINE-1: oauth-broker.mjs inlined as OAuthBroker; the deploy uploads worker.js as ONE module (no relative imports allowed).";
const endMarker = "// end inline qnfo-ops/oauth-broker.mjs";
const sourceExports = [];
const source = readFileSync(sourcePath, "utf8").replace(
  /^export (async function|function|const|let|var|class) ([A-Za-z_$][\w$]*)/gm,
  (_match, declaration, name) => {
    sourceExports.push(name);
    return declaration + " " + name;
  }
);

if (sourceExports.join(",") !== "handleOAuthBroker,refreshOAuthBrokerTokens" || /^\s*(import|export)\b/m.test(source)) {
  throw new Error("oauth-broker.mjs has exports or imports the inliner does not handle");
}

const block = marker + "\nvar OAuthBroker = (() => {\n" + source +
  "\nreturn Object.freeze({ handleOAuthBroker, refreshOAuthBrokerTokens });\n})();\n" + endMarker;

function replaceOne(text, oldText, newText, label) {
  const first = text.indexOf(oldText);
  if (first < 0 || text.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error("expected exactly one " + label);
  }
  return text.slice(0, first) + newText + text.slice(first + oldText.length);
}

function inlineWorker(text) {
  const oldVersion = 'var VERSION = "2.62.10-rm1646-qwen-chat";';
  const newVersion = 'var VERSION = "2.62.11-rm1646-qwen-chat";';
  const releaseNote = " /* 2.62.11 WORKER-LOAD-GATE-1 (issue #6518, pillar autonomy; patch): inline the OAuth broker in the deployable single-module worker. */";
  if (text.includes(oldVersion)) {
    text = replaceOne(text, oldVersion, newVersion + releaseNote, "old worker version");
  } else if (versionAtLeast((/^var VERSION = "([^"]+)";/m.exec(text) || [])[1], "2.62.11")) {
    if (!text.includes(releaseNote.trim())) throw new Error("qnfo-ops worker release note is missing");
  } else {
    throw new Error("qnfo-ops worker version differs from the expected main version");
  }

  const start = text.indexOf(marker);
  if (start >= 0) {
    const end = text.indexOf(endMarker, start);
    if (end < 0) throw new Error("OAuth broker inline end marker is missing");
    const after = text.indexOf("\n", end);
    text = text.slice(0, start) + block + text.slice(after < 0 ? text.length : after);
  } else {
    text = replaceOne(
      text,
      'import { handleOAuthBroker, refreshOAuthBrokerTokens } from "./oauth-broker.mjs";',
      block,
      "OAuth broker import"
    );
  }

  for (const name of ["handleOAuthBroker", "refreshOAuthBrokerTokens"]) {
    const oldCall = "await " + name + "(";
    const newCall = "await OAuthBroker." + name + "(";
    if (text.includes(oldCall)) text = replaceOne(text, oldCall, newCall, name + " call");
    else if (!text.includes(newCall)) throw new Error("OAuth broker call is missing: " + name);
  }
  return text;
}

const files = [
  join(root, "qnfo-ops", "worker.js"),
  join(root, "qnfo-ops", "deployed-current.worker.js")
];
let changed = false;
for (const file of files) {
  const current = readFileSync(file, "utf8");
  const next = inlineWorker(current);
  if (current !== next) {
    changed = true;
    if (!process.argv.includes("--check")) writeFileSync(file, next);
  }
}

if (process.argv.includes("--check") && changed) {
  throw new Error("qnfo-ops worker artifacts are not synchronized with oauth-broker.mjs");
}
console.log("OAuth broker inline source sync: " + (changed ? "updated" : "2 worker entries match"));
