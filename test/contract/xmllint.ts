import { repoPath } from "../../scripts/lib/sources.ts";

export const XSD_PATH = repoPath("spec/eet-v4.1/EETXMLSchema.xsd");

export interface XsdResult {
  readonly valid: boolean;
  readonly output: string;
}

/**
 * Validates an XML document against the vendored EET XSD with libxml2's `xmllint`.
 * Throws when `xmllint` is not installed: a contract test must fail loudly, never skip.
 */
export function validateAgainstXsd(xml: string): XsdResult {
  let result: { exitCode: number; stdout: Buffer; stderr: Buffer };
  try {
    result = Bun.spawnSync(["xmllint", "--noout", "--schema", XSD_PATH, "-"], {
      stdin: Buffer.from(xml, "utf8"),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    throw new Error(
      "xmllint not found — install libxml2 (macOS: preinstalled, Debian/Ubuntu: apt install libxml2-utils)",
      { cause: error },
    );
  }
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  return { valid: result.exitCode === 0, output };
}

/**
 * Extracts the `<Trzba>` element from a SOAP request. When its namespace prefix is declared on an
 * ancestor (as in the captured requests, on `<soapenv:Envelope>`), the declaration is added.
 */
export function extractTrzba(soap: string): string {
  const match = soap.match(/<(\w+):Trzba\b([^>]*)>[\s\S]*<\/\1:Trzba>/);
  if (match === null || match[1] === undefined) throw new Error("no <Trzba> element found");
  const [element, prefix, attributes = ""] = match;
  if (attributes.includes(`xmlns:${prefix}=`)) return element;
  return element.replace(
    `<${prefix}:Trzba`,
    `<${prefix}:Trzba xmlns:${prefix}="http://fs.gov.cz/eet/schema/v4"`,
  );
}
