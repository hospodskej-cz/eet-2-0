# Živé testy proti playgroundu EET

> **English summary.** The EET playground (`pg.trzbyeet.gov.cz`) does not accept connections from
> GitHub-hosted runners (SPEC_NOTES §15), so live tests cannot run in ordinary CI. Run them
> locally from a Czech network with `bun run test:live`, or register a self-hosted runner with
> the label `eet-playground` in a Czech network. The workflow
> `.github/workflows/live-playground.yml` then runs weekly (and on demand), and a second job on
> a GitHub-hosted runner writes a dated shields.io endpoint JSON to the `badges` branch. The
> workflow never triggers on pull requests. A self-hosted runner executes whatever code reaches
> it, so keep it dedicated, keep it out of any repository that accepts untrusted pull requests,
> and read "Zabezpečení runneru" before registering one. The workflow has not yet run on a real
> runner; the first dispatch is the test.

Živé testy posílají vymyšlené tržby se sdíleným testovacím certifikátem GFŘ (`CZ00000019`).
Playground nic neeviduje a jeho POK nejsou platné (SPEC_NOTES §3, §15). Test prokazuje, že
podepsaný požadavek projde, odpověď se ověří a transport, fronta, server i CLI odpoví tak, jak
čekáme. Offline testy (`bun test`) to nenahradí: používají jen zachycenou odpověď.

## Spuštění z české sítě

Potřebuješ:

- Bun ve verzi ze souboru `.bun-version`;
- příkaz `unzip` (rozbalí sdílené testovací certifikáty) a `curl`;
- odchozí HTTPS na `pg.trzbyeet.gov.cz` a `eet.gov.cz`. Playground podle SPEC_NOTES §15
  pravděpodobně filtruje zdrojové adresy, z české sítě odpovídal, z GitHub-hosted runneru ne.

```sh
bun install --frozen-lockfile
bun run certs:playground     # stáhne .zip, ověří SHA-256 z docs/sources/sources.json, rozbalí do .cache/
bun run test:live
```

Před spuštěním si můžeš ověřit dosažitelnost. Preflight `OPTIONS` vrací 204 a nic neodesílá:

```sh
curl -4 -sS -o /dev/null --max-time 15 -X OPTIONS \
  -H "Origin: https://example.org" -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type, SOAPAction" \
  -w "HTTP %{http_code}\n" https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4
```

Při `HTTP 000` nebo timeoutu se k playgroundu nedostaneš a živé testy skončí `uncertain/timeout`.
To neříká nic o kódu. Zkus jinou síť (jiný poskytovatel, mobilní data) nebo se zeptej správce
sítě, jestli neblokuje ven.

Certifikáty z `.cache/playground/` jsou veřejné testovací přihlašovací údaje, ale nikdy je
nevkládej do gitu ani do logů (CONTRIBUTING). **Produkční certifikát na živé testy nikdy
nepoužívej.**

## Self-hosted runner v české síti

Workflow `live-playground.yml` má dvě úlohy:

| Úloha   | Kde běží                        | Práva tokenu      | Co dělá                                                                    |
| ------- | ------------------------------- | ----------------- | -------------------------------------------------------------------------- |
| `live`  | `[self-hosted, eet-playground]` | `contents: read`  | instalace, kontrola dostupnosti, `bun run test:live`, jedno slovo výsledku |
| `badge` | GitHub-hosted `ubuntu-latest`   | `contents: write` | z výsledku vyrobí JSON a zapíše ho do větve `badges`                       |

Runner tedy nikdy nedrží token s právem zápisu a o obsahu odznaku nerozhoduje: úloha `badge`
převezme jen slovo `passing`, `failing` nebo `unreachable`, ověří ho a JSON si sestaví sama.
Napadený runner může nanejvýš lhát o stavu, stejně jako každé CI.

### Co je potřeba

