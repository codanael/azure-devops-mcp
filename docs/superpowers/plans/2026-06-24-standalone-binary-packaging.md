# Standalone Binary Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship self-contained `azure-devops-mcp` executables for Linux x64 and Windows x64 (no Node.js on the target), built and published to GitHub Releases on each `v*` tag.

**Architecture:** Packaging is purely additive — no application/runtime source changes. The existing `tsc` build emits `dist/index.js`; a new helper script compiles that with `bun build --compile` into two binaries; a smoke-test script verifies a binary boots and reports the correct version; a GitHub Actions workflow runs the build on tag and attaches the binaries (plus SHA256 checksums) to the Release.

**Tech Stack:** Bun (`bun build --compile`), Node 22 + npm, GitHub Actions (`oven-sh/setup-bun`, `softprops/action-gh-release`), Nix dev shell.

---

## Reference

- Design spec: `docs/superpowers/specs/2026-06-24-standalone-binary-packaging-design.md`
- Server entry compiled into the binary: `dist/index.js` (output of `npm run build`).
- The server self-reports its version via yargs `.version(packageVersion)` in `src/index.ts:30` — so `<binary> --version` prints the `package.json` version and exits 0.
- `dist/` (and therefore `dist/bin/`) is already git-ignored (`.gitignore:94`) — built binaries are never committed.
- All node commands run inside the Nix dev shell: prefix with `nix develop -c bash -c '<cmd>'` (the husky pre-commit hook also needs it for commits).

## File Structure

- **Modify** `flake.nix` — add `bun` to the dev shell so binaries can be built locally.
- **Create** `scripts/smoke-test-binary.js` — runs `<command> --version`, asserts the output contains the `package.json` version and exits 0. Reused locally and in CI. One responsibility: verify a built server boots and self-identifies.
- **Create** `scripts/package-binaries.js` — compiles `dist/index.js` into the two target binaries in `dist/bin/`. One responsibility: drive `bun build --compile` over the target list.
- **Modify** `package.json` — add the `package` npm script.
- **Create** `.github/workflows/release-binaries.yml` — build + smoke-test + checksum + attach-to-release on `v*` tags; upload as workflow artifacts on manual runs.
- **Modify** `docs/GETTINGSTARTED.md` — add a "Standalone binary" section.
- **Modify** `CLAUDE.md` — document the `npm run package` command.

---

### Task 1: Add Bun to the Nix dev shell

**Files:**

- Modify: `flake.nix`

- [ ] **Step 1: Add `bun` to the dev-shell packages**

In `flake.nix`, change the `packages` list and `shellHook` so Bun is available and announced:

```nix
          packages = with pkgs; [
            nodejs_22
            bun
            git
          ];

          shellHook = ''
            echo "azure-devops-mcp dev shell"
            echo "  node $(node --version), npm $(npm --version)"
            echo "  bun $(bun --version)"
            echo "  run 'npm install' then 'npm run build' / 'npm test' / 'npm run package'"
          '';
```

- [ ] **Step 2: Verify Bun is on the PATH in the dev shell**

Run: `nix develop -c bash -c 'bun --version'`
Expected: a version number prints (e.g. `1.x.y`), exit 0. If Nix needs to fetch the package this may take a minute on first run.

- [ ] **Step 3: Commit**

```bash
nix develop -c bash -c 'git add flake.nix && git commit -m "build: add Bun to the Nix dev shell for binary packaging

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9uf9aZUH4mZaQ5ZGeyzrY"'
```

---

### Task 2: Smoke-test script

A small verifier reused by local builds and CI. It spawns `<command…> --version`, then asserts exit code 0 and that the printed version matches `package.json`. We validate it against the **already-built JS server** (`node dist/index.js`) so it is proven before any binary exists.

**Files:**

- Create: `scripts/smoke-test-binary.js`

- [ ] **Step 1: Ensure the server is built (so there is something to test against)**

