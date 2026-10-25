import { describe, expect, test } from "bun:test";
import {
  EET_INTERFACE_VERSION,
  EET_NAMESPACE,
  EET_PLAYGROUND_ENDPOINT,
  EET_SOAP_ACTION,
} from "@eet-gateway/core";
import { loadSources, REPO_ROOT, repoPath, sha256Hex } from "../../scripts/lib/sources.ts";

const manifest = await loadSources();

describe("docs/sources/sources.json", () => {
  for (const source of manifest.sources.filter((s) => s.vendored !== null)) {
    test(`vendored ${source.vendored} is byte-identical to the official ${source.file}`, async () => {
      const file = Bun.file(repoPath(source.vendored ?? ""));
      expect(sha256Hex(await file.arrayBuffer())).toBe(source.sha256);
      expect(file.size).toBe(source.bytes ?? -1);
    });
  }

  test("TLP:AMBER documents are referenced, never vendored", async () => {
    const amber = manifest.sources.filter((s) => s.tlp === "AMBER");
    expect(amber.length).toBeGreaterThan(0);
    const amberFiles = new Set(amber.map((s) => s.file));
    const glob = new Bun.Glob("**/*.pdf");
    const found: string[] = [];
    for await (const path of glob.scan({ cwd: REPO_ROOT, dot: true })) {
      if (path.includes("node_modules/")) continue;
      if (amberFiles.has(path.split("/").at(-1) ?? "")) found.push(path);
    }
    expect(amber.every((s) => s.vendored === null)).toBe(true);
    expect(found).toEqual([]);
  });
});

describe("@eet-gateway/core constants match the vendored XSD/WSDL", () => {
  test("namespace and interface version (XSD)", async () => {
    const xsd = await Bun.file(repoPath("spec/eet-v4.1/EETXMLSchema.xsd")).text();
    expect(xsd).toContain(`targetNamespace="${EET_NAMESPACE}"`);
    expect(xsd).toMatch(new RegExp(`<xs:schema[^>]*version="${EET_INTERFACE_VERSION}"`));
  });

  test("SOAPAction and playground address (WSDL)", async () => {
    const wsdl = await Bun.file(repoPath("spec/eet-v4.1/EETServiceSOAP.wsdl")).text();
    expect(wsdl).toContain(`soapAction="${EET_SOAP_ACTION}"`);
    const location = wsdl.match(/<soap:address location="([^"]+)"/)?.[1];
    expect(location).toBeDefined();
    // The WSDL spells out the default HTTPS port; the URL is the same.
    expect(new URL(location ?? "").href).toBe(new URL(EET_PLAYGROUND_ENDPOINT).href);
  });
});