- **Stroj:** Linux x64 nebo arm64 s českou veřejnou adresou, třeba malý VPS u českého
  poskytovatele nebo stroj v kanceláři. Stačí odchozí spojení, žádný příchozí port.
- **Software:** `git`, `curl`, `unzip`. Bun nainstaluje samotný workflow (`oven-sh/setup-bun`).
- **Účet:** vyhrazený neprivilegovaný uživatel (bez `sudo`) jen pro runner.
- **Odchozí povolení:** `github.com`, `api.github.com`, `*.actions.githubusercontent.com`,
  `objects.githubusercontent.com`, `registry.npmjs.org`, `eet.gov.cz`, `pg.trzbyeet.gov.cz`.
  Přesný aktuální seznam adres runneru je v dokumentaci GitHubu (Self-hosted runners →
  Communication requirements). Ověř ho, nepřebírej ho odsud.

### Registrace

Na repozitáři `hospodskej-cz/eet-2-0`: **Settings → Actions → Runners → New self-hosted runner**.
GitHub tam ukáže stažení a příkazy s krátce platným registračním tokenem. Token nikam
nekopíruj, nevkládej do skriptů ani do gitu. Stačí přidat štítek:

```sh
./config.sh --url https://github.com/hospodskej-cz/eet-2-0 \
  --token <registrační token z webu> \
  --labels eet-playground --name eet-playground-cz-1
sudo ./svc.sh install <uživatel-runneru> && sudo ./svc.sh start   # nebo ./run.sh ručně
```

Runner dostane štítky `self-hosted`, `Linux`, `X64` (nebo `ARM64`) a `eet-playground`. Workflow
vybírá přes `runs-on: [self-hosted, eet-playground]`.

Registruj ho **na úrovni repozitáře**, ne organizace. Pokud ho organizace přesto sdílí, patří do
vlastní skupiny runnerů omezené na tento jediný repozitář.

### Zapnutí

1. V **Settings → Environments** vytvoř prostředí `live-playground` a v **Deployment branches
   and tags** nastav **Selected branches and tags → `main`** (viz níže).
2. Až je runner online (**Settings → Actions → Runners**, stav _Idle_), zapni týdenní plán:
   `gh variable set LIVE_PLAYGROUND_ENABLED --body true --repo hospodskej-cz/eet-2-0`.
3. Spusť poprvé ručně: `gh workflow run live-playground.yml --ref main` a sleduj
   `gh run watch`. První běh vytvoří větev `badges`.

