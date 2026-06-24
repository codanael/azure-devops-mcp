# On-Premises Support — Design

**Date:** 2026-06-24
**Status:** Approved (design); pending implementation plan
**Fork:** `codanael/azure-devops-mcp` (of `microsoft/azure-devops-mcp`)

## Goal

Allow the local Azure DevOps MCP server to run against **Azure DevOps Server (on-premises)** collections, not just Azure DevOps Services (cloud), using **Personal Access Token (PAT)** authentication.

## Background

Today the server is hardwired to the cloud:

- `src/index.ts:62` builds the org URL as `https://dev.azure.com/{org}` — no way to specify an on-prem collection URL.
- Default auth (`interactive`/`azcli`/`env`) acquires Microsoft Entra ID bearer tokens via MSAL, which on-prem servers do not accept.
- `src/org-tenants.ts` resolves an Entra tenant via `vssps.dev.azure.com` on every startup.
- Search (`src/tools/search.ts`) and Identities (`src/tools/auth.ts`) hardcode the cloud-only `almsearch.dev.azure.com` / `vssps.dev.azure.com` subdomains.
- API versions are pinned to cloud-only previews (`7.2-preview.1`, `7.2-preview.4` in `src/utils.ts`).
- `getOrgFromUrl` (`src/utils.ts:112`) only recognizes `dev.azure.com` / `*.visualstudio.com`, so the wiki org-boundary check rejects on-prem URLs.
- Advanced Security (`src/tools/advanced-security.ts`) is a cloud-only product with no on-prem equivalent.

The FAQ currently claims on-prem is unsupported due to "missing API endpoints." In reality, most blockers are hardcoded cloud assumptions in this codebase, not missing server APIs. The genuine gaps are: Advanced Security (cloud-only) and the newest preview APIs (absent before Server 2022 / API 7.1).

## Decisions

| Area | Decision |
|---|---|
| Compatibility | **Dual-mode, additive.** Cloud behavior is unchanged; on-prem is opt-in. Changes stay minimal so the fork can keep merging from upstream. |
| Invocation | **Auto-detect positional arg.** If the positional argument parses as a URL, on-prem mode is implied; a bare name remains cloud (unchanged). |
| Auth | **PAT only.** On-prem implies `--authentication pat`. Entra-based modes (`interactive`/`azcli`/`env`) warn (and are rejected) when an on-prem URL is given. NTLM/Kerberos is out of scope. |
| API version | Cloud keeps `7.2-preview.*`. On-prem defaults to stable **`7.1`** (targets Azure DevOps Server 2019/2020/2022), overridable via `--api-version` / env. |
| Cloud-only tools | On-prem **auto-disables Advanced Security**, and **rewrites Search + Identities** to use the collection host instead of `almsearch`/`vssps` subdomains. |

## Architecture

A single **deployment-context object** is computed once at startup and threaded where needed, rather than scattering `isOnPrem` checks across the codebase.

```
positional arg ──► resolveDeployment(arg, authArg, apiVersionArg)
                      │
                      ▼
       DeploymentConfig {
         isOnPrem:      boolean
         baseUrl:       string   // cloud: https://dev.azure.com/{org}
                                 // on-prem: the collection URL (trailing slash stripped)
         orgIdentifier: string   // identity used for boundary checks + cloud subdomain building
         apiVersion:    string   // 7.2-preview.1 (cloud) | 7.1 (on-prem, overridable)
       }
```

Because `WebApi` is constructed with `baseUrl`, `connection.serverUrl` becomes the collection URL automatically on-prem. Most tools already build their REST URLs from `connection.serverUrl`, so they need **no changes**. Only the cloud-subdomain tools and the API-version constants require wiring.

### URL detection rule

`resolveDeployment` treats the positional argument as on-prem if and only if it parses as an absolute `http(s)` URL (`new URL(arg)` succeeds and protocol is `http:`/`https:`). Otherwise it is a cloud org name and `baseUrl` = `https://dev.azure.com/{arg}` (current behavior, preserved exactly).

