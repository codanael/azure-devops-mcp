// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Smoke test: run `<command...> --version` and assert it exits 0 and prints the
// package.json version. Used for both the built JS server and the compiled
// binaries, so a broken build fails fast before release.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
const expectedVersion = pkg.version;

const [command, ...rest] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/smoke-test-binary.js <command> [args...]");
  process.exit(2);
}

const result = spawnSync(command, [...rest, "--version"], { encoding: "utf8" });
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

if (result.error) {
  console.error(`smoke test failed: could not run '${command}': ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`smoke test failed: '${command} --version' exited ${result.status}`);
  console.error(output);
  process.exit(1);
}
if (!output.includes(expectedVersion)) {
  console.error(`smoke test failed: expected version '${expectedVersion}' in output, got:`);
  console.error(output);
  process.exit(1);
}

console.error(`smoke test ok: '${command}' reports version ${expectedVersion}`);
process.exit(0);