Bez proměnné `LIVE_PLAYGROUND_ENABLED` plánovaný běh přeskočí (žádný červený křížek, žádná
fronta). Ruční spuštění se vždy pokusí běžet. Pokud runner chybí, zůstane ruční běh ve frontě
a GitHub ho po 24 hodinách zruší (podle [Actions limits](https://docs.github.com/en/actions/reference/limits)).
Na pull requesty to vliv nemá, workflow na ně vůbec nereaguje.

### Zabezpečení runneru

Self-hosted runner spustí kód každého workflow, které se na něj dostane. GitHub proto výslovně
varuje před jeho použitím u veřejných repozitářů: kdokoli může otevřít pull request a prostředí
kompromitovat, a runner nemusí být po jobu čistý
([Secure use](https://docs.github.com/en/actions/reference/security/secure-use)). U nás platí:

1. **Žádný `pull_request`, `pull_request_target`, `push`, `issue_comment` ani jiný spouštěč
   z cizího vstupu** ve workflow, které běží na `eet-playground`. `live-playground.yml` smí mít
   jen `schedule` a `workflow_dispatch`. Při review pull requestů to kontroluj u každé změny
   v `.github/workflows/` (doporučeno: `CODEOWNERS` pro `.github/` a pravidlo větve `main`
   vyžadující schválení).
2. **Fork pull request nemá jak se na runner dostat.** Workflow na pull requesty nereaguje
   a podmínka `github.repository == 'hospodskej-cz/eet-2-0'` ho v forku zastaví. K tomu v
   **Settings → Actions → General** nastav _Fork pull request workflows from outside
   collaborators_ na **Require approval for all outside collaborators**. Je to druhá pojistka
   pro případ, že by někdo spouštěč do jiného workflow s týmž štítkem přidal.
3. **`dispatch` jen z `main`.** Kdo má právo zápisu, může spustit workflow z vlastní větve
   s upraveným souborem. Proto úloha `live` používá `environment: live-playground`
   s omezením nasazení na `main`, a podmínka `github.ref == 'refs/heads/main'` zabrání tomu,
   aby se na runner dostala nezkontrolovaná větev. Je to mírnění, ne izolace: GitHub uvádí,
   že schvalování prostředí workflow před škodlivým kódem neizoluje. Skutečnou obranou je
   skupina lidí s právem zápisu a vyhrazený stroj.
4. **Vyhrazený stroj.** Žádné SSH klíče, cloudové přihlašovací údaje ani přístup do vnitřní
   sítě. Odchozí provoz omez na seznam výše. Bez `sudo`. Metadata endpointy cloudu zablokuj.
5. **Čistota.** Nejlépe spouštěj runner s `--ephemeral` ve vlastním kontejneru nebo VM
   a po každém jobu ho obnov. Alespoň stroj pravidelně přeinstaluj a nech zapnuté automatické
   aktualizace runneru.
6. **Žádná tajemství.** Workflow žádná nepoužívá a nesmí se tam objevit. Na stroji nikdy
   neleží produkční `.p12`. Veřejné testovací certifikáty playgroundu jsou jediné, co tam smí být.
7. **Token jen ke čtení.** `permissions: {}` na úrovni workflow a `contents: read` u úlohy
   `live`. Zápis má jen úloha `badge` na GitHub-hosted runneru.
8. **Veřejný repozitář.** Pokud se repozitář zveřejní, projdi body 1 až 3 znovu a zvaž, jestli
   živé testy nepustit raději jen ručně z vlastního stroje (`bun run test:live`) a runner
   vůbec neregistrovat. Odznak pak můžeš nechat zapsat ručně.

## Odznak (shields.io endpoint)

Úloha `badge` zapisuje do větve `badges` soubor `live-playground.json`:

```json
{
  "schemaVersion": 1,
  "label": "EET playground",
  "message": "passing (2026-10-28)",
  "color": "brightgreen",
  "cacheSeconds": 3600
}
```

| `message`     | Barva   | Význam                                                                             |
| ------------- | ------- | ---------------------------------------------------------------------------------- |
| `passing`     | zelená  | všechny živé testy prošly, odpovědi měly platný podpis                             |
| `failing`     | červená | některý test selhal, nebo úloha spadla před testy (instalace, stažení certifikátů) |
| `unreachable` | šedá    | runner se k playgroundu nedostal, žádný test neběžel; to je problém sítě, ne kódu  |

Datum v závorce je den posledního běhu. Starší než dva týdny znamená, že runner nejspíš neběží.

Odznak vložíš do README takto (adresu `raw.githubusercontent.com` shields.io načte jen u
veřejného repozitáře):

```md
[![EET playground](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fhospodskej-cz%2Feet-2-0%2Fbadges%2Flive-playground.json)](https://github.com/hospodskej-cz/eet-2-0/actions/workflows/live-playground.yml)
```

Větev `badges` obsahuje jen tenhle jeden soubor. Do větve `main` se nic nezapisuje, a CI i
release workflow na push do `badges` nereagují (spouštějí se na `main`).

## Co není ověřeno

- Workflow se zatím nespustil na skutečném runneru (v době psaní žádný není). Syntaxe, připnuté
  SHA akcí i logika odznaku jsou zkontrolované, první ruční běh je vlastní test.
- Chování `environment: live-playground` závisí na nastavení v GitHubu (bod 1 v „Zapnutí“).
  Bez omezení na `main` zůstává ochrana jen v podmínce `github.ref`.
