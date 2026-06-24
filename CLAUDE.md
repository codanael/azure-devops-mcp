# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local **stdio** MCP server (`@azure-devops/mcp`) that exposes Azure DevOps REST APIs to AI agents as MCP tools. The design philosophy (see `README.md`/`CONTRIBUTING.md`) is deliberately thin: tools are concise wrappers over the `azure-devops-node-api` REST clients, with one tool per focused scenario. Avoid adding tools with heavy logic — let the LLM do the reasoning, not the tool. Note the repo is steering users toward the hosted Remote MCP Server; the local server here is in maintenance-plus mode, so keep contributions simple.

## Commands

```bash
npm run build            # tsc -> dist/, then chmod +x (runs prebuild to regenerate src/version.ts)
npm run watch            # tsc --watch
npm test                 # jest (collects coverage by default; min thresholds 40%)
npm test test/src/utils.test.ts   # run a single test file
npm test -- --coverage   # explicit coverage report
npm run eslint           # lint; eslint-fix to autofix
npm run format           # prettier --write .  (format-check to verify; CI enforces this)
npm run validate-tools   # tsc --noEmit + validate all MCP tool/param names
npm run inspect          # run built server under @modelcontextprotocol/inspector
npm run package          # build, then bun --compile to dist/bin/ (Linux x64 + Windows x64 binaries)
```

Run the built server: `node dist/index.js <organization-or-collection-url> [--domains ...] [--authentication ...] [--api-version ...]`.

A pre-commit hook (husky + lint-staged) runs prettier on staged files automatically.

**Nix dev shell:** a `flake.nix` provides Node 22 + git. On a Nix host where `node`/`npm` aren't on the global PATH, prefix every node command with the dev shell, e.g. `nix develop -c bash -c 'npm test'` (the husky pre-commit hook calls `npx`, so commits also need `nix develop -c bash -c 'git commit ...'`). All other tooling (tsc/eslint/prettier/jest) comes from npm devDependencies.

## Architecture

**Entry point** `src/index.ts`: parses CLI args with yargs (positional `organization`, plus `--domains`, `--authentication`, `--tenant`, `--api-version`), resolves the deployment mode (see below), builds an authenticator, creates the `McpServer`, wires it to a `StdioServerTransport`, and calls `configureAllTools`. Auth supports `interactive | azcli | env/envvar | pat` (see `src/auth.ts`). PAT mode installs a global `fetch` interceptor that rewrites `Bearer` → `Basic` headers because `azure-devops-node-api` assumes bearer tokens — this is what makes the raw-`fetch` tools (search, identities, comments, wiki, test-plans, pipelines stages) work under PAT.

**Deployment mode (cloud vs on-prem)** (`src/shared/deployment.ts`): the positional argument is either a cloud org name or a full on-prem collection URL. `resolveDeployment()` detects which (a parseable `http(s)` URL ⇒ on-prem) and produces a `DeploymentConfig` (`isOnPrem`, `baseUrl`, `orgIdentifier`, `apiVersion`, `commentsApiVersion`) stored in a module singleton via `setDeployment()`. Tools read it through helpers in `src/utils.ts` rather than checking `isOnPrem` directly: `getApiVersion()`/`getCommentsApiVersion()` (cloud `7.2-preview.*`; on-prem `7.0`/`7.1-preview.4`, overridable via `--api-version`), and `getSearchBaseUrl()`/`getIdentitiesBaseUrl()` (cloud `almsearch`/`vssps` subdomains; on-prem the collection host). `getOrgIdentity()` backs the wiki cross-org boundary check for both modes. On-prem forces PAT auth (Entra modes are rejected), skips the cloud tenant lookup, and disables the `advanced-security` domain. **Anything that builds a REST URL or picks an api-version must go through these helpers, never hardcode `dev.azure.com`/`almsearch`/`vssps` or a version literal.**

**Tool registration** flows `index.ts → src/tools.ts → src/tools/<domain>.ts`. Each `src/tools/<domain>.ts` exports a `configure<Domain>Tools(server, tokenProvider, connectionProvider, userAgentProvider)` function that registers tools via `server.tool(name, description, zodSchema, handler)`. `tools.ts` only calls a domain's configure function if that domain is enabled.

**Domains** (`src/shared/domains.ts`): the `Domain` enum + `DomainsManager` gate which tool groups load, driven by the `--domains` flag (`all`, or a space/comma list like `repositories work`). `mcp-apps` is excluded from `all` and must be requested explicitly. When adding a new tool group, add it to the enum, register it in `tools.ts`, and gate it with `configureIfDomainEnabled`.

**Handler shape**: handlers call `connectionProvider()` to get a `WebApi`, then a sub-client (`connection.getWikiApi()`, `getGitApi()`, etc.), wrap the call in try/catch, and return `{ content: [{ type: "text", text: ... }], isError? }`. Results are typically `JSON.stringify(data, null, 2)`.

## Conventions that will bite you if missed

- **ESM + Node16 resolution**: `"type": "module"`, `module: Node16`. Relative imports **must** use the `.js` extension even though sources are `.ts` (e.g. `import { logger } from "./logger.js"`). Jest maps these back to `.ts` via `moduleNameMapper` in `jest.config.cjs` — if you add a new shared module that tests import, you may need to add a mapping there.
- **Tool & parameter names** must match `^[a-zA-Z0-9_.-]{1,64}$` (Claude API requirement). Enforced three ways: the `custom/validate-tool-names` ESLint rule on `src/tools/*.ts`, `npm run validate-tools` at build, and tests. Tool names are defined in a `*_TOOLS` const map per file and follow `{category}_{action}_{object}` (e.g. `wiki_create_or_update_page`); keep params ≤32 chars. See `docs/TOOL-NAME-VALIDATION.md`.
- **License header**: every `src/**/*.ts` except `src/index.ts` must start with the two-line `// Copyright (c) Microsoft Corporation.` / `// Licensed under the MIT License.` header — enforced by `eslint-plugin-header`.
- **Never write to stdout** — it carries the MCP protocol. Use the `winston` logger from `src/logger.ts`, which is redirected to stderr. Set `LOG_LEVEL=debug` to see logs.
- **Untrusted external content**: data fetched from Azure DevOps (wiki pages, comments, etc.) must be wrapped via `createExternalContentResponse`/`spotlightContent` from `src/shared/content-safety.ts` before being returned, so the LLM treats it as data, not instructions. Follow this pattern for any tool returning user-authored content.
- **`src/version.ts` is generated** from `package.json` by the `prebuild` script — do not edit it by hand (it's gitignored from lint/format).

## Tests

Jest + ts-jest, config in `jest.config.cjs` + `tsconfig.jest.json` (CommonJS, `isolatedModules: true`). Tests live under `test/` mirroring `src/`, with shared fixtures in `test/mocks/`. PRs are expected to include passing tests for new/changed tools.
