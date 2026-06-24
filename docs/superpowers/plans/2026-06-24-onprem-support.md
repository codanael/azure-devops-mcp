# On-Premises Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the local Azure DevOps MCP server run against on-premises Azure DevOps Server collections using PAT auth, additively, without changing cloud behavior.

**Architecture:** A single `DeploymentConfig` is resolved once at startup from the positional argument (bare name ⇒ cloud; URL ⇒ on-prem) and stored in a module singleton. Tools read mode-aware API versions and base URLs from it. Cloud-only subdomains (`almsearch`, `vssps`) and tools (Advanced Security) are rewritten or disabled on-prem.

**Tech Stack:** TypeScript (ESM, Node16), `@modelcontextprotocol/sdk`, `azure-devops-node-api`, yargs, zod, Jest + ts-jest.

---

## Verified API references (Microsoft Learn)

These facts drive the plan. Sources verified during planning:

- **API version ↔ Server release:** 2019→`5.0`, 2020→`6.0`, **2022 RTW→`7.0`**, 2022.1→`7.1`. `7.2`/`7.2-preview` is **Azure DevOps Services (cloud) only**; no shipped on-prem release exposes it. Safe on-prem default for the 2022 family is **`7.0`**. — https://learn.microsoft.com/en-us/rest/api/azure/devops/?view=azure-devops-rest-7.2 and https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rest-api-versioning
- **Search:** on-prem is served from the collection host (`https://{instance}/{collection}/_apis/search/codesearchresults`), **not** `almsearch.dev.azure.com`. GA (no `-preview`); on-prem versions `5.0/6.0/7.0/7.1`. Code Search requires the Search extension installed per collection. — https://learn.microsoft.com/en-us/rest/api/azure/devops/search/code-search-results/fetch-code-search-results?view=azure-devops-server-rest-7.1
- **Identities:** on-prem at `https://{instance}/{collection}/_apis/identities?api-version=7.1` (collection-scoped, GA), **not** `vssps.dev.azure.com`. — https://learn.microsoft.com/en-us/rest/api/azure/devops/ims/identities/read-identities?view=azure-devops-server-rest-7.1
- **Work item comments `format`:** preview-only (`*-preview.4`), no GA equivalent. For on-prem robustness, **omit the `format` query parameter** (defaults to HTML) and use `7.1-preview.4`. — https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/add-work-item-comment?view=azure-devops-server-rest-7.1

## File structure

| File                                                         | Responsibility                                                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/deployment.ts` (new)                             | `DeploymentConfig` type, `resolveDeployment()`, `resolveAuthentication()`, singleton `setDeployment()`/`getDeployment()`. Pure logic.                           |
| `src/utils.ts` (modify)                                      | `getApiVersion()`/`getCommentsApiVersion()` (read singleton); host helpers `isCloudHost()`, `getSearchBaseUrl()`, `getIdentitiesBaseUrl()`, `getOrgIdentity()`. |
| `src/shared/domains.ts` (modify)                             | `DomainsManager` accepts `isOnPrem`; excludes `advanced-security` on-prem.                                                                                      |
| `src/tools/search.ts` (modify)                               | Use `getSearchBaseUrl()` + `getApiVersion()`; drop `orgName` import.                                                                                            |
| `src/tools/auth.ts` (modify)                                 | Use `getIdentitiesBaseUrl()` + `getApiVersion()`.                                                                                                               |
| `src/tools/work-items.ts` (modify)                           | Comments: omit `format` on-prem; use `getCommentsApiVersion()`.                                                                                                 |
| `src/tools/wiki.ts` (modify)                                 | Boundary check uses `getOrgIdentity()`; version literals use `getApiVersion()`.                                                                                 |
| `src/tools/pipelines.ts`, `src/tools/test-plans.ts` (modify) | Swap `apiVersion` → `getApiVersion()`.                                                                                                                          |
| `src/index.ts` (modify)                                      | Wire `resolveDeployment`/`resolveAuthentication`/`setDeployment`; `--api-version`; skip tenant lookup on-prem.                                                  |
| `jest.config.cjs` (modify)                                   | Map `deployment.js` → `deployment.ts`.                                                                                                                          |
| `docs/FAQ.md`, `docs/GETTINGSTARTED.md` (modify)             | Document on-prem usage + limitations.                                                                                                                           |

---

## Task 1: Deployment config module

**Files:**

- Create: `src/shared/deployment.ts`
- Test: `test/src/deployment.test.ts`
- Modify: `jest.config.cjs` (moduleNameMapper)

- [ ] **Step 1: Add the Jest module mapping**

In `jest.config.cjs`, inside `moduleNameMapper`, add a line alongside the existing entries:

```js
    "^(.+)/deployment\\.js$": "$1/deployment.ts",
```

- [ ] **Step 2: Write the failing test**

Create `test/src/deployment.test.ts`:

```ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { resolveDeployment, resolveAuthentication, setDeployment, getDeployment } from "../../src/shared/deployment";

