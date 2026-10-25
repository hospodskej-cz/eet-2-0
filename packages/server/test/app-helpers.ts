import { expect } from "bun:test";
import { createEetQueue, createMemoryStore, type EetQueueOptions } from "@eet-gateway/queue";
import Ajv2020 from "ajv/dist/2020.js";
import {
  DEFAULTS,
  ENDPOINT,
  type ScriptedTransport,
  scripted,
  T0,
} from "../../queue/test/helpers.ts";
import { type AppOptions, createApp } from "../src/app.ts";
import { type ComponentName, componentSchema } from "../src/openapi.ts";
import type { RegisterStatus } from "../src/registers.ts";
import { API_KEY } from "./helpers.ts";

export { DEFAULTS, ENDPOINT, T0 };

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validators = new Map<ComponentName, ReturnType<typeof ajv.compile>>();

/** Asserts that a body matches the published OpenAPI component (no undocumented fields). */
export function expectSchema(name: ComponentName, body: unknown) {
  let validate = validators.get(name);
  if (validate === undefined) {
    validate = ajv.compile(componentSchema(name));
    validators.set(name, validate);
  }
  const ok = validate(body);
  if (!ok) throw new Error(`${name}: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(body)}`);
  expect(ok).toBe(true);
}

export const REGISTER_STATUS: RegisterStatus = {
  id: "main",
  environment: "playground",
  endpoint: ENDPOINT,
  defaults: { eic_popl: "CZ00000019", id_jednotky: "11", id_pokl: "P1" },
  timeZone: "Europe/Prague",
  certificates: [
    {
      eic: "CZ00000019",
      subject: "CZ00000019",
      issuer: "EET CA 1 Playground",
      serialNumber: "01",
      fingerprintSha256: "ab",
      notBefore: "2026-05-13T09:40:23.000Z",
      notAfter: "2027-05-14T09:40:23.000Z",
      daysLeft: 200,
      active: true,
      expiresSoon: false,
      expired: false,
    },
  ],
};

export function setupApp(
  overrides: Partial<AppOptions> & {
    transport?: ScriptedTransport;
    queueOptions?: Partial<EetQueueOptions>;
  } = {},
) {
  const clock = { value: T0 };
  const transport = overrides.transport ?? scripted();
  const store = createMemoryStore();
  const queue = createEetQueue({
    store,
    registers: { main: { transport, context: { register: DEFAULTS } } },
    now: () => clock.value,
    random: () => 0.5,
    ...overrides.queueOptions,
  });
  const app = createApp({
    queue,
    apiKeys: [API_KEY],
    registers: () => [REGISTER_STATUS],
    endpoints: [ENDPOINT],
    now: () => clock.value,
    ...overrides,
  });
  const call = (path: string, init: RequestInit & { key?: string | null } = {}) => {
    const headers = new Headers(init.headers);
    if (init.key !== null) headers.set("authorization", `Bearer ${init.key ?? API_KEY}`);
    return app.request(path, { ...init, headers });
  };
  const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    call(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    });
  return { app, queue, transport, store, clock, call, json };
}
