/**
 * Registers of a running server: certificates loaded from `.p12` files (passwords from a file or
 * the environment, never from the configuration), one transport per certificate, and the choice
 * of the certificate valid at the moment of each attempt (rozhraní §3.3, SPEC_NOTES §12).
 */
import { readFile } from "node:fs/promises";
import {
  type CertificateInfo,
  createEetTransport,
  type EetEnvironment,
  type EetTransport,
  loadPkcs12,
  type RegisterCertificate,
} from "@eet-gateway/core";
import type { IngestContext } from "@eet-gateway/ingest";
import { z } from "zod";
import { ConfigError, type ConfigIssue, type RegisterConfigEntry } from "./config.ts";

/** Warn this many days before a certificate expires (zadání: 21 dní). */
export const EXPIRY_WARNING_DAYS = 21;
const DAY_MS = 86_400_000;

export interface LoadedCertificate {
  readonly info: CertificateInfo;
  readonly transport: EetTransport;
}

export interface LoadedRegister {
  readonly id: string;
  readonly environment: EetEnvironment;
  readonly endpoint: string;
  readonly certificates: readonly LoadedCertificate[];
  /** Signs with the certificate valid at the time of each send. */
  readonly transport: EetTransport;
  /** Ingest settings: defaults (`eic_popl` from the certificate), time zone, field map. */
  readonly context: Omit<IngestContext, "now">;
}

export interface LoadRegistersOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
  /** For tests; defaults to `fetch`. */
  readonly fetch?: typeof fetch;
}

/** Loads every register, collecting all problems into one `ConfigError`. */
export async function loadRegisters(
  entries: readonly RegisterConfigEntry[],
  options: LoadRegistersOptions = {},
): Promise<LoadedRegister[]> {
  const env = options.env ?? {};
  const now = options.now ?? (() => new Date());
  const issues: ConfigIssue[] = [];
  const registers: LoadedRegister[] = [];

  for (const entry of entries) {
    const certificates: LoadedCertificate[] = [];
    for (const [index, config] of entry.certificates.entries()) {
      const at = `registers.${entry.id}.certificates.${index}`;
      let certificate: RegisterCertificate;
      try {
        const password = await readPassword(config.passwordFile, env[config.passwordEnv]);
        if (password === undefined) {
          issues.push({
            path: at,
            message: `chybí heslo: passwordFile nebo ${config.passwordEnv}`,
          });
          continue;
        }
        certificate = await loadPkcs12(new Uint8Array(await readFile(config.p12)), password);
      } catch (error) {
        issues.push({ path: at, message: describe(error) });
        continue;
      }
      if (certificate.environment !== entry.environment) {
        issues.push({
          path: at,
          message:
            certificate.environment === "unknown"
              ? "certifikát nevydala CA EET"
              : `certifikát je pro ${certificate.environment}, pokladna pro ${entry.environment}`,
        });
        continue;
      }
      try {
        const transport = createEetTransport({
          environment: entry.environment,
          endpoint: entry.endpoint,
          certificate,
          timeoutMs: entry.timeoutMs,
          debug: entry.debug,
          ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
        });
        certificates.push({ info: certificate.info, transport });
      } catch (error) {
        issues.push({ path: at, message: describe(error) });
      }
    }
    if (certificates.length === 0) continue;
    const active = certificates[activeCertificate(certificates, now()) ?? 0] as LoadedCertificate;
    registers.push({
      id: entry.id,
      environment: entry.environment,
      endpoint: entry.endpoint,
      certificates,
      transport: selectingTransport(entry, certificates, now),
      context: {
        register: { eic_popl: active.info.eic, ...entry.defaults },
        certificateEic: active.info.eic,
        timeZone: entry.timeZone,
        fieldMap: entry.fieldMap,
      },
    });
  }
  if (issues.length > 0) throw new ConfigError(issues);
  return registers;
}

/** Index of the certificate valid at `now`; with several, the most recently issued one. */
export function activeCertificate(
  certificates: readonly { readonly info: CertificateInfo }[],
  now: Date,
): number | undefined {
  let best: number | undefined;
  certificates.forEach(({ info }, index) => {
    if (info.notBefore > now || info.notAfter < now) return;
    const current = best === undefined ? undefined : certificates[best]?.info;
    if (current === undefined || info.notBefore > current.notBefore) best = index;
  });
  return best;
}