### Host-aware base URL helpers

Two helpers in `src/utils.ts` branch on the connection host so cloud and on-prem share one code path:

- `getSearchBaseUrl(serverUrl)` → cloud host ⇒ `https://almsearch.dev.azure.com/{org}`; on-prem ⇒ `serverUrl` directly.
- `getIdentitiesBaseUrl(serverUrl)` → cloud host ⇒ `https://vssps.dev.azure.com/{org}`; on-prem ⇒ `serverUrl` directly.

"Cloud host" = host is `dev.azure.com`/`*.dev.azure.com` or `*.visualstudio.com` (reuse the logic already in `getOrgFromUrl`).

## Change set

1. **`src/index.ts`** — call `resolveDeployment()`; construct `WebApi` with `baseUrl`; default auth to `pat` when on-prem and reject Entra modes with a clear error; skip `getOrgTenant()` when on-prem; add the `--api-version` yargs option.
2. **New `src/shared/deployment.ts`** — `resolveDeployment()` + `DeploymentConfig` type. Pure and unit-testable.
3. **`src/utils.ts`** — replace hardcoded `apiVersion` / `markdownCommentsApiVersion` constants with mode-aware resolution initialized at startup; add `getSearchBaseUrl()` / `getIdentitiesBaseUrl()`; generalize `getOrgFromUrl()` to return a stable identity for on-prem hosts.
4. **`src/tools/search.ts`** — use `getSearchBaseUrl()` instead of hardcoded `almsearch.dev.azure.com`.
5. **`src/tools/auth.ts`** — use `getIdentitiesBaseUrl()` instead of hardcoded `vssps.dev.azure.com`.
6. **`src/shared/domains.ts`** — `DomainsManager` accepts an `isOnPrem` flag and excludes `advanced-security` on-prem (mirrors the existing `mcp-apps` exclusion from `all`).
7. **`getOrgFromUrl` boundary** — on-prem identity resolution so the wiki org-boundary check (`src/tools/wiki.ts:228`) passes for on-prem URLs.
8. **Markdown comments degrade** — on-prem lacks `7.2-preview.4`; `src/tools/work-items.ts` comment tools fall back to plain comments (omit the markdown `format` query param) when on-prem.

## Error handling

- On-prem URL + Entra auth mode (`interactive`/`azcli`/`env`): fail fast at startup with a message directing the user to `--authentication pat` and `PERSONAL_ACCESS_TOKEN`.
- Missing `PERSONAL_ACCESS_TOKEN` when PAT auth is selected: existing behavior (clear startup error) is reused.
- Search tools against a server without the Search extension installed: surface the server's error response as-is (no special-casing); documented as a prerequisite.

## Testing

New/updated unit tests under `test/src/`, mirroring source structure:

- `deployment.test.ts` — name vs URL detection; auth defaulting/rejection; api-version resolution and override.
- `utils.test.ts` (extend) — `getSearchBaseUrl` / `getIdentitiesBaseUrl` for cloud and on-prem hosts; `getOrgFromUrl` on-prem identity.
- `domains.test.ts` (extend) — `advanced-security` excluded when `isOnPrem`, retained for cloud.
- Existing cloud-path tests must remain green — the regression guard for the additive promise.

## Out of scope

- **NTLM / Kerberos (Windows Integrated Auth).** PAT only. Servers that require Windows auth without a PAT option are unsupported. Documented in the FAQ update.
- **Advanced Security on-prem.** Cloud-only product; the domain is disabled, not reimplemented.
- **Auto-detection of server API version.** A fixed `7.1` default plus manual override is used instead of a startup capability probe.

## Documentation

- Update `docs/FAQ.md` to describe on-prem support, the PAT requirement, supported server versions, and the out-of-scope limitations.
- Update `README.md` / `docs/GETTINGSTARTED.md` with an on-prem invocation example.
