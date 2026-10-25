import { CertificateError, loadPkcs12 } from "@eet-gateway/core";
import { certificateStatus, EXPIRY_WARNING_DAYS } from "@eet-gateway/server";
import { parse } from "../args.ts";
import { type CliIO, EXIT, UsageError } from "../context.ts";
import { json } from "../output.ts";

export const CERT_HELP = `Použití: eet cert inspect <soubor.p12> [--password-file cesta] [--json]

Vypíše EIČ, vydavatele, prostředí (playground/produkce podle vydávající CA) a platnost
pokladního certifikátu. Heslo se z bezpečnostních důvodů nikdy nezadává jako argument:
  --password-file cesta   ze souboru
  EET_P12_PASSWORD        z proměnné prostředí
  jinak se zeptá terminál (vstup se nezobrazuje)

Exit: 0 platný, 3 vypršel nebo ještě neplatí, 1 soubor nebo heslo nesedí, 2 špatné použití.
`;

export async function cert(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parse(args, { "password-file": { type: "string" } });
  const [action, file, ...rest] = positionals;
  if (values.help || action === undefined) {
    io.stdout(CERT_HELP);
    return values.help ? EXIT.OK : EXIT.USAGE;
  }
  if (action !== "inspect") throw new UsageError(`neznámá akce "${action}" (inspect)`);
  if (file === undefined || rest.length > 0) throw new UsageError("uveď jeden soubor .p12");

  const p12 = await io.readFile(file);
  let password: string;
  const passwordFile = values["password-file"];
  if (passwordFile !== undefined) {
    password = new TextDecoder().decode(await io.readFile(passwordFile)).replace(/\r?\n$/, "");
  } else if (io.env["EET_P12_PASSWORD"] !== undefined) {
    password = io.env["EET_P12_PASSWORD"];
  } else if (io.interactive) {
    password = await io.promptHidden("Heslo k certifikátu: ");
  } else {
    throw new UsageError(
      "heslo: --password-file nebo EET_P12_PASSWORD (terminál není k dispozici)",
    );
  }

  let certificate: Awaited<ReturnType<typeof loadPkcs12>>;
  try {
    certificate = await loadPkcs12(p12, password);
  } catch (error) {
    if (!(error instanceof CertificateError)) throw error;
    io.stderr(`Certifikát nejde otevřít: ${error.message}\n`);
    return EXIT.FAILURE;
  }
  const now = io.now();
  const valid = certificate.info.notBefore <= now && now <= certificate.info.notAfter;
  const status = certificateStatus(certificate.info, now, valid);
  const report = { ...status, environment: certificate.environment, valid };
  delete (report as { active?: boolean }).active;

  if (values.json) {
    io.stdout(json(report));
  } else {
    const environment = {
      playground: "playground (neostré)",
      production: "produkce",
      unknown: "neznámé — certifikát nevydala CA EET",
    }[certificate.environment];
    const validity = status.expired
      ? "VYPRŠEL"
      : !valid
        ? "ještě neplatí"
        : `zbývá ${status.daysLeft} dní${status.expiresSoon ? ` — vyprší do ${EXPIRY_WARNING_DAYS} dní, obnov ho` : ""}`;
    io.stdout(
      [
        `EIČ:          ${status.eic}`,
        `Subjekt:      ${status.subject}`,
        `Vydavatel:    ${status.issuer}`,
        `Prostředí:    ${environment}`,
        `Sériové č.:   ${status.serialNumber}`,
        `Platnost:     ${status.notBefore} – ${status.notAfter} (${validity})`,
        `SHA-256:      ${status.fingerprintSha256}`,
        "",
      ].join("\n"),
    );
  }
  return valid ? EXIT.OK : EXIT.NOT_ALL_OK;
}
