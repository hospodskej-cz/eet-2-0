# Jak přispívat

> **English:** contributions are welcome. Issues and pull requests may be written in English or
> Czech. The rules below in short:
> - follow the official EET sources, not assumptions;
> - every change comes with tests;
> - use Conventional Commits;
> - never commit certificates, passwords or `eet.config.yaml`.

## Vývojové prostředí

- [Bun](https://bun.sh) ve verzi z `.bun-version`;
- `xmllint` (libxml2) pro kontraktní testy proti XSD;
- volitelně Node.js 22.18+ (`compat:node`) a Docker.

```sh
bun install
bun run certs:playground  # sdílené testovací certifikáty playgroundu do .cache/ (ověřené SHA-256)
bun run check             # biome + tsc + všechny offline testy
```

| Příkaz                                     | K čemu                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `bun run check`                            | Lint, typy, testy. Musí být zelené před každým commitem                             |
| `bun run format`                           | Biome formátování                                                                   |
| `bun run compat:node`                      | Sestaví core, ingest a queue a spustí je v Node (CI i v Deno)                       |
| `bun run test:live`                        | Živé testy proti playgroundu EET: 7 vymyšlených zpráv, **jen lokálně** z české sítě |
| `bun run gen:openapi`                      | Přegeneruje `docs/openapi.json` po změně API (test hlídá, že je aktuální)           |
| `UPDATE_GOLDEN=1 bun test packages/ingest` | Přegeneruje golden soubory ingestu; změny zkontroluj v diffu                        |
| `bun run spec:drift`                       | Porovná oficiální dokumenty na eet.gov.cz s otisky v `docs/sources`                 |
| `scripts/docker-smoke.sh`                  | Ověří Docker image                                                                  |
| `scripts/binary-smoke.sh`                  | Ověří binárku `eet`                                                                 |

Playground EET nepřijímá spojení z runnerů GitHub Actions, proto živé testy v CI neběží
(SPEC_NOTES §15). Kdo mění transport, frontu nebo podpis, spustí `bun run test:live` lokálně.

## Pravidla

- **Fakta jen z oficiálních zdrojů.** Pole, regexy, délky, chybové kódy a chování serveru se
  berou výhradně z dokumentace EET (rozhraní, metodika, XSD/WSDL). Každý fakt má v
  [`docs/SPEC_NOTES.md`](docs/SPEC_NOTES.md) odkaz na kapitolu zdroje. Když zdroj chybí, napiš
  otevřenou otázku do SPEC_NOTES §14, ne odhad do kódu.
- **Přístupové dokumenty PG a P jsou TLP:AMBER.** Smí se citovat a odkazovat, ale nikdy
  kopírovat do repozitáře.
- **Testy jsou součástí změny.** Chování fronty se testuje na úrovni rozhodovací tabulky,
  kontraktu úložiště a invariantů. Ingest má golden soubory. API se kontroluje proti
  publikovanému OpenAPI (žádná nezdokumentovaná pole).
- **Stabilní API.** Kódy varování a chyb (`docs/INGEST.md`, `docs/QUEUE.md`), tvar
  `SaleResult` a HTTP API v1 se nepřečíslují ani nemažou, jen přibývají. Rozbíjející změnu
  označ v commitu `!` nebo `BREAKING CHANGE:`.
- **Rozhodnutí do ADR.** Nové architektonické rozhodnutí patří do `docs/ADR-00x-*.md`.
- **Nic tajného do gitu.** `.p12`, `.pem`, hesla, `eet.config.yaml` ani databáze fronty se
  necommitují; `.gitignore` je odfiltruje. Testy si certifikáty stahují do `.cache/`.
- **Kód a komentáře anglicky, dokumentace česky** (README také anglicky).

## Commity a vydání

- Commity se píšou podle [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(queue): …`, `fix(core): …`, `docs: …`, `ci: …`, `test: …`, `chore: …`.
- Z nich [release-please](https://github.com/googleapis/release-please) (workflow `Release`)
  udržuje release PR se změnou verze a `CHANGELOG.md`.
- Číslování je semver 0.x: `feat` a rozbíjející změna zvedají minor, `fix` patch. Do 1.0 platí,
  dokud GFŘ neprohlásí rozhraní za stabilní.
- **Kontrola release PR.** PR otevírá `github-actions[bot]`, proto jeho CI čeká na schválení.
  V PR klikni na „Approve and run“ (nebo nech release-please běžet s tokenem GitHub App).
  Rozhodující kontrolou je stejně CI na `main` po sloučení a smoke test binárek ve vydání.
- **Vydání = sloučení release PR.** Workflow pak:
  1. vytvoří tag `vX.Y.Z` a GitHub Release;
  2. sestaví binárky `eet` pro linux-x64, linux-arm64, darwin-arm64 a windows-x64 a otestuje
     je na Linuxu, macOS a Windows;
  3. přiloží je k Release se `SHA256SUMS` a SBOM (`eet-gateway.cdx.json`, CycloneDX); ve
     veřejném repozitáři k nim přidá i atestaci původu (`gh attestation verify <soubor> --repo
     hospodskej-cz/eet-2-0`);
  4. sestaví a ověří balíčky pro npm (vždy) a publikuje je (jen s `PUBLISH_NPM=true`);
  5. nahraje a podepíše Docker image (jen s `PUBLISH_DOCKER=true`).
- **Verze je na jednom místě.** Drží ji `version.txt`. release-please ji zapíše i do konstant
  `VERSION` (řádky s `x-release-please-version`), do `info.version` v `docs/openapi.json` a do
  `version` v `package.json` každého balíčku. Všechny balíčky `@eet-gateway/*` mají vždy stejnou
  verzi jako binárky. Obraz balíčků kontroluje `bun run pack:packages`: skončí chybou, když se
  verze v některém `package.json` liší od `version.txt`.

## Publikace (npm, Docker, binárky)

Všechno je připravené v kódu a v `.github/workflows/release.yml`. Zapnout to musí vlastník
repozitáře, jednorázově, v tomto pořadí:

1. **Zveřejnit repozitář.** npm provenance, atestace a podpis image v Sigstore fungují jen pro
   veřejné repo. Do té doby se kroky atestace a podpisu samy přeskočí a npm publikace by
   selhala. Zapnout také soukromé hlášení zranitelností ([SECURITY](SECURITY.md)).
2. **npm.**
   1. Na npmjs.com založit organizaci `eet-gateway` (scope `@eet-gateway/*` je volný).
   2. Důvěryhodného vydavatele (bod 3) se na stránce balíčku nastavuje obvykle až poté, co
      balíček na npm existuje (ověř, zda to už jde i dřív, třeba příkazem `npm trust`).
      Pokud ne, publikuj první verzi ručně z čistého checkoutu tagu: `bun run pack:packages`,
      `bun run verify:packages` a `npm publish dist/npm/<tarball> --access public` v pořadí ze
      `dist/npm/publish-order.txt`. Tato první verze nemá provenance, další už ano.
   3. U každého z pěti balíčků (core, ingest, queue, server, cli) v _Settings → Trusted
      publisher_ přidat GitHub Actions: organizace `hospodskej-cz`, repozitář `eet-2-0`,
      workflow `release.yml`, bez prostředí.
   4. Nastavit proměnnou repozitáře `PUBLISH_NPM=true` (Settings → Secrets and variables →
      Actions → Variables). Žádný `NPM_TOKEN` se nevytváří: job publikuje přes OIDC a
      `--provenance` přiloží ověřitelný původ (`npm audit signatures`).
3. **Docker image do GHCR.** Nastavit proměnnou `PUBLISH_DOCKER=true`. Image
   `ghcr.io/hospodskej-cz/eet-2-0` je pro `linux/amd64` a `linux/arm64`, má SBOM a provenance
   (BuildKit) a je podepsaný bez klíče přes cosign. Po prvním nahrání nastavit balíček v GHCR
   jako veřejný a propojit s repozitářem. Ověření:

   ```sh
   cosign verify ghcr.io/hospodskej-cz/eet-2-0:X.Y.Z \
     --certificate-identity-regexp '^https://github.com/hospodskej-cz/eet-2-0/\.github/workflows/release\.yml@' \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com
   ```

### Balíčky pro npm

- Zdroje i testy se dál berou z `src/` (cesty `@eet-gateway/*` mapuje `tsconfig.base.json`),
  `exports` v `package.json` ale míří na `dist/`, což je to, co dostane uživatel.
- `bun run build` přeloží všechny balíčky do `packages/*/dist` (ESM JavaScript + `.d.ts`,
  `bun run build:core` apod. jen jeden a jeho závislosti).
- `bun run pack:packages` je navíc zabalí do `dist/npm/*.tgz`. Do tarballu jde `dist/`,
  `LICENSE`, `README.md` a `package.json`, kde se `workspace:*` změní na `^verze`. Samotné
  `package.json` v repozitáři `workspace:*` ponechávají a **nikdy se nepublikují přímo**
  (`npm publish` v adresáři balíčku by `workspace:*` poslal na registr).
- `bun run verify:packages` tarbally zkontroluje (žádné `workspace:`, shoda verze, existence
  všech cílů v `exports`/`bin`, žádné zdrojáky ani tajnosti), nainstaluje je do prázdného
  projektu, spustí kompatibilní smoke testy core, ingest a queue v Node proti nainstalovaným
  balíčkům, `eet --version` v Bunu a přeloží TypeScript klienta proti `.d.ts`.
- `core`, `ingest` a `queue` jsou bez Bun API. `server` má kořenový export (aplikace Hono)
  použitelný i v Node, ale `@eet-gateway/server/serve` a `@eet-gateway/cli` vyžadují Bun
  (`bun:sqlite`, `Bun.serve`); pro ostatní prostředí jsou tu binárky a Docker.
- Interní závislosti jsou `^verze` a zámek `bun.lock` eviduje `version` pracovních balíčků.
  release-please zámek nemění, takže po vydání může `bun install` (bez `--frozen-lockfile`)
  v `bun.lock` přepsat pole `version`. Stačí to commitnout.
