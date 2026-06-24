# Standalone Binary Packaging — Design

**Date:** 2026-06-24
**Status:** Approved (design); pending implementation plan
**Fork:** `codanael/azure-devops-mcp` (of `microsoft/azure-devops-mcp`)

## Goal

Produce self-contained `azure-devops-mcp` executables for **Linux x64** and **Windows x64** that run the stdio MCP server with **no Node.js installed on the target**, built and published by CI on each release tag. This pairs with the on-premises feature: it enables distribution into air-gapped/offline networks and machines without Node, and simplifies MCP client configuration to a single binary path.

## Background

Today the only distribution is npm: users run `npx -y @azure-devops/mcp <org>` or install the package, both of which require Node.js/npm and (at launch) reach the npm registry. For locked-down corporate machines, air-gapped on-prem networks, and users who just want a single path in their MCP client config, a self-contained binary is a better fit.

The server is a Node ESM application (`"type": "module"`, `module: Node16`). Its runtime dependencies — `@azure/msal-node`, `@azure/identity`, `azure-devops-node-api`, `winston`, `yargs`, `zod`, `zod-to-json-schema` — are all **pure JavaScript with no native addons**, which makes single-binary packaging clean.

## Decisions

| Area            | Decision                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packaging tool  | **Bun `bun build --compile`.** Strongest Node-compat of the candidates, cross-compiles both targets from a single runner, consumes the existing `node_modules` as-is. |
| Compile input   | The **built `dist/index.js`** (output of the existing `tsc` build), not the TS source — ships the validated build including generated `src/version.ts`.               |
| Targets         | **Linux x64** (`bun-linux-x64-baseline`) and **Windows x64** (`bun-windows-x64`). No macOS, no arm64.                                                                 |
| Linux variant   | Use the **`-baseline`** target to avoid AVX2 `SIGILL` crashes on older / virtualized CPUs common in on-prem server environments.                                      |
| Distribution    | **GitHub Actions → GitHub Releases**, triggered on tag push `v*`. Single `ubuntu-latest` runner (Bun cross-compiles both).                                            |
| Local build     | A thin `npm run package` script (CI invokes the same script) so binaries can also be produced locally.                                                                |
| Packaging guard | **CI smoke test:** run the Linux binary with `--version`, assert it prints the package version and exits 0, before uploading the release.                             |

## Architecture

A new build step compiles the already-built server into native executables; CI wires that step to releases. No application/runtime source changes are required — packaging is additive and lives in npm scripts, a helper build script, and a CI workflow.

```
npm run build            tsc → dist/index.js (+ generated src/version.ts)
        │
        ▼
npm run package          bun build --compile --target=bun-linux-x64-baseline  dist/index.js
                         bun build --compile --target=bun-windows-x64         dist/index.js
        │
        ▼
   dist/bin/azure-devops-mcp-linux-x64
   dist/bin/azure-devops-mcp-windows-x64.exe
```

### Build script

`npm run package`:

1. Runs `npm run build` (reuses the existing `tsc && shx chmod +x` pipeline, including `prebuild` regenerating `src/version.ts`).
2. Compiles two binaries from `dist/index.js` via Bun:
   - `--target=bun-linux-x64-baseline` → `dist/bin/azure-devops-mcp-linux-x64`
   - `--target=bun-windows-x64` → `dist/bin/azure-devops-mcp-windows-x64.exe` (Bun appends `.exe` for the Windows target)
3. Output directory `dist/bin/` is created if missing.

The loop over targets lives in a small Node helper (`scripts/package-binaries.js`) invoked by the npm script, so the target list and naming are defined once and shared by local builds and CI.

### CI / release workflow

New `.github/workflows/release-binaries.yml`:

- **Trigger:** `push` on tags matching `v*` (matches the existing `version` scheme in `package.json`).
- **Runner:** `ubuntu-latest` (single host; Bun cross-compiles both targets).
- **Steps:**
  1. `actions/checkout`
  2. `actions/setup-node` (Node 22) + `npm ci`
  3. `oven-sh/setup-bun`
  4. `npm run package`
  5. Generate `SHA256SUMS` covering both artifacts.
  6. **Smoke gate:** run `./dist/bin/azure-devops-mcp-linux-x64 --version`; assert stdout contains the `package.json` version and the exit code is 0. Fail the job otherwise.
  7. Attach both binaries + `SHA256SUMS` to the GitHub Release via `softprops/action-gh-release`.

## Runtime / auth considerations

- The embedded Bun runtime removes the Node.js requirement on the target.
- All dependencies are pure-JS (no native addons), so the compiled binary needs no extra shared libraries.
- **Offline auth:** `pat` and `env` modes are fully offline and are the recommended modes for air-gapped on-prem use. `interactive` and `azcli` still function inside the binary but require network access / the `az` CLI respectively; documentation steers air-gapped users to PAT.

## Error handling / edge cases

- **CPU compatibility:** the `-baseline` Linux target avoids AVX2-instruction `SIGILL` crashes on older or virtualized CPUs.
- **Windows SmartScreen / Defender:** the unsigned `.exe` may trigger a warning on first run; documented as a known limitation (code signing is out of scope).
- **Binary size:** each artifact is ~60–90 MB (embedded runtime); documented so the size is expected, not alarming.
- **Future native dependency:** if a dependency that ships a native addon is later added, `bun build --compile` may need extra handling; noted for maintainers.

## Testing

- The existing Jest suite is unchanged — it exercises the source from which the binary is built, so packaging introduces no new unit tests.
- The **CI `--version` smoke test** is the packaging regression guard: it proves the compiled binary boots, parses args, and reports the correct version.
- A deeper stdio MCP handshake check is intentionally **not** included (YAGNI); `--version` plus the unchanged unit suite is sufficient confidence for an additive packaging step.

## Documentation

- `docs/GETTINGSTARTED.md` — add a "Standalone binary" section showing an MCP client config that points `command` at an absolute binary path with `args` of `<org-or-collection-url> --authentication pat`, as an alternative to the `npx` configuration.
- Note the Windows SmartScreen warning and approximate binary size.
- Cross-reference from the on-prem documentation, since air-gapped distribution is a primary motivation.

## Out of scope

- **macOS builds & notarization.** Not requested; macOS adds code-signing/notarization complexity.
- **arm64** (Linux or Windows).
- **Code signing** — Windows Authenticode and macOS notarization.
- **Auto-update** mechanism.
- **Publishing binaries to npm.** The `npx`/npm distribution stays exactly as-is; binaries are GitHub Release artifacts only.
