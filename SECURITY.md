# Bezpečnost

> **English:** please report vulnerabilities privately through GitHub's **Report a
> vulnerability** button on the repository's Security tab (private vulnerability reporting is
> enabled). Do not open a public issue.
>
> - Supported: the latest 0.x release.
> - Response times are best effort, without an SLA (see below).
> - Known limitations and audit status: [see below](#známá-omezení-a-stav-auditu).

## Hlášení zranitelností

Zranitelnost nahlas **soukromě** přes záložku Security → **Report a vulnerability** (soukromé
hlášení zranitelností je v repozitáři zapnuté). Veřejné issue nezakládej.

- Do hlášení patří popis, dotčená verze a postup k reprodukci.
- **Nikdy nepřikládej skutečné certifikáty, hesla, API klíče ani data poplatníků.** Na
  reprodukci stačí sdílené testovací certifikáty playgroundu.
- Postup opravy s tebou domluvíme. Zranitelnost se zveřejní až po vydání opravy.

| Verze               | Podpora                    |
| ------------------- | -------------------------- |
| poslední vydání 0.x | ano                        |
| starší              | ne, aktualizuj na poslední |

### Na co se spolehnout (best effort, bez SLA)

Projekt je open-source bez smluvní podpory. **Nemáme SLA** a nic z následujícího není závazek;
je to naše snaha:

- potvrdit přijetí hlášení zhruba do 7 dnů;
- do dalších zhruba 30 dnů říct, zda hlášení považujeme za zranitelnost, a navrhnout postup;
- opravu vydat co nejdřív podle závažnosti;
- zveřejnit opravu a poděkovat, pokud si nepřeješ zůstat v anonymitě.

Pokud se do týdne nikdo neozve, ping v hlášení je v pořádku. Jde-li o akutní provozní problém
bez vazby na bezpečnost, použij běžný postup z [SUPPORT](SUPPORT.md).

## Známá omezení a stav auditu

Je to verze 0.x a **projekt zatím neprošel externím bezpečnostním auditem.** Konkrétně
(shodně s [README](README.md#stav-a-omezení)):

- **Vlastní čtečka DER/X.509 a ověření podpisu odpovědi.** Čtení certifikátů potvrzení řeší
  vlastní minimální kód (asi 300 řádků, jen čtení, bez obecného sestavování cest), který je
  porovnaný s `openssl` na 7 skutečných certifikátech ([ADR-002](docs/ADR-002-response-trust.md)
  bod 6). Externě ho zatím nikdo nezkontroloval. Hlášení o chybách v něm jsou vítaná a patří do
  rozsahu této politiky.
- **Revokace (CRL/OCSP) se lokálně neověřuje** (ADR-002 bod 4). Identitu serveru EET chrání
  povinné HTTPS a připnutá vydávající CA I.CA s kontrolou subjektu GFŘ; rozhodnutí se přehodnotí,
  pokud to bude požadovat zdroj nebo bezpečnostní posouzení ([ROADMAP](ROADMAP.md)).
- **Produkce je neověřená.** Chování s produkčním podpisovým certifikátem GFŘ jsme ještě
  neviděli. Selže bezpečně: nedůvěryhodné potvrzení skončí jako `uncertain/signature`, nikdy jako
  `accepted` ([SPEC_NOTES §15](docs/SPEC_NOTES.md#15-živé-ověření-na-playgroundu)).
- **Závislost na třetí straně.** Podpis a odeslání zprávy dělá `@finitoapp/eet-client`
  (připnutá přesná verze, jeden správce; [ADR-001](docs/ADR-001-protocol-core.md)).
- **Živé testy proti EET běží jen lokálně.** Playground nepřijímá spojení z cloudových runnerů,
  takže je CI neprovádí (SPEC_NOTES §15).

Chceš-li kód zkontrolovat, jsou nejužitečnější `packages/core/src/der.ts`,
`packages/core/src/x509.ts`, `packages/core/src/response-trust.ts` a
`packages/core/src/finito-transport.ts`.

## Co je v rozsahu

**Patří sem:**
- únik privátního klíče, hesla nebo API klíče (včetně logů a chybových hlášek);
- obejití autentizace API;
- přijetí podvržené odpovědi EET jako `accepted`;
- dvojí evidence tržby nebo její ztráta ve frontě;
- injekce přes vstupní formáty (XML, CSV, JSON);
- slabá místa Docker image nebo binárek.

**Nepatří sem:**
- chyby samotného systému EET nebo playgroundu;
- chybějící kontrola revokace (CRL/OCSP) jako taková: je to zdokumentované rozhodnutí
  (ADR-002 bod 4), ne zranitelnost; hlášení o jejím dopadu jsou ale vítaná jako návrh;
- nasazení bez API klíčů v režimu `--dev`;
- zranitelnosti prostředí, které provozuješ ty (síť, operační systém, reverzní proxy).

## Bezpečnostní vlastnosti

**Klíče a certifikáty**
- Privátní klíč pokladny se importuje jako nevyexportovatelný `CryptoKey` (`non-extractable`).
- Hesla k `.p12` nejsou nikdy v konfiguraci (klíč `password` konfigurace odmítne). Načítají se
  jen ze souboru nebo z proměnné prostředí. CLI je nepřijímá jako argument.

**Logy a chybová hlášení**
- Neobsahují klíče, hesla, API klíče, hlavičku `Authorization`, těla požadavků ani
  `SignatureValue`.
- Raw XML (`debug`) má podpisy skryté a nikdy se neukládá.

**Ověření odpovědi EET**
- Podpis potvrzení se ověřuje proti připnuté vydávající CA (I.CA), platnosti certifikátu
  a subjektu GFŘ.
- Nedůvěryhodná odpověď skončí jako `uncertain`, nikdy jako `accepted`. Automaticky se znovu
  neposílá (ADR-002, ADR-003).
- Prostředí certifikátu (playground nebo produkce) se pozná podle vydávající CA. Záměna
  prostředí je chyba.

**HTTP API**
- API klíč je povinný a porovnává se v konstantním čase.
- `--dev` běží bez klíčů, ale odmítne produkční pokladny.
- Těla požadavků mají limity (64 KiB pro jednu tržbu, 10 MiB pro dávku).

**Vstupní formáty**
- XML parser odmítá `DOCTYPE` a externí entity, takže XXE ani entity expansion nehrozí.
- CSV a JSON se jen čtou; nic se z nich nevykonává.

**Docker, závislosti a CI**
- Image běží jako neprivilegovaný uživatel `65532`. Základní obrazy jsou připnuté na digest.
- GitHub Actions jsou připnuté na SHA. Závislosti mají přesné verze. Zdroje EET jsou ověřené
  otisky SHA-256 (`docs/sources`).

## Doporučení pro provoz

- **Klíče a hesla:**
  - API klíče dlouhé a náhodné, aspoň 16 znaků; střídej je přes `EET_API_KEYS`;
  - hesla k certifikátům jako Docker/Kubernetes secrets (`passwordFile`).
- **Síť:** API nevystavuj do internetu bez TLS. Patří za reverzní proxy s HTTPS, ideálně jen
  do vnitřní sítě pokladen.
- **Data:**
  - svazek `/data` (fronta SQLite) zálohuj a chraň, obsahuje údaje o tržbách;
  - SQLite běží v režimu WAL. Bezpečnou kopii za běhu udělá `VACUUM INTO` nebo zálohovací API
    SQLite, ne prosté zkopírování souboru.
- **Provoz:**
  - hlídej logy `needs_attention`, `overdue` a `certificate` (expirace 21 dní předem);
  - aktualizuj na poslední verzi, sleduj [CHANGELOG](CHANGELOG.md).
