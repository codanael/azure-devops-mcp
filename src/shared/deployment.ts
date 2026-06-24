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