Run: `nix develop -c bash -c 'npm ci && npm run build'`
Expected: build completes, `dist/index.js` exists. (`npm ci` only needed if `node_modules` is absent.)

- [ ] **Step 2: Write the smoke-test script**

Create `scripts/smoke-test-binary.js`:

```js
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
```

- [ ] **Step 3: Verify it passes against the built JS server**

Run: `nix develop -c bash -c 'node scripts/smoke-test-binary.js node dist/index.js'`
Expected: prints `smoke test ok: 'node' reports version <version>` and exits 0.

- [ ] **Step 4: Verify it fails loudly on a broken command (negative check)**

Run: `nix develop -c bash -c 'node scripts/smoke-test-binary.js ./does-not-exist; echo "exit=$?"'`
Expected: prints a `smoke test failed: could not run` message and `exit=1`.

- [ ] **Step 5: Lint and format the new file**

Run: `nix develop -c bash -c 'npm run eslint && npm run format-check'`
Expected: no errors. (If `format-check` flags the file, run `npm run format` and re-check.)

- [ ] **Step 6: Commit**

```bash
nix develop -c bash -c 'git add scripts/smoke-test-binary.js && git commit -m "build: add binary smoke-test script

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9uf9aZUH4mZaQ5ZGeyzrY"'
```

---

### Task 3: Packaging script + `package` npm script

Compile `dist/index.js` into the two target binaries, then prove the Linux binary boots and parses arguments correctly.

**Files:**

- Create: `scripts/package-binaries.js`
- Modify: `package.json` (add the `package` script)

- [ ] **Step 1: Write the packaging script**

Create `scripts/package-binaries.js`:

```js
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Compile the built server (dist/index.js) into self-contained executables
// with `bun build --compile`. Cross-compiles all targets from one host.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const entry = join(root, "dist", "index.js");
const outDir = join(root, "dist", "bin");

// `-baseline` avoids AVX2 SIGILL crashes on older / virtualized CPUs.
const TARGETS = [
  { target: "bun-linux-x64-baseline", outfile: "azure-devops-mcp-linux-x64" },
  { target: "bun-windows-x64", outfile: "azure-devops-mcp-windows-x64.exe" },
];

mkdirSync(outDir, { recursive: true });

for (const { target, outfile } of TARGETS) {
  const out = join(outDir, outfile);
  console.error(`Compiling ${target} -> ${out}`);
  const result = spawnSync("bun", ["build", "--compile", `--target=${target}`, entry, "--outfile", out], { stdio: "inherit" });
  if (result.error) {
    console.error(`bun not found or failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`bun build failed for ${target} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

console.error("All binaries built in dist/bin/");
```

- [ ] **Step 2: Add the `package` npm script**

In `package.json`, add to `"scripts"` (after the `"build"` line):

```json
    "package": "npm run build && node scripts/package-binaries.js",
```

- [ ] **Step 3: Build the binaries locally**

Run: `nix develop -c bash -c 'npm run package'`
Expected: two "Compiling …" lines, then `All binaries built in dist/bin/`, exit 0. `dist/bin/azure-devops-mcp-linux-x64` and `dist/bin/azure-devops-mcp-windows-x64.exe` now exist. (First run downloads the Bun cross-compile targets — needs network.)

- [ ] **Step 4: Smoke-test the Linux binary (boot + version)**

Run: `nix develop -c bash -c 'node scripts/smoke-test-binary.js ./dist/bin/azure-devops-mcp-linux-x64'`
Expected: `smoke test ok: './dist/bin/azure-devops-mcp-linux-x64' reports version <version>`, exit 0.

- [ ] **Step 5: Verify argument parsing (positional org is received, not eaten)**

This guards against compiled-runtime `process.argv` differences (see Troubleshooting). Run the binary with an org but no PAT, so it must get _past_ arg-parsing and fail in auth:

