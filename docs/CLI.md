# `eet` — příkazová řádka

CLI pracuje nad stejným jádrem, frontou a konfigurací jako HTTP služba ([SERVER](SERVER.md)).
Používá stejný `eet.config.yaml` a proměnné `EET_*` i stejnou SQLite frontu. Do jedné databáze
smí zároveň zapisovat `eet serve` i jiné příkazy `eet`, protože převzetí záznamu je atomické
([ADR-003](ADR-003-queue-retry-policy.md)).

```sh
eet send trzby.csv                       # ověří, uloží a odešle; výsledek každého řádku
eet send - --format json < trzba.json    # ze stdin
eet send trzby.csv --verify              # ověřovací mód: EET zkontroluje, nic neeviduje
eet validate trzby.csv                   # jen kontrola, nic se neuloží ani neodešle
eet queue list --status queued,uncertain # co čeká
eet queue flush                          # pošli čekající hned (po výpadku)
eet queue retry <id>                     # jednu tržbu znovu (např. po opravě certifikátu)
eet cert inspect kasa.p12 --password-file heslo.txt
eet serve --config eet.config.yaml       # HTTP API s doposíláním na pozadí
```

## Příkazy

| Příkaz                          | Co dělá                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eet send <soubor\|->`          | Tržby ze souboru nebo ze stdin projde ingestem ([INGEST](INGEST.md)), uloží a **synchronně** odešle řádek po řádku. Co neskončí přijetím (`queued`, `uncertain`), zůstává ve frontě pro `eet serve` nebo `eet queue flush`. Opakované spuštění nad stejným souborem nic neodešle dvakrát (varování 1071) |
| `eet validate <soubor\|->`      | Stejný ingest a stejné výchozí hodnoty pokladen jako `send`, ale nic neuloží ani neodešle. Bez konfigurace jen převede a ověří vstup (výchozí hodnoty pokladen chybí)                                                                                                                                    |
| `eet queue list`                | Přehled od nejnovějších: `--status`, `--register`, `--overdue`, `--from`/`--to` (podle `dat_trzby`), `--limit`, `--cursor`, `--all`                                                                                                                                                                      |
| `eet queue retry <id>`          | Hned znovu pošle `queued`, `uncertain` nebo `rejected` tržbu (`prvni_zaslani=false`)                                                                                                                                                                                                                     |
| `eet queue flush`               | Hned pošle všechno, co čeká na **automatické** doposlání, bez ohledu na backoff. `rejected` a nejisté tržby bez automatického opakování (např. nedůvěryhodný podpis odpovědi) jen přes `retry`                                                                                                           |
| `eet cert inspect <soubor.p12>` | EIČ, vydavatel, prostředí (podle vydávající CA), sériové číslo, platnost, otisk                                                                                                                                                                                                                          |
| `eet serve`                     | HTTP API ([SERVER](SERVER.md)), `--port`, `--dev`                                                                                                                                                                                                                                                        |

**Volby:**

| Volba                             | Příkazy                     | Význam                                                                                     |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `--format csv\|json\|ndjson\|xml` | `send`, `validate`          | Formát; jinak podle přípony (`.csv`, `.json`, `.ndjson`/`.jsonl`, `.xml`); u stdin povinný |
| `--register ID`                   | `send`, `validate`, `queue` | Pokladna; řádek ji může určit sám polem `register`                                         |
| `--verify`                        | `send`, `validate`          | Ověřovací mód (`overeni`)                                                                  |
| `--config cesta`                  | všechny                     | Konfigurace; jinak `EET_CONFIG`, jinak `./eet.config.yaml`                                 |
| `--json`                          | všechny                     | Strojový výstup (objekty knihovny: `BatchSubmitResult`, `SaleResult`, …)                   |
| `--verbose`                       | všechny                     | Vypíše i úpravy vstupu (varování ingestu) a průběh fronty (JSON řádky na stderr)           |
| `--help`, `--version`             |                             |                                                                                            |

## Výstup a exit kódy

Lidský výstup má jeden řádek na tržbu: číslo řádku, stav, POK nebo důvod a identifikaci účtenky
(`porad_cis · částka · dat_trzby · id_pokl`). Pod ním jsou odsazené chyby a varování od EET
a od fronty. Úpravy vstupu (např. „česká čárka v částce“) se kvůli přehlednosti jen sečtou;
`--verbose` je vypíše. Na konci je souhrn podle stavů. U nepřijatých tržeb je vidět `id` pro
`eet queue retry`.

| Kód | Význam                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------- |
| 0   | V pořádku: všechny tržby přijaté nebo ověřené, všechny platné, certifikát platný                                                |
| 1   | Chyba: konfigurace, certifikát, heslo, soubor, neznámé id                                                                       |
| 2   | Špatné použití: neznámý příkaz nebo volba, chybějící argument                                                                   |
| 3   | Proběhlo, ale aspoň jedna tržba nebyla přijatá (`send`, `retry`, `flush`) nebo platná (`validate`), případně certifikát neplatí |

## Hesla

- Heslo k `.p12` se **nikdy nezadává jako argument**, protože by bylo vidět ve výpisu procesů
  i v historii shellu.
- `eet cert inspect` ho bere z `--password-file`, z `EET_P12_PASSWORD`, nebo se zeptá terminálu
  se skrytým vstupem.
- Ostatní příkazy čtou hesla z konfigurace stejně jako služba (`passwordFile`,
  `EET_REGISTER_<ID>_P12_PASSWORD`).

## Samostatné binárky

`bun run build:binaries` sestaví `eet` bez nutnosti instalovat Bun pro `linux-x64`, `linux-arm64`,
`darwin-arm64` a `windows-x64` do `dist/bin/` a přidá `SHA256SUMS`. Vydávat se budou
v GitHub Releases (fáze 7).

- Binárky **nenačítají** `.env` ani `bunfig.toml` z pracovního adresáře. Proměnné `EET_*` nastav
  explicitně, aby chování nezměnil zapomenutý soubor.
- `scripts/binary-smoke.sh dist/bin/eet-<cíl>` provede binárku všemi příkazy, aniž by cokoli
  poslala do EET. CI to dělá s linux-x64 při každé změně, s macOS a Windows po ručním spuštění
  workflow `Binaries`.
- Binárka pro macOS není podepsaná. Po stažení z internetu ji Gatekeeper zablokuje; odblokuješ
  ji příkazem `xattr -d com.apple.quarantine eet-darwin-arm64`.
- Pro produkci nastav `BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS=0` (nový DNS překlad pro každé
  spojení, [SERVER](SERVER.md#síť)).
