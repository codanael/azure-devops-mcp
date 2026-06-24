// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getSearchBaseUrl, getApiVersion } from "../../../src/utils";
import { setDeployment, resolveDeployment } from "../../../src/shared/deployment";

describe("search URL construction", () => {
  afterEach(() => setDeployment(resolveDeployment("contoso"))); // reset singleton to cloud

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
