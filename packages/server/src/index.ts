/**
 * @eet-gateway/server — HTTP API v1 with an OpenAPI 3.1 description. `createApp` is a
 * runtime-neutral Hono app; the Bun service with configuration, SQLite and graceful shutdown is
 * `@eet-gateway/server/serve`. Contract: docs/SERVER.md, docs/openapi.json.
 */

export { type AppOptions, createApp, type RequestLog } from "./app.ts";
export {
  type CertificateConfig,
  ConfigError,
  type ConfigIssue,
  type ParseConfigOptions,
  parseConfig,
  type RegisterConfigEntry,
  registerEnvId,
  type ServerConfig,
} from "./config.ts";
export { createLogger, type LogFields, type Logger, type LogLevel, logQueueEvent } from "./log.ts";
export { buildOpenApi, ROUTES, type RouteDoc } from "./openapi.ts";
export {
  activeCertificate,
  type CertificateStatus,
  CertificateStatusSchema,
  certificateStatus,
  EXPIRY_WARNING_DAYS,
  type ExpiryNotice,
  expiryNotices,
  type LoadedCertificate,
  type LoadedRegister,
  type LoadRegistersOptions,
  loadRegisters,
  type RegisterStatus,
  RegisterStatusSchema,
  registerStatus,
} from "./registers.ts";
export {
  AttemptListSchema,
  AttemptSchema,
  BatchResultSchema,
  ErrorSchema,
  HealthSchema,
  QueuePageSchema,
  RegisterListSchema,
  ValidationBatchSchema,
} from "./schemas.ts";

export const VERSION = "0.1.0"; // x-release-please-version