describe("resolveDeployment", () => {
  it("treats a bare name as cloud", () => {
    const c = resolveDeployment("contoso");
    expect(c.isOnPrem).toBe(false);
    expect(c.baseUrl).toBe("https://dev.azure.com/contoso");
    expect(c.apiVersion).toBe("7.2-preview.1");
    expect(c.commentsApiVersion).toBe("7.2-preview.4");
  });

  it("treats an http(s) URL as on-prem and strips trailing slashes", () => {
    const c = resolveDeployment("https://tfs.contoso.com/DefaultCollection/");
    expect(c.isOnPrem).toBe(true);
    expect(c.baseUrl).toBe("https://tfs.contoso.com/DefaultCollection");
    expect(c.apiVersion).toBe("7.0");
    expect(c.commentsApiVersion).toBe("7.1-preview.4");
    expect(c.orgIdentifier).toBe("tfs.contoso.com/defaultcollection");
  });

  it("honors an on-prem api-version override", () => {
    const c = resolveDeployment("https://tfs.contoso.com/DefaultCollection", "6.0");
    expect(c.apiVersion).toBe("6.0");
  });

  it("ignores api-version override for cloud", () => {
    const c = resolveDeployment("contoso", "6.0");
    expect(c.apiVersion).toBe("7.2-preview.1");
  });
});

describe("resolveAuthentication", () => {
  it("forces pat on-prem when unspecified", () => {
    expect(resolveAuthentication(undefined, true, false)).toBe("pat");
  });
  it("allows explicit pat on-prem", () => {
    expect(resolveAuthentication("pat", true, false)).toBe("pat");
  });
  it("rejects Entra auth modes on-prem", () => {
    expect(() => resolveAuthentication("interactive", true, false)).toThrow(/PAT/);
    expect(() => resolveAuthentication("azcli", true, false)).toThrow(/PAT/);
    expect(() => resolveAuthentication("env", true, false)).toThrow(/PAT/);
  });
  it("defaults cloud to interactive, or azcli in codespaces", () => {
    expect(resolveAuthentication(undefined, false, false)).toBe("interactive");
    expect(resolveAuthentication(undefined, false, true)).toBe("azcli");
  });
  it("passes through an explicit cloud auth type", () => {
    expect(resolveAuthentication("pat", false, false)).toBe("pat");
  });
});