Run: `nix develop -c bash -c 'PERSONAL_ACCESS_TOKEN= ./dist/bin/azure-devops-mcp-linux-x64 contoso --authentication pat; echo "exit=$?"'`
Expected: a startup error that mentions the **personal access token / `PERSONAL_ACCESS_TOKEN`** being missing (proving `contoso` was parsed as the organization), and a non-zero exit. It must **NOT** print a yargs `Not enough non-option arguments` / "Missing required argument: organization" error. If it does, apply the fix in **Troubleshooting: positional argument dropped** below, then re-run Steps 3–5.

- [ ] **Step 6: Confirm binaries are not staged (dist is git-ignored)**

Run: `git status --porcelain dist`
Expected: no output (nothing under `dist/` is tracked or staged).

- [ ] **Step 7: Lint and format**

Run: `nix develop -c bash -c 'npm run eslint && npm run format-check'`
Expected: no errors. (Run `npm run format` first if needed.)

- [ ] **Step 8: Commit**

```bash
nix develop -c bash -c 'git add scripts/package-binaries.js package.json && git commit -m "build: add bun --compile packaging script and npm run package

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9uf9aZUH4mZaQ5ZGeyzrY"'
```

---

### Task 4: GitHub Actions release workflow

**Files:**

- Create: `.github/workflows/release-binaries.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release-binaries.yml`:

```yaml
name: Build Release Binaries

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

permissions:
  contents: write # required to create/update the GitHub Release

jobs:
  build-binaries:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - uses: oven-sh/setup-bun@v2

      - run: npm ci

      - name: Build standalone binaries
        run: npm run package

      - name: Smoke test the Linux binary
        run: node scripts/smoke-test-binary.js ./dist/bin/azure-devops-mcp-linux-x64

      - name: Generate checksums
        working-directory: dist/bin
        run: sha256sum azure-devops-mcp-linux-x64 azure-devops-mcp-windows-x64.exe > SHA256SUMS

      - name: Attach binaries to the release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
        with:
          files: |
            dist/bin/azure-devops-mcp-linux-x64
            dist/bin/azure-devops-mcp-windows-x64.exe
            dist/bin/SHA256SUMS

      - name: Upload binaries as workflow artifacts (manual runs)
        if: ${{ !startsWith(github.ref, 'refs/tags/') }}
        uses: actions/upload-artifact@v4
        with:
          name: azure-devops-mcp-binaries
          path: |
            dist/bin/azure-devops-mcp-linux-x64
            dist/bin/azure-devops-mcp-windows-x64.exe
            dist/bin/SHA256SUMS
```

- [ ] **Step 2: Validate the workflow YAML parses**

Run: `nix develop -c bash -c 'node -e "const fs=require(\"fs\");const s=fs.readFileSync(\".github/workflows/release-binaries.yml\",\"utf8\");if(!s.includes(\"bun build\")&&!s.includes(\"npm run package\"))process.exit(1);console.log(\"workflow references the package step\")"'`
Expected: prints `workflow references the package step`, exit 0. (Full YAML linting happens on push via GitHub; this is a quick sanity check.)

- [ ] **Step 3: Format check**

Run: `nix develop -c bash -c 'npm run format-check'`
Expected: no errors (run `npm run format` first if the YAML needs reformatting).

- [ ] **Step 4: Commit**

```bash
nix develop -c bash -c 'git add .github/workflows/release-binaries.yml && git commit -m "ci: build and publish standalone binaries on release tags

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9uf9aZUH4mZaQ5ZGeyzrY"'
```

---

### Task 5: Documentation

**Files:**

- Modify: `docs/GETTINGSTARTED.md` (insert after the On-Premises section, before `## 🍕 Installation Options` at line 168)
- Modify: `CLAUDE.md` (Commands section)

- [ ] **Step 1: Add the standalone-binary section to GETTINGSTARTED**

In `docs/GETTINGSTARTED.md`, insert the following **after line 167** (the end of the On-Premises `Notes:` list) and **before** `## 🍕 Installation Options`:

````markdown
### 📦 Standalone Binary (no Node.js required)

