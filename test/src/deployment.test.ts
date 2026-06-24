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
