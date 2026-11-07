#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testFile = fileURLToPath(new URL("./safe_branch_cleanup_test.py", import.meta.url));
const result = spawnSync(process.platform === "win32" ? "python" : "python3", [testFile], { stdio: "inherit" });
if (result.error) console.error("Unable to run branch cleanup tests:", result.error.message);
process.exit(result.status === null ? 1 : result.status);