Prebuilt, self-contained executables are attached to each [GitHub Release](https://github.com/codanael/azure-devops-mcp/releases): `azure-devops-mcp-linux-x64` (Linux x64) and `azure-devops-mcp-windows-x64.exe` (Windows x64). They embed the runtime, so the target machine needs **no Node.js**. This is the recommended option for locked-down or **air-gapped on-premises** environments.

Download the binary for your platform (verify it against `SHA256SUMS`), make it executable (`chmod +x azure-devops-mcp-linux-x64` on Linux), then point your MCP client's `command` at its absolute path:

```json
{
  "servers": {
    "ado": {
      "command": "/opt/azure-devops-mcp/azure-devops-mcp-linux-x64",
      "args": ["https://tfs.contoso.com/DefaultCollection", "--authentication", "pat"],
      "env": {
        "PERSONAL_ACCESS_TOKEN": "<base64encoded email:pat>"
      }
    }
  }
}
```

Notes:

- The positional argument is the same as for `npx`: a cloud organization name or an on-premises collection URL.
- `pat` and `env` authentication work fully offline. `interactive` and `azcli` still function but require network access / the `az` CLI, so prefer PAT in air-gapped environments.
- On Windows, SmartScreen/Defender may warn the first time you run the unsigned `.exe`.
- Each binary is roughly 60–90 MB because it bundles the runtime.
````

- [ ] **Step 2: Document the `package` command in CLAUDE.md**

In `CLAUDE.md`, in the `## Commands` fenced block, add this line after the `npm run inspect` line:

```bash
npm run package          # build, then bun --compile to dist/bin/ (Linux x64 + Windows x64 binaries)
```

- [ ] **Step 3: Format check**

Run: `nix develop -c bash -c 'npm run format-check'`
Expected: no errors (run `npm run format` first if needed).

- [ ] **Step 4: Commit**

```bash
nix develop -c bash -c 'git add docs/GETTINGSTARTED.md CLAUDE.md && git commit -m "docs: document standalone binary distribution and npm run package

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9uf9aZUH4mZaQ5ZGeyzrY"'
```

---

## Final verification

- [ ] **Run the full unit suite** (unchanged by this work — must stay green):

Run: `nix develop -c bash -c 'npm test'`
Expected: all tests pass.

- [ ] **Rebuild binaries clean and smoke-test once more:**

Run: `nix develop -c bash -c 'rm -rf dist && npm run package && node scripts/smoke-test-binary.js ./dist/bin/azure-devops-mcp-linux-x64'`
Expected: build succeeds, smoke test prints `smoke test ok`, exit 0.

---

## Troubleshooting: positional argument dropped

**Symptom:** the compiled binary prints a yargs error like `Not enough non-option arguments: got 0, need at least 1` even when an organization/collection URL is passed (Task 3, Step 5).

**Cause:** `src/index.ts` parses with `yargs(hideBin(process.argv))`, and `hideBin` assumes Node's `[node, script, ...args]` layout (slices off 2 leading entries). A compiled runtime may expose only one leading entry, so the first real argument gets sliced away.

**Fix:** replace the `hideBin` usage in `src/index.ts` with a layout that is correct for both `node dist/index.js …` and the compiled binary. Compiled executables set `process.execPath` equal to `process.argv[0]` and do **not** insert a separate script path, so slice off only the entries that are the executable:

```ts
// import stays: import { hideBin } from "yargs/helpers";
function getCliArgs(): string[] {
  // Node:      [execPath, scriptPath, ...args]  -> hideBin drops 2
  // Compiled:  [execPath, ...args]              -> drop only 1
  const isCompiled = process.argv[1] === undefined || process.argv[1] === process.execPath;
  return isCompiled ? process.argv.slice(1) : hideBin(process.argv);
}

const argv = yargs(getCliArgs());
```

After applying, rebuild (`npm run package`) and re-run Task 3 Steps 3–5. Add a one-line note to the commit. (This file/change is only needed if the symptom appears; the default `hideBin` path is kept otherwise to minimize divergence from upstream.)
