/**
 * Minimal, dependency-free XML reader for EET-shaped input: standalone `<Data/>` elements, whole
 * `<Trzba>` elements, or any wrapper containing several of them. Only start/end tags and their
 * attributes matter (EET data lives in attributes). DOCTYPE and custom entities are rejected —
 * the classic XXE/billion-laughs vectors — while comments, processing instructions and CDATA are
 * skipped. Namespace prefixes are ignored.
 */
import { type IngestIssue, issue } from "../codes.ts";

export interface XmlTag {
  readonly kind: "start" | "end";
  /** Local name without prefix. */
  readonly name: string;
  /** Attributes by local name; `xmlns` declarations are left out. */
  readonly attributes: Record<string, string>;
  readonly selfClosing: boolean;
  readonly line: number;
}

class XmlSyntaxError extends Error {}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(value: string, line: number): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (_, ref: string) => {
    if (ref.startsWith("#x")) return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    if (ref.startsWith("#")) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
    const resolved = ENTITIES[ref];
    if (resolved === undefined) throw new XmlSyntaxError(`neznámá entita &${ref}; (řádek ${line})`);
    return resolved;
  });
}

const localName = (qname: string) => qname.slice(qname.indexOf(":") + 1);

function tokenize(text: string): XmlTag[] {
  const tags: XmlTag[] = [];
  let i = 0;
  let line = 1;
  const advanceTo = (end: number) => {
    for (let k = i; k < end; k++) if (text[k] === "\n") line++;
    i = end;
  };
  const skipPast = (marker: string, what: string) => {
    const end = text.indexOf(marker, i);
    if (end < 0) throw new XmlSyntaxError(`neukončen${what} (řádek ${line})`);
    advanceTo(end + marker.length);
  };

  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) break;
    advanceTo(lt);
    if (text.startsWith("<!--", i)) skipPast("-->", "ý komentář");
    else if (text.startsWith("<![CDATA[", i)) skipPast("]]>", "á sekce CDATA");
    else if (text.startsWith("<?", i)) skipPast("?>", "á instrukce");
    else if (text.startsWith("<!", i))
      throw new XmlSyntaxError(`DOCTYPE/ENTITY není povoleno (řádek ${line})`);
    else {
      const tagLine = line;
      const m =
        /^<(\/?)([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(
          text.slice(i, i + 65_536),
        );
      if (m === null) throw new XmlSyntaxError(`neplatná značka (řádek ${tagLine})`);
      const [whole, slash, qname = "", rawAttributes = "", selfClose] = m;
      const attributes: Record<string, string> = {};
      for (const a of rawAttributes.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const name = a[1] ?? "";
        if (name === "xmlns" || name.startsWith("xmlns:")) continue;
        attributes[localName(name)] = decodeEntities(a[2] ?? a[3] ?? "", tagLine);
      }
      tags.push({
        kind: slash === "/" ? "end" : "start",
        name: localName(qname),
        attributes,
        selfClosing: selfClose === "/",
        line: tagLine,
      });
      advanceTo(i + whole.length);
    }
  }
  return tags;
}

export interface XmlSale {
  /** Line of the `<Trzba>` or standalone `<Data>` element. */
  readonly line: number;
  readonly data?: Record<string, string>;
  readonly header?: Record<string, string>;
}

/** Extracts every `<Trzba>` (with its `<Hlavicka>`) and every standalone `<Data>`. */
export function readXmlSales(text: string): XmlSale[] | IngestIssue {
  let tags: XmlTag[];
  try {
    tags = tokenize(text);
  } catch (error) {
    if (error instanceof XmlSyntaxError) {
      const code = error.message.startsWith("DOCTYPE") ? "unsupported_format" : "parse_error";
      return issue(code, `XML: ${error.message}.`);
    }
    throw error;
  }
  const sales: XmlSale[] = [];
  let current:
    | { line: number; data?: Record<string, string>; header?: Record<string, string> }
    | undefined;
  for (const tag of tags) {
    if (tag.kind === "start" && tag.name === "Trzba") {
      current = { line: tag.line };
      if (tag.selfClosing) {
        sales.push(current);
        current = undefined;
      }
    } else if (tag.kind === "end" && tag.name === "Trzba" && current !== undefined) {
      sales.push(current);
      current = undefined;
    } else if (tag.kind === "start" && tag.name === "Hlavicka" && current !== undefined) {
      current.header = tag.attributes;
    } else if (tag.kind === "start" && tag.name === "Data") {
      if (current !== undefined) current.data = tag.attributes;
      else sales.push({ line: tag.line, data: tag.attributes });
    }
  }
  if (current !== undefined)
    return issue("parse_error", `XML: neukončený element Trzba (řádek ${current.line}).`);
  return sales;
}