describe("getDeployment", () => {
  it("returns a cloud default before any setDeployment call", () => {
    const c = getDeployment();
    expect(c.isOnPrem).toBe(false);
    expect(c.apiVersion).toBe("7.2-preview.1");
  });
  it("returns the active config after setDeployment", () => {
    setDeployment(resolveDeployment("https://tfs.contoso.com/DefaultCollection"));
    expect(getDeployment().isOnPrem).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test test/src/deployment.test.ts`
Expected: FAIL — cannot find module `../../src/shared/deployment`.

- [ ] **Step 4: Implement the module**

Create `src/shared/deployment.ts`:

```ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface DeploymentConfig {
  /** True when targeting an on-premises Azure DevOps Server collection. */
  isOnPrem: boolean;
  /** Base URL passed to WebApi: cloud org URL or the on-prem collection URL. */
  baseUrl: string;
  /** Stable identity for boundary checks: org name (cloud) or host/collection (on-prem). */
  orgIdentifier: string;
  /** API version for general REST calls. */
  apiVersion: string;
  /** API version for the work item comments endpoint. */
  commentsApiVersion: string;
}

const CLOUD_API_VERSION = "7.2-preview.1";
const CLOUD_COMMENTS_API_VERSION = "7.2-preview.4";
const ONPREM_DEFAULT_API_VERSION = "7.0";
const ONPREM_COMMENTS_API_VERSION = "7.1-preview.4";

const ENTRA_AUTH_TYPES = new Set(["interactive", "azcli", "env"]);

const DEFAULT_CLOUD: DeploymentConfig = {
  isOnPrem: false,
  baseUrl: "",
  orgIdentifier: "",
  apiVersion: CLOUD_API_VERSION,
  commentsApiVersion: CLOUD_COMMENTS_API_VERSION,
};

function tryParseHttpUrl(value: string): URL | null {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function deriveCollectionIdentity(url: URL): string {
  const firstSegment = url.pathname.split("/").filter(Boolean)[0];
  const host = url.hostname.toLowerCase();
  return firstSegment ? `${host}/${firstSegment.toLowerCase()}` : host;
}

/**
 * Resolve the deployment context from the positional CLI argument.
 * A bare name is a cloud organization; an http(s) URL is an on-prem collection.
 */
export function resolveDeployment(positional: string, apiVersionOverride?: string): DeploymentConfig {
  const asUrl = tryParseHttpUrl(positional);
  if (asUrl) {
    return {
      isOnPrem: true,
      baseUrl: positional.replace(/\/+$/, ""),
      orgIdentifier: deriveCollectionIdentity(asUrl),
      apiVersion: apiVersionOverride ?? ONPREM_DEFAULT_API_VERSION,
      commentsApiVersion: ONPREM_COMMENTS_API_VERSION,
    };
  }
  return {
    isOnPrem: false,
    baseUrl: `https://dev.azure.com/${positional}`,
    orgIdentifier: positional.toLowerCase(),
    apiVersion: CLOUD_API_VERSION,
    commentsApiVersion: CLOUD_COMMENTS_API_VERSION,
  };
}

/**
 * Resolve the authentication type. On-prem requires PAT and rejects Entra-based modes.
 */
export function resolveAuthentication(requested: string | undefined, isOnPrem: boolean, isCodespace: boolean): string {
  if (isOnPrem) {
    if (requested && requested !== "pat") {
      throw new Error(
        `On-premises Azure DevOps Server requires PAT authentication. Authentication type '${requested}' is not supported on-prem. ` +
          `Use '--authentication pat' with the PERSONAL_ACCESS_TOKEN environment variable.`
      );
    }
    return "pat";
  }
  if (requested) return requested;
  return isCodespace ? "azcli" : "interactive";
}

let active: DeploymentConfig | undefined;

export function setDeployment(config: DeploymentConfig): void {
  active = config;
}

export function getDeployment(): DeploymentConfig {
  return active ?? DEFAULT_CLOUD;
}

// Exported for tests that need to assert the Entra set.
export { ENTRA_AUTH_TYPES };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test test/src/deployment.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/shared/deployment.ts test/src/deployment.test.ts jest.config.cjs
git commit -m "Add deployment config module for cloud/on-prem resolution"
```

---

## Task 2: Host-aware helpers in utils.ts

**Files:**

- Modify: `src/utils.ts` (lines 4-6 constants; add helpers)
- Test: `test/src/utils.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `test/src/utils.test.ts` (add imports for the new functions at the top of the file):

```ts
import { getApiVersion, getCommentsApiVersion, getSearchBaseUrl, getIdentitiesBaseUrl, getOrgIdentity } from "../../src/utils";
import { setDeployment, resolveDeployment } from "../../src/shared/deployment";

describe("mode-aware api versions", () => {
  afterEach(() => setDeployment(resolveDeployment("contoso"))); // reset to cloud

  it("returns cloud versions by default", () => {
    setDeployment(resolveDeployment("contoso"));
    expect(getApiVersion()).toBe("7.2-preview.1");
    expect(getCommentsApiVersion()).toBe("7.2-preview.4");
  });
  it("returns on-prem versions on-prem", () => {
    setDeployment(resolveDeployment("https://tfs.contoso.com/DefaultCollection"));
    expect(getApiVersion()).toBe("7.0");
    expect(getCommentsApiVersion()).toBe("7.1-preview.4");
  });
});

describe("getSearchBaseUrl", () => {
  it("uses the almsearch subdomain for cloud", () => {
    expect(getSearchBaseUrl("https://dev.azure.com/contoso")).toBe("https://almsearch.dev.azure.com/contoso");
  });
  it("uses the collection host on-prem", () => {
    expect(getSearchBaseUrl("https://tfs.contoso.com/DefaultCollection")).toBe("https://tfs.contoso.com/DefaultCollection");
  });
});

describe("getIdentitiesBaseUrl", () => {
  it("uses the vssps subdomain for cloud", () => {
    expect(getIdentitiesBaseUrl("https://dev.azure.com/contoso")).toBe("https://vssps.dev.azure.com/contoso");
  });
  it("uses the collection host on-prem", () => {
    expect(getIdentitiesBaseUrl("https://tfs.contoso.com/DefaultCollection")).toBe("https://tfs.contoso.com/DefaultCollection");
  });
});

describe("getOrgIdentity", () => {
  it("matches getOrgFromUrl for cloud hosts", () => {
    expect(getOrgIdentity("https://dev.azure.com/contoso/_git/repo")).toBe("contoso");
  });
  it("returns host/collection for on-prem hosts", () => {
    expect(getOrgIdentity("https://tfs.contoso.com/DefaultCollection/Project/_wiki")).toBe("tfs.contoso.com/defaultcollection");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test test/src/utils.test.ts`
Expected: FAIL — exports `getApiVersion` etc. do not exist.

- [ ] **Step 3: Implement the helpers**

In `src/utils.ts`, replace lines 4-6:

```ts
export const apiVersion = "7.2-preview.1";
export const batchApiVersion = "5.0";
export const markdownCommentsApiVersion = "7.2-preview.4";
```

with:

```ts
import { getDeployment } from "./shared/deployment.js";

/** The $batch envelope version is stable across cloud and on-prem. */
export const batchApiVersion = "5.0";

/** API version for general REST calls, mode-aware. */
export function getApiVersion(): string {
  return getDeployment().apiVersion;
}

/** API version for the work item comments endpoint, mode-aware. */
export function getCommentsApiVersion(): string {
  return getDeployment().commentsApiVersion;
}

/** True when the host is an Azure DevOps Services (cloud) host. */
export function isCloudHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "dev.azure.com" || h.endsWith(".dev.azure.com") || h === "visualstudio.com" || h.endsWith(".visualstudio.com");
}

/** Base URL for the Search REST API: cloud uses the almsearch subdomain, on-prem uses the collection host. */
export function getSearchBaseUrl(serverUrl: string): string {
  const u = new URL(serverUrl);
  if (isCloudHost(u.hostname)) {
    const org = getOrgFromUrl(serverUrl);
    return `https://almsearch.dev.azure.com/${org}`;
  }
  return serverUrl.replace(/\/+$/, "");
}

/** Base URL for the Identities REST API: cloud uses the vssps subdomain, on-prem uses the collection host. */
export function getIdentitiesBaseUrl(serverUrl: string): string {
  const u = new URL(serverUrl);
  if (isCloudHost(u.hostname)) {
    const org = getOrgFromUrl(serverUrl);
    return `https://vssps.dev.azure.com/${org}`;
  }
  return serverUrl.replace(/\/+$/, "");
}

/**
 * Stable organization/collection identity for cross-boundary checks.
 * Cloud: the org name (same as getOrgFromUrl). On-prem: host/collection.
 */
export function getOrgIdentity(url: string): string | null {
  try {
    const u = new URL(url);
    if (isCloudHost(u.hostname)) {
      return getOrgFromUrl(url);
    }
    const firstSegment = u.pathname.split("/").filter(Boolean)[0];
    return firstSegment ? `${u.hostname.toLowerCase()}/${firstSegment.toLowerCase()}` : null;
  } catch {
    return null;
  }
}
```

Note: `getSearchBaseUrl`/`getIdentitiesBaseUrl`/`getOrgIdentity` reference `getOrgFromUrl`, which is defined lower in the same file — that is fine for function declarations (hoisted). Keep them above or below as convenient.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test test/src/utils.test.ts`
Expected: PASS, including the pre-existing `getOrgFromUrl` tests (unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/utils.ts test/src/utils.test.ts
git commit -m "Add mode-aware api-version and host helpers to utils"
```

---

## Task 3: Rewrite Search tool hosts

**Files:**

- Modify: `src/tools/search.ts:8-9` (imports), `:39`, `:97`, `:151` (URLs)
- Test: `test/src/tools/search.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `test/src/tools/search.test.ts`:

```ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getSearchBaseUrl, getApiVersion } from "../../../src/utils";
import { setDeployment, resolveDeployment } from "../../../src/shared/deployment";

describe("search URL construction", () => {
  it("builds a cloud code search URL", () => {
    setDeployment(resolveDeployment("contoso"));
    const url = `${getSearchBaseUrl("https://dev.azure.com/contoso")}/_apis/search/codesearchresults?api-version=${getApiVersion()}`;
    expect(url).toBe("https://almsearch.dev.azure.com/contoso/_apis/search/codesearchresults?api-version=7.2-preview.1");
  });
  it("builds an on-prem code search URL on the collection host", () => {
    setDeployment(resolveDeployment("https://tfs.contoso.com/DefaultCollection"));
    const url = `${getSearchBaseUrl("https://tfs.contoso.com/DefaultCollection")}/_apis/search/codesearchresults?api-version=${getApiVersion()}`;
    expect(url).toBe("https://tfs.contoso.com/DefaultCollection/_apis/search/codesearchresults?api-version=7.0");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test test/src/tools/search.test.ts`
Expected: FAIL — `getSearchBaseUrl` not yet imported into search.ts (test itself passes once Task 2 is done, but run after edits). If Task 2 is merged it will PASS at the helper level; the point of this task is wiring search.ts. Proceed to Step 3 regardless.

- [ ] **Step 3: Edit search.ts imports**

Replace lines 8-9:

```ts
import { apiVersion } from "../utils.js";
import { orgName } from "../index.js";
```

with:

```ts
import { getApiVersion, getSearchBaseUrl } from "../utils.js";
```

- [ ] **Step 4: Edit the three search URLs**

Line 39:

```ts
const url = `${getSearchBaseUrl(connection.serverUrl)}/_apis/search/codesearchresults?api-version=${getApiVersion()}`;
```

Line 97:

```ts
const url = `${getSearchBaseUrl(connection.serverUrl)}/_apis/search/wikisearchresults?api-version=${getApiVersion()}`;
```

Line 151:

```ts
const url = `${getSearchBaseUrl(connection.serverUrl)}/_apis/search/workitemsearchresults?api-version=${getApiVersion()}`;
```

(`connection` is already obtained in each handler before the URL line — verify it is fetched above each; for `search_code` it is at line 38. For `search_wiki`/`search_workitem`, ensure `const connection = await connectionProvider();` precedes the URL; add it if absent.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test test/src/tools/search.test.ts && npm run validate-tools`
Expected: PASS; no TypeScript errors; `orgName` no longer imported.

- [ ] **Step 6: Commit**

```bash
git add src/tools/search.ts test/src/tools/search.test.ts
git commit -m "Route Search API through collection host on-prem"
```

---

## Task 4: Rewrite Identities tool host

**Files:**

- Modify: `src/tools/auth.ts:5` (import), `:37-41`
- Test: `test/src/tools/auth.test.ts` (extend if present, else assert via helper)

- [ ] **Step 1: Write the failing test**

Append to `test/src/tools/auth.test.ts` (create the file with the standard header if it does not exist):

```ts
import { getIdentitiesBaseUrl } from "../../../src/utils";
import { setDeployment, resolveDeployment } from "../../../src/shared/deployment";

describe("identities URL construction", () => {
  it("uses vssps for cloud", () => {
    setDeployment(resolveDeployment("contoso"));
    expect(getIdentitiesBaseUrl("https://dev.azure.com/contoso")).toBe("https://vssps.dev.azure.com/contoso");
  });
  it("uses the collection host on-prem", () => {
    setDeployment(resolveDeployment("https://tfs.contoso.com/DefaultCollection"));
    expect(getIdentitiesBaseUrl("https://tfs.contoso.com/DefaultCollection")).toBe("https://tfs.contoso.com/DefaultCollection");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails / passes at helper level**

Run: `npm test test/src/tools/auth.test.ts`
Expected: PASS at helper level (helper exists from Task 2). Proceed to wire auth.ts.

- [ ] **Step 3: Edit auth.ts import (line 5)**

```ts
import { getApiVersion, getIdentitiesBaseUrl } from "../utils.js";
```

- [ ] **Step 4: Edit searchIdentities (lines 37-41)**

Replace:

```ts
  const orgName = connection.serverUrl.split("/")[3];
  const baseUrl = `https://vssps.dev.azure.com/${orgName}/_apis/identities`;

  const params = new URLSearchParams({
    "api-version": apiVersion,
```

with:

```ts
  const baseUrl = `${getIdentitiesBaseUrl(connection.serverUrl)}/_apis/identities`;

  const params = new URLSearchParams({
    "api-version": getApiVersion(),
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test test/src/tools/auth.test.ts && npm run validate-tools`
Expected: PASS; no unused `apiVersion` import remains.

- [ ] **Step 6: Commit**

```bash
git add src/tools/auth.ts test/src/tools/auth.test.ts
git commit -m "Route Identities API through collection host on-prem"
```

---

## Task 5: Degrade work item comments on-prem

**Files:**

- Modify: `src/tools/work-items.ts:11` (import), `:381-383`, `:438-441`
- Test: `test/src/tools/work-items.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `test/src/tools/work-items.test.ts`:

```ts
import { getCommentsApiVersion } from "../../../src/utils";
import { getDeployment, setDeployment, resolveDeployment } from "../../../src/shared/deployment";

// Mirrors the URL the comment tools build.
function commentUrl(orgUrl: string, project: string, workItemId: number, formatParameter: number): string {
  const formatSegment = getDeployment().isOnPrem ? "" : `format=${formatParameter}&`;
  return `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workItems/${workItemId}/comments?${formatSegment}api-version=${getCommentsApiVersion()}`;
}

describe("work item comment URL", () => {
  it("includes format on cloud", () => {
    setDeployment(resolveDeployment("contoso"));
    expect(commentUrl("https://dev.azure.com/contoso", "Proj", 5, 0)).toBe("https://dev.azure.com/contoso/Proj/_apis/wit/workItems/5/comments?format=0&api-version=7.2-preview.4");
  });
  it("omits format on-prem and uses the preview.4 version", () => {
    setDeployment(resolveDeployment("https://tfs.contoso.com/DefaultCollection"));
    expect(commentUrl("https://tfs.contoso.com/DefaultCollection", "Proj", 5, 0)).toBe("https://tfs.contoso.com/DefaultCollection/Proj/_apis/wit/workItems/5/comments?api-version=7.1-preview.4");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test test/src/tools/work-items.test.ts`
Expected: FAIL — `getCommentsApiVersion`/`getDeployment` not yet importable in that test (they exist from Tasks 1-2, so this asserts the URL-shape logic). Run after Step 3.

- [ ] **Step 3: Edit work-items.ts import (line 11)**

Replace:

```ts
import { batchApiVersion, markdownCommentsApiVersion, getEnumKeys, safeEnumConvert, encodeFormattedValue } from "../utils.js";
```

with:

```ts
import { batchApiVersion, getCommentsApiVersion, getEnumKeys, safeEnumConvert, encodeFormattedValue } from "../utils.js";
import { getDeployment } from "../shared/deployment.js";
```

- [ ] **Step 4: Edit add_work_item_comment URL (around lines 381-383)**

Replace:

```ts
        const formatParameter = (format ?? "Markdown") === "Markdown" ? 0 : 1;
        const response = await fetch(
          `${orgUrl}/${encodeURIComponent(resolvedProject)}/_apis/wit/workItems/${workItemId}/comments?format=${formatParameter}&api-version=${markdownCommentsApiVersion}`,
```

with:

```ts
        const formatParameter = (format ?? "Markdown") === "Markdown" ? 0 : 1;
        // On-prem: the `format` (markdown) parameter is cloud-first/preview-only; omit it so the comment posts as the server default.
        const formatSegment = getDeployment().isOnPrem ? "" : `format=${formatParameter}&`;
        const response = await fetch(
          `${orgUrl}/${encodeURIComponent(resolvedProject)}/_apis/wit/workItems/${workItemId}/comments?${formatSegment}api-version=${getCommentsApiVersion()}`,
```

- [ ] **Step 5: Edit update_work_item_comment URL (around lines 438-441)**

Replace:

```ts
        const formatParameter = (format ?? "Markdown") === "Markdown" ? 0 : 1;

        const response = await fetch(
          `${orgUrl}/${encodeURIComponent(resolvedProject)}/_apis/wit/workItems/${workItemId}/comments/${commentId}?format=${formatParameter}&api-version=${markdownCommentsApiVersion}`,
```

with:

```ts
        const formatParameter = (format ?? "Markdown") === "Markdown" ? 0 : 1;
        const formatSegment = getDeployment().isOnPrem ? "" : `format=${formatParameter}&`;

        const response = await fetch(
          `${orgUrl}/${encodeURIComponent(resolvedProject)}/_apis/wit/workItems/${workItemId}/comments/${commentId}?${formatSegment}api-version=${getCommentsApiVersion()}`,
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test test/src/tools/work-items.test.ts && npm run validate-tools`
Expected: PASS; `markdownCommentsApiVersion` import removed.

- [ ] **Step 7: Commit**

```bash
git add src/tools/work-items.ts test/src/tools/work-items.test.ts
git commit -m "Omit cloud-only comment format param on-prem"
```

---

## Task 6: Wiki version + boundary check

**Files:**

- Modify: `src/tools/wiki.ts:8` (import), `:148`, `:228-229`, `:253`, `:332`
- Test: `test/src/tools/wiki.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `test/src/tools/wiki.test.ts`:

```ts
import { getOrgIdentity } from "../../../src/utils";

describe("wiki org-boundary identity", () => {
  it("matches same on-prem collection", () => {
    const a = getOrgIdentity("https://tfs.contoso.com/DefaultCollection");
    const b = getOrgIdentity("https://tfs.contoso.com/DefaultCollection/Proj/_wiki/wikis/Proj.wiki");
    expect(a).toBe(b);
  });
  it("differs across on-prem collections", () => {
    const a = getOrgIdentity("https://tfs.contoso.com/CollectionA");
    const b = getOrgIdentity("https://tfs.contoso.com/CollectionB");
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes at helper level**

Run: `npm test test/src/tools/wiki.test.ts`
Expected: PASS (helper from Task 2). Proceed to wire wiki.ts.

- [ ] **Step 3: Edit wiki.ts import (line 8)**

Replace:

```ts
import { apiVersion, extractAdoStreamError, getOrgFromUrl } from "../utils.js";
```

with:

```ts
import { getApiVersion, extractAdoStreamError, getOrgIdentity } from "../utils.js";
```

- [ ] **Step 4: Update the list-pages api-version (line 148)**

Replace `"api-version": apiVersion,` with:

```ts
          "api-version": getApiVersion(),
```

- [ ] **Step 5: Update the boundary check (lines 228-229)**

Replace:

```ts
const configuredOrg = getOrgFromUrl(connection.serverUrl);
const urlOrg = getOrgFromUrl(url);
```

with:

```ts
const configuredOrg = getOrgIdentity(connection.serverUrl);
const urlOrg = getOrgIdentity(url);
```

- [ ] **Step 6: Update the two hardcoded `api-version=7.1` literals (lines 253, 332)**

In both URLs, replace `api-version=7.1` with `api-version=${getApiVersion()}`. Example for line 253:

```ts
const restUrl = `${baseUrl}/${encodeURIComponent(resolvedProject)}/_apis/wiki/wikis/${encodeURIComponent(resolvedWiki)}/pages/${parsed.pageId}?includeContent=true&api-version=${getApiVersion()}`;
```

And line 332:

```ts
const url = `${baseUrl}/${encodeURIComponent(projectParam)}/_apis/wiki/wikis/${encodeURIComponent(wikiIdentifier)}/pages?path=${encodedPath}&versionDescriptor.versionType=branch&versionDescriptor.version=${encodeURIComponent(branch)}&api-version=${getApiVersion()}`;
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test test/src/tools/wiki.test.ts && npm run validate-tools`
Expected: PASS; no remaining `getOrgFromUrl`/`apiVersion` references in wiki.ts. (If other call sites in wiki.ts still reference `parseWikiUrl` which uses `getOrgFromUrl` internally, leave those — only the boundary comparison changes.)

- [ ] **Step 8: Commit**

```bash
git add src/tools/wiki.ts test/src/tools/wiki.test.ts
git commit -m "Make wiki version and org-boundary check on-prem aware"
```

---

## Task 7: Pipelines + Test Plans version swap

**Files:**

- Modify: `src/tools/pipelines.ts:5,508`; `src/tools/test-plans.ts:8,36,498`

- [ ] **Step 1: Edit pipelines.ts**

Line 5 — replace `import { apiVersion, getEnumKeys, safeEnumConvert } from "../utils.js";` with:

```ts
import { getApiVersion, getEnumKeys, safeEnumConvert } from "../utils.js";
```

Line 508 — replace `?api-version=${apiVersion}` with `?api-version=${getApiVersion()}`.

- [ ] **Step 2: Edit test-plans.ts**

Line 8 — replace `import { apiVersion } from "../utils.js";` with:

```ts
import { getApiVersion } from "../utils.js";
```

Line 36 — `const params = new URLSearchParams({ "api-version": getApiVersion() });`
Line 498 — `const params = new URLSearchParams({ "api-version": getApiVersion(), "expand": "children" });`

(Also update line 374's URL if it embeds `apiVersion`; grep `api-version` in the file and convert any `${apiVersion}` to `${getApiVersion()}`.)

- [ ] **Step 3: Typecheck + run existing tests**

Run: `npm run validate-tools && npm test test/src/tools/pipelines.test.ts test/src/tools/test-plan.test.ts`
Expected: PASS; no `apiVersion` import remains in either file.

- [ ] **Step 4: Commit**

```bash
git add src/tools/pipelines.ts src/tools/test-plans.ts
git commit -m "Use mode-aware api-version in pipelines and test plans"
```

---

## Task 8: Disable Advanced Security on-prem

**Files:**

- Modify: `src/shared/domains.ts` (constructor + `enableAllDomains` + `validateAndAddDomains`)
- Test: `test/src/domains.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `test/src/domains.test.ts`:

```ts
import { DomainsManager, Domain } from "../../src/shared/domains";

describe("on-prem domain gating", () => {
  it("excludes advanced-security when on-prem and 'all'", () => {
    const m = new DomainsManager("all", true);
    expect(m.isDomainEnabled(Domain.ADVANCED_SECURITY)).toBe(false);
    expect(m.isDomainEnabled(Domain.REPOSITORIES)).toBe(true);
  });
  it("keeps advanced-security for cloud 'all'", () => {
    const m = new DomainsManager("all", false);
    expect(m.isDomainEnabled(Domain.ADVANCED_SECURITY)).toBe(true);
  });
  it("drops an explicit advanced-security request on-prem", () => {
    const m = new DomainsManager("advanced-security", true);
    expect(m.isDomainEnabled(Domain.ADVANCED_SECURITY)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test test/src/domains.test.ts`
Expected: FAIL — constructor takes one argument; advanced-security still enabled.

- [ ] **Step 3: Implement the flag**

In `src/shared/domains.ts`:

Change the field + constructor:

```ts
  private readonly enabledDomains: Set<string>;
  private readonly isOnPrem: boolean;

  constructor(domainsInput?: string | string[], isOnPrem = false) {
    this.enabledDomains = new Set();
    this.isOnPrem = isOnPrem;
    this.parseDomains(domainsInput);
    if (isOnPrem) {
      this.enabledDomains.delete(Domain.ADVANCED_SECURITY);
    }
  }
```

The post-parse `delete` covers every path (`all`, explicit list, comma string), so no other method needs editing. Optionally log when dropping:

```ts
if (isOnPrem && this.enabledDomains.has(Domain.ADVANCED_SECURITY)) {
  logger.warn("Advanced Security is a cloud-only product; disabling the 'advanced-security' domain for on-premises.");
}
```

(Place this check before the `delete`. `logger` is already imported.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test test/src/domains.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/domains.ts test/src/domains.test.ts
git commit -m "Disable Advanced Security domain on-prem"
```

---

## Task 9: Wire it all in index.ts

**Files:**

- Modify: `src/index.ts` (imports; module-level resolution; `--api-version`; `main()`)

- [ ] **Step 1: Add imports**

After the existing imports, add:

```ts
import { resolveDeployment, resolveAuthentication, setDeployment } from "./shared/deployment.js";
```

- [ ] **Step 2: Add the `--api-version` option**

In the yargs chain (after the `tenant` option, before `.help()`), add:

```ts
  .option("api-version", {
    describe: "Override the REST API version (on-premises only). Defaults to 7.0 for Azure DevOps Server 2022.",
    type: "string",
  })
```

- [ ] **Step 3: Replace the static auth default + org/url/domains block**

Replace:

```ts
const defaultAuthenticationType = isGitHubCodespaceEnv() ? "azcli" : "interactive";
```

— delete this line (resolution now happens via `resolveAuthentication`). In the `authentication` option, change `default: defaultAuthenticationType,` to omit the default (remove the `default` line entirely).

Then replace:

```ts
export const orgName = argv.organization as string;
const orgUrl = "https://dev.azure.com/" + orgName;

const domainsManager = new DomainsManager(argv.domains);
export const enabledDomains = domainsManager.getEnabledDomains();
```

with:

```ts
const positional = argv.organization as string;
const deployment = resolveDeployment(positional, argv["api-version"] as string | undefined);
setDeployment(deployment);

export const orgName = deployment.isOnPrem ? deployment.orgIdentifier : positional;
const orgUrl = deployment.baseUrl;

const domainsManager = new DomainsManager(argv.domains, deployment.isOnPrem);
export const enabledDomains = domainsManager.getEnabledDomains();

const authType = resolveAuthentication(argv.authentication as string | undefined, deployment.isOnPrem, isGitHubCodespaceEnv());
```

- [ ] **Step 4: Use `authType` and skip tenant lookup in `main()`**

In `main()`:

- Replace every use of `argv.authentication` with `authType` (the `logger.info` field, the `createAuthenticator(...)` call, the `if (argv.authentication === "pat")` guard, and the `getAzureDevOpsClient(..., argv.authentication)` call).
- Replace the tenant line:

```ts
const tenantId = (await getOrgTenant(orgName)) ?? argv.tenant;
```

with:

```ts
const tenantId = deployment.isOnPrem ? undefined : ((await getOrgTenant(orgName)) ?? (argv.tenant as string | undefined));
```

- [ ] **Step 5: Build and smoke-test**

Run:

```bash
npm run build
node dist/index.js --help
node dist/index.js https://tfs.contoso.com/DefaultCollection --authentication interactive 2>&1 | head -5
```

Expected: `--help` shows `--api-version`. The second invocation exits with the on-prem PAT error from `resolveAuthentication` (proves the guard fires). A bare-name cloud invocation must still start as before.

- [ ] **Step 6: Full test suite + lint**

Run: `npm test && npm run eslint && npm run format-check`
Expected: all green, including pre-existing cloud tests (regression guard).

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "Wire deployment resolution and on-prem auth into startup"
```

---

## Task 10: Documentation

**Files:**

- Modify: `docs/FAQ.md` (the on-prem Q&A), `docs/GETTINGSTARTED.md` (on-prem invocation)

- [ ] **Step 1: Update the FAQ**

In `docs/FAQ.md`, replace the on-prem answer (currently: "This MCP Server supports only Azure DevOps Services...") with an accurate description:

```markdown
## Does the MCP Server support both Azure DevOps Services and on-premises deployments?

Azure DevOps Services (cloud) is fully supported. **Azure DevOps Server (on-premises) 2022 is supported** with the following setup and limitations:

- Pass the full collection URL instead of an organization name, e.g. `mcp-server-azuredevops https://tfs.contoso.com/DefaultCollection`.
- Authentication is **PAT only** — set `--authentication pat` (implied automatically for a URL) and the `PERSONAL_ACCESS_TOKEN` environment variable to a base64-encoded `:{PAT}` value. Microsoft Entra sign-in (`interactive`/`azcli`/`env`) is not available on-prem.
- The REST API version defaults to `7.0` (Azure DevOps Server 2022). Override with `--api-version 7.1` (Server 2022.1) or `6.0` (Server 2020).
- **Advanced Security** tools are disabled on-prem (cloud-only product).
- **Code Search** requires the Search extension installed on the target collection.
- **Markdown** work item comments fall back to the server default format on-prem.
- Windows Integrated Auth (NTLM/Kerberos) is not supported; a PAT is required.
```

- [ ] **Step 2: Add an on-prem example to GETTINGSTARTED.md**

Add a short "On-premises (Azure DevOps Server)" subsection showing the URL invocation and the `PERSONAL_ACCESS_TOKEN` env var, mirroring the existing PAT setup steps.

- [ ] **Step 3: Commit**

```bash
git add docs/FAQ.md docs/GETTINGSTARTED.md
git commit -m "Document on-prem support and limitations"
```

---

## Self-review notes

- **Spec coverage:** All 8 spec change-set items map to tasks — index/deployment (T1,T9), utils versions+helpers (T2), search (T3), identities (T4), domains (T8), boundary (T6), comments (T5). Pipelines/test-plans version swap (T7) added for correctness since they also pinned `7.2-preview.1`. Docs (T10) covers the spec's documentation section.
- **Type consistency:** `getApiVersion()`/`getCommentsApiVersion()`/`getSearchBaseUrl()`/`getIdentitiesBaseUrl()`/`getOrgIdentity()`/`resolveDeployment()`/`resolveAuthentication()`/`setDeployment()`/`getDeployment()` are named identically across all referencing tasks. `DeploymentConfig` fields (`isOnPrem`, `baseUrl`, `orgIdentifier`, `apiVersion`, `commentsApiVersion`) are consistent.
- **Refinement vs spec:** on-prem default API version is **7.0** (verified Server 2022 RTW), not 7.1 as the spec first assumed; comments on-prem use `7.1-preview.4` with the `format` param omitted.
- **Known caveat carried forward:** the modern comments resource is preview-only even on-prem; on Server 2022 RTW (7.0) the `7.1-preview.4` comment endpoint may not exist. Documented, not coded around (out of scope: System.History fallback).

```

```
