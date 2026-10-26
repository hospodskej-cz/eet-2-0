# Bezpečnost

> **English:** please report vulnerabilities privately through GitHub's **Report a
> vulnerability** button on the Security tab. Do not open a public issue.
>
> - Supported: the latest 0.x release.
> - Private reports need private vulnerability reporting enabled on the repository; the
>   maintainer turns it on when the repository becomes public.

## Hlášení zranitelností

Zranitelnost nahlas **soukromě** přes záložku Security → **Report a vulnerability**. Veřejné
issue nezakládej.

- Do hlášení patří popis, dotčená verze a postup k reprodukci.
- **Nikdy nepřikládej skutečné certifikáty, hesla, API klíče ani data poplatníků.** Na
  reprodukci stačí sdílené testovací certifikáty playgroundu.
- Postup opravy s tebou domluvíme. Zranitelnost se zveřejní až po vydání opravy.

| Verze               | Podpora                    |
| ------------------- | -------------------------- |
| poslední vydání 0.x | ano                        |
| starší              | ne, aktualizuj na poslední |

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
