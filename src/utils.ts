// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getDeployment } from "./shared/deployment.js";

/** @deprecated migrating to getApiVersion(); kept until all call sites are migrated. */
export const apiVersion = "7.2-preview.1";
/** The $batch envelope version is stable across cloud and on-prem. */
export const batchApiVersion = "5.0";
/** @deprecated migrating to getCommentsApiVersion(); kept until all call sites are migrated. */
export const markdownCommentsApiVersion = "7.2-preview.4";

export function createEnumMapping<T extends Record<string, string | number>>(enumObject: T): Record<string, T[keyof T]> {
  const mapping: Record<string, T[keyof T]> = {};
  for (const [key, value] of Object.entries(enumObject)) {
    if (typeof key === "string" && typeof value === "number") {
      mapping[key.toLowerCase()] = value as T[keyof T];
    }
  }
  return mapping;
}

export function mapStringToEnum<T extends Record<string, string | number>>(value: string | undefined, enumObject: T, defaultValue?: T[keyof T]): T[keyof T] | undefined {
  if (!value) return defaultValue;
  const enumMapping = createEnumMapping(enumObject);
  return enumMapping[value.toLowerCase()] ?? defaultValue;
}

/**
 * Maps an array of strings to an array of enum values, filtering out invalid values.
 * @param values Array of string values to map
 * @param enumObject The enum object to map to
 * @returns Array of valid enum values
 */
export function mapStringArrayToEnum<T extends Record<string, string | number>>(values: string[] | undefined, enumObject: T): T[keyof T][] {
  if (!values) return [];
  return values.map((value) => mapStringToEnum(value, enumObject)).filter((v): v is T[keyof T] => v !== undefined);
}

/**
 * Converts a TypeScript numeric enum to an array of string keys for use with z.enum().
 * This ensures that enum schemas generate string values rather than numeric values.
 * @param enumObject The TypeScript enum object
 * @returns Array of string keys from the enum
 */
export function getEnumKeys<T extends Record<string, string | number>>(enumObject: T): string[] {
  return Object.keys(enumObject).filter((key) => isNaN(Number(key)));
}

/**
 * Safely converts a string enum key to its corresponding enum value.
 * Validates that the key exists in the enum before conversion.
 * @param enumObject The TypeScript enum object
 * @param key The string key to convert
 * @returns The enum value if key is valid, undefined otherwise
 */
export function safeEnumConvert<T extends Record<string, string | number>>(enumObject: T, key: string | undefined): T[keyof T] | undefined {
  if (!key) return undefined;

  const validKeys = getEnumKeys(enumObject);
  if (!validKeys.includes(key)) {
    return undefined;
  }

  return enumObject[key as keyof T];
}

/**
 * Encodes `>` and `<` for Markdown formatted fields.
 *
 * @param value The text value to encode
 * @param format The format of the field ('Markdown' or 'Html')
 * @returns The encoded text, or original text if format is not Markdown
 */
export function encodeFormattedValue(value: string, format?: "Markdown" | "Html"): string {
  if (!value || format !== "Markdown") return value;
  const result = value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return result;
}

/**
 * Detects whether a string returned from an ADO API stream is actually an error
 * response serialized as JSON (e.g. a 404 GitItemNotFoundException or
 * WikiPageNotFoundException) rather than real content.
 *
 * The ADO Node API client swallows non-2xx HTTP responses and delivers the
 * error body as a stream, so callers must check explicitly after reading.
 *
 * @returns The human-readable error message extracted from the JSON, or null if
 *          the content is not an ADO error response.
 */
export function extractAdoStreamError(content: string): string | null {
  try {
    const json = JSON.parse(content.trim());
    if (json && typeof json.typeName === "string" && typeof json.message === "string") {
      return json.message;
    }
  } catch {
    // Not JSON — not an ADO error response.
  }
  return null;
}

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

/**
 * Extracts the Azure DevOps organization identifier from a URL.
 *
 * Only recognized Azure DevOps hosts are accepted; any other host returns null
 * so that callers can treat unrecognized URLs as a boundary violation.
 *
 * Supports both modern and legacy organization URL forms:
 *  - https://dev.azure.com/{org}/...            -> org is the first path segment
 *  - https://{org}.visualstudio.com/...         -> org is the host subdomain
 *
 * @param url Any Azure DevOps URL (e.g. a wiki page link or a connection serverUrl).
 * @returns The lowercased organization name, or null if it cannot be determined.
 */
export function getOrgFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "visualstudio.com" || host.endsWith(".visualstudio.com")) {
      const subdomain = host.split(".")[0];
      return subdomain && subdomain !== "visualstudio" ? subdomain : null;
    }
    if (host === "dev.azure.com" || host.endsWith(".dev.azure.com")) {
      const firstSegment = u.pathname.split("/").filter(Boolean)[0];
      return firstSegment ? firstSegment.toLowerCase() : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Convert a Node.js ReadableStream to a string.
 * Shared utility for consistent stream handling across tools.
 */
export function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      data += chunk;
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(data));
  });
}
