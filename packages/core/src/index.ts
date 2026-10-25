/**
 * @eet-gateway/core — protocol layer for EET 2.0 (Czech electronic registration of sales).
 *
 * Load a CA EET certificate with `loadPkcs12`, create a transport with `createEetTransport` and
 * send one data message per `send()` call; see docs/ADR-001-protocol-core.md and
 * docs/ADR-002-response-trust.md. Types of the underlying protocol library are not exported.
 */

export { base64ToBytes, bytesToHex, certificateToDer, sha256Hex } from "./bytes.ts";
export {
  CertificateError,
  type CertificateInfo,
  detectEnvironment,
  type EetEnvironment,
  loadPkcs12,
  type RegisterCertificate,
  type Signer,
  trustAnchor,
} from "./certificate.ts";
export { type CheckEndpointOptions, checkEndpoint, type EndpointCheck } from "./check-endpoint.ts";
export * from "./constants.ts";
export {
  type CreateHeaderOptions,
  createHeader,
  DEFAULT_TIME_ZONE,
  formatEetDateTime,
} from "./datetime.ts";
export { DerError } from "./der.ts";
export {
  type CreateEetTransportOptions,
  createEetTransport,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  redactSignatureValues,
  TransportConfigError,
} from "./finito-transport.ts";
export {
  createResponseVerifier,
  GFR_ORGANIZATION_IDENTIFIER,
  playgroundResponseTrust,
  productionResponseTrust,
  type ResponseSignatureInput,
  type ResponseTrust,
  type ResponseVerifierOptions,
  responseTrustFrom,
} from "./response-trust.ts";
export {
  EET_PATTERNS,
  type EetHeader,
  EetHeaderSchema,
  type EetReceiptData,
  EetReceiptDataSchema,
  isEetDateTime,
} from "./schema.ts";
export type {
  EetTransport,
  EetWarning,
  NotSentReason,
  SendOptions,
  TransportMeta,
  TransportOutcome,
  TransportRequest,
  UncertainReason,
} from "./transport.ts";
export { TRUST_ANCHORS, type TrustAnchorName } from "./trust-anchors.ts";
export {
  type Certificate,
  certificateFingerprint,
  type DistinguishedName,
  importRsaPublicKey,
  isIssuedBy,
  isValidAt,
  parseCertificate,
} from "./x509.ts";