function selectingTransport(
  entry: RegisterConfigEntry,
  certificates: readonly LoadedCertificate[],
  now: () => Date,
): EetTransport {
  return {
    environment: entry.environment,
    endpoint: entry.endpoint,
    async send(request, options) {
      const index = activeCertificate(certificates, now());
      const chosen = index === undefined ? undefined : certificates[index];
      if (chosen === undefined) {
        return {
          kind: "not_sent",
          reason: "signer",
          message: `Pokladna ${entry.id} nemá v tuto chvíli platný certifikát.`,
          meta: { durationMs: 0 },
        };
      }
      return chosen.transport.send(request, options);
    },
  };
}

export const CertificateStatusSchema = z.object({
  eic: z.string(),
  subject: z.string(),
  issuer: z.string(),
  serialNumber: z.string(),
  fingerprintSha256: z.string(),
  notBefore: z.string(),
  notAfter: z.string(),
  daysLeft: z.number().int().describe("Whole days until notAfter; negative once expired."),
  active: z.boolean().describe("Used for sending right now."),
  expiresSoon: z.boolean().describe(`Valid, but expires within ${EXPIRY_WARNING_DAYS} days.`),
  expired: z.boolean(),
});

export const RegisterStatusSchema = z.object({
  id: z.string(),
  environment: z.enum(["playground", "production"]),
  endpoint: z.string(),
  defaults: z.object({
    eic_popl: z.string().optional(),
    id_jednotky: z.string().optional(),
    id_pokl: z.string().optional(),
  }),
  timeZone: z.string(),
  certificates: z.array(CertificateStatusSchema),
});

export type CertificateStatus = z.infer<typeof CertificateStatusSchema>;
export type RegisterStatus = z.infer<typeof RegisterStatusSchema>;

export function registerStatus(register: LoadedRegister, now: Date): RegisterStatus {
  const active = activeCertificate(register.certificates, now);
  const defaults = register.context.register ?? {};
  return {
    id: register.id,
    environment: register.environment,
    endpoint: register.endpoint,
    defaults: Object.fromEntries(
      Object.entries(defaults)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ),
    timeZone: register.context.timeZone ?? "",
    certificates: register.certificates.map(({ info }, index) => {
      const daysLeft = Math.floor((info.notAfter.getTime() - now.getTime()) / DAY_MS);
      const expired = info.notAfter < now;
      return {
        eic: info.eic,
        subject: info.subjectCommonName,
        issuer: info.issuerCommonName,
        serialNumber: info.serialNumber,
        fingerprintSha256: info.fingerprintSha256,
        notBefore: info.notBefore.toISOString(),
        notAfter: info.notAfter.toISOString(),
        daysLeft,
        active: index === active,
        expiresSoon: !expired && daysLeft < EXPIRY_WARNING_DAYS,
        expired,
      };
    }),
  };
}

export interface ExpiryNotice {
  readonly level: "warn" | "error";
  readonly register: string;
  readonly message: string;
}

/** What to log about certificate validity: expiring soon (warn), expired or none valid (error). */
export function expiryNotices(registers: readonly LoadedRegister[], now: Date): ExpiryNotice[] {
  const notices: ExpiryNotice[] = [];
  for (const register of registers) {
    const status = registerStatus(register, now);
    for (const certificate of status.certificates) {
      if (certificate.expired) {
        notices.push({
          level: "error",
          register: register.id,
          message: `Certifikát ${certificate.serialNumber} (${certificate.eic}) vypršel ${certificate.notAfter}.`,
        });
      } else if (certificate.expiresSoon) {
        notices.push({
          level: "warn",
          register: register.id,
          message: `Certifikát ${certificate.serialNumber} (${certificate.eic}) vyprší za ${certificate.daysLeft} dní (${certificate.notAfter}).`,
        });
      }
    }
    if (!status.certificates.some((c) => c.active)) {
      notices.push({
        level: "error",
        register: register.id,
        message: "Pokladna nemá platný certifikát; tržby čekají ve frontě.",
      });
    }
  }
  return notices;
}

async function readPassword(file: string | undefined, fromEnv: string | undefined) {
  if (file !== undefined) return (await readFile(file, "utf8")).replace(/\r?\n$/, "");
  return fromEnv;
}

/** Error text for the configuration report; core errors never contain passwords or keys. */
function describe(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT") return `soubor nenalezen: ${(error as { path?: string }).path ?? ""}`;
  if (code === "EACCES") return `soubor nejde číst: ${(error as { path?: string }).path ?? ""}`;
  return error instanceof Error ? error.message : String(error);
}
