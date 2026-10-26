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
  3. přiloží je k Release i se `SHA256SUMS`.
- **Verze je na jednom místě.** Drží ji `version.txt`. release-please ji zapíše i do konstant
  `VERSION` (řádky s `x-release-please-version`) a do `info.version` v `docs/openapi.json`.
  `package.json` balíčků zůstávají `0.0.0`.

**Co ještě chybí k publikaci:**

- **npm:**
  - je potřeba rozhodnout jméno a vlastnictví scope (SPEC_NOTES OQ7);
  - balíčky jsou zatím `private`;
  - potřeba je sestavení do JS s typy a publikační job.
- **Docker image do GHCR:** job je připravený. Zapne se proměnnou repozitáře
  `PUBLISH_DOCKER=true`.
- **Veřejné repo:** s licencí MIT dává smysl zveřejnit repo a zapnout soukromé hlášení
  zranitelností ([SECURITY](SECURITY.md)).
