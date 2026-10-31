/** Constants taken verbatim from the official interface definition; cross-checked against the
 * vendored XSD/WSDL by test/contract/sources.test.ts. */

export const VERSION = "0.3.0"; // x-release-please-version

/** Interface version implemented (XSD/WSDL `version`, rozhraní v1.2 §1.1). */
export const EET_INTERFACE_VERSION = "4.1";

/** Target namespace of `EETXMLSchema.xsd` (rozhraní v1.2 §3.1). */
export const EET_NAMESPACE = "http://fs.gov.cz/eet/schema/v4";

/** `soapAction` of the `OdeslaniTrzby` operation in `EETServiceSOAP.wsdl`. */
export const EET_SOAP_ACTION = "http://fs.gov.cz/eet/OdeslaniTrzby";

/**
 * Non-production (playground) endpoint (PG přístupové informace v1.1 §2.1). The production
 * endpoint is deliberately not a constant: it always comes from configuration.
 */
export const EET_PLAYGROUND_ENDPOINT = "https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4";

/**
 * Maximum size of the signed SOAP envelope in bytes (rozhraní v1.2 §2.2.3, item 5). The spec
 * says "12 kB" without defining the unit; 12 000 is the conservative reading.
 */
export const EET_MAX_MESSAGE_BYTES = 12_000;
