# Roadmap

> **English:** a short summary is at the [end of this document](#english-summary). Everything
> here is a **plan, not a promise**: there are no dates and no commitments. Priorities follow
> what pilots and users report.

Tento dokument říká, co musí platit, aby šlo vydat verzi **1.0**, a co dalšího se zvažuje. Každá
položka je označena:

- **Plán**: chceme to udělat a víme proč, ale nemá to termín;
- **Rozhodnout**: je to otevřené rozhodnutí, výsledek zatím neznáme;
- **Nápad**: nic se neslibuje, rádi uslyšíme potřebu.

Verze 0.x platí podle [STABILITY](docs/STABILITY.md). Aktuální stav a omezení:
[README](README.md#stav-a-omezení).

## Kritéria pro 1.0

1.0 nevyjde jen proto, že uběhl čas. Navrhujeme tato kritéria (plán, ne závazek):

| #   | Kritérium                                                                                                                                                                                                                         | Stav       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | **Ověření na produkci.** Aspoň jedno skutečné odeslání na produkční endpoint EET se skutečným produkčním certifikátem, zapsané v [SPEC_NOTES §15](docs/SPEC_NOTES.md#15-živé-ověření-na-playgroundu) včetně výsledku kontrol níže | Plán       |
| 2   | **Externí bezpečnostní review** vlastní čtečky DER/X.509 a ověření podpisu odpovědi (ADR-002), nálezy vyřešené nebo zdůvodněně přijaté                                                                                            | Plán       |
| 3   | **Rozhodnutí o revokaci** (CRL/OCSP) zapsané v ADR-002 nebo v novém ADR                                                                                                                                                           | Rozhodnout |
| 4   | **Stabilní kontrakt.** Pravidla z [STABILITY](docs/STABILITY.md) dodržena po celou dobu 0.x bez nehlášené rozbíjející změny. CONTRIBUTING: do 1.0 platí semver 0.x, dokud GFŘ neprohlásí rozhraní za stabilní                     | Plán       |
| 5   | **Distribuce.** Rozhodnuté jméno a vlastnictví npm scope a první vydání na npm (SPEC_NOTES OQ7)                                                                                                                                   | Rozhodnout |

## Plánované položky

### Ověření na produkci (pilot)

Produkci jsme neověřili: produkční podpisový certifikát GFŘ neznáme a nevíme, jak produkce filtruje
spojení (SPEC_NOTES §3, §15; [ADR-002](docs/ADR-002-response-trust.md), kapitola Důsledky).
Seznam toho, co ověření musí pokrýt, je v SPEC_NOTES §15 v bloku „Produkce: neověřeno“ spolu se
šablonou hlášení.

**Hledáme pilotní uživatele** s vlastním produkčním certifikátem, kteří by brány vyzkoušeli v
reálném prostředí a vrátili výsledek. Ozvi se v GitHub Discussions repozitáře
`hospodskej-cz/eet-2-0`, případně založ issue; pilotní hlášení vyplníš podle šablony ze SPEC_NOTES §15.
Nikdy nezveřejňuj certifikáty, hesla ani data poplatníků ([SECURITY](SECURITY.md)).

### Bezpečnost

- **Externí review** (kritérium 2). Plán; reviewer zatím není vybrán.
- **CRL/OCSP** (kritérium 3). ADR-002 bod 4 revokaci zatím neověřuje, protože by šlo o síťovou
  závislost v cestě každé tržby; rozhodnutí se přehodnotí, pokud to bude požadovat zdroj nebo
  bezpečnostní posouzení. Rozhodnout.
- **Kontrola změn zdrojů.** Týdenní kontrola oficiálních dokumentů už běží (`bun run spec:drift`).
  Změna, kterou zachytí, může posunout tyto položky.

### Distribuce

- **npm** (kritérium 5): jméno a vlastnictví scope (SPEC_NOTES OQ7), sestavení do JS s typy a
  publikační job (CONTRIBUTING, „Co ještě chybí k publikaci“). Rozhodnout. Do té doby se instaluje
  přes Docker, binárku z vydání nebo z repozitáře.
- **Docker image v GHCR:** publikační job je připravený a zapíná se proměnnou repozitáře
  `PUBLISH_DOCKER=true` (CONTRIBUTING). Plán.
- **API klienty** pro PHP, Python, C# a Javu leží v [`clients/`](clients/README.md), hlídač
  `scripts/gen-clients.ts` je drží v souladu s `docs/openapi.json`. Publikují se do Packagistu,
  PyPI, NuGetu a Maven Central workflowem po tagu `clients-vX.Y.Z`.
- **Podepsaná binárka pro macOS:** dnes je nepodepsaná a Gatekeeper ji po stažení blokuje
  ([CLI](docs/CLI.md)). Nápad.

### Provoz

- **Úložiště Postgres** pro nasazení s více instancemi. Rozhraní `QueueStore`, sada
  `store-contract.ts` i návrh převzetí záznamů (`FOR UPDATE SKIP LOCKED`) existují (ADR-003 bod 12,
  [QUEUE](docs/QUEUE.md#úložiště)), implementace zatím ne. Nápad.
- **Sledování provozu.** Dnes máme strukturované JSON logy, události `onEvent`, `GET /v1/queue` a
  `GET /v1/registers` ([SERVER](docs/SERVER.md)). Samostatný endpoint s metrikami zatím není v
  žádném ADR ani otevřené otázce. Pokud ho potřebuješ, napiš, co chceš měřit. Nápad.

### Vstupy

- **Další vstupní formáty a aliasy polí** podle skutečných exportů pokladních systémů. Vlastní
  názvy polí už jde nastavit přes `fieldMap` ([INGEST](docs/INGEST.md)). Co přibude, určí to, co
  piloti pošlou. Nápad.

## Mimo plán

- **Obnova pokladního certifikátu přes REST API CA EET** je mimo rozsah (SPEC_NOTES §12,
  ADR-001); připraveno je jen více `.p12` na pokladnu během obnovy.
- **Právní nebo daňové poradenství.** Projekt je software, ne služba; viz
  [Disclaimer](README.md#disclaimer).

## English summary

All items are planned, not promised; there are no dates.

**Criteria for 1.0 (planned):**

1. Production verified with at least one real send using a real production certificate, written
   up in SPEC_NOTES §15.
2. An external security review of the custom DER/X.509 reader and the response-signature check.
3. A recorded decision on revocation checking (CRL/OCSP); today it is not checked locally.
4. The [STABILITY](docs/STABILITY.md) rules kept through 0.x; per CONTRIBUTING, semver 0.x applies until
   the Financial Administration declares the interface stable.
5. A decision on the npm scope name and ownership (SPEC_NOTES OQ7) and a first npm release.

**Also under consideration:** a GHCR Docker image (the job exists, behind `PUBLISH_DOCKER=true`),
keeping the PHP/Python/C#/Java clients in [`clients/`](clients/README.md) in sync with
OpenAPI, a Postgres queue store (the interface and contract tests exist, the implementation does
not), more input formats driven by real POS exports, a signed macOS binary.

**Pilot users wanted:** if you hold a real production EET certificate and would try the gateway,
get in touch through the repository's GitHub Discussions (or an issue) and report your result
using the checklist in SPEC_NOTES §15. Never post certificates, passwords or taxpayer data.
