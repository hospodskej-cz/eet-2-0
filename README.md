# EET Gateway (pracovní název)

Open-source (MIT) brána pro odesílání tržeb do **EET 2.0** (Finanční správa ČR, SOAP rozhraní
4.1). Tržbu přijme v libovolném běžném formátu, převede ji na platnou datovou zprávu, podepíše,
odešle a vrátí normalizovanou odpověď. Integrovat ji půjde jako TypeScript knihovnu, jako HTTP
službu s OpenAPI nebo jako CLI.

> An open-source gateway for Czech EET 2.0 sales registration: library, HTTP service and CLI.
> Full English documentation will follow in phase 7.

**Stav: fáze 2 z 7.** Jádro (`packages/core`) umí načíst certifikát z `.p12`, podepsat
a odeslat jednu tržbu a ověřit podpis potvrzení. Ověřeno živě proti playgroundu. Fronta, převod
vstupních formátů, HTTP API a CLI přijdou v dalších fázích.

- [docs/SPEC_NOTES.md](docs/SPEC_NOTES.md): výtah z oficiální specifikace s odkazy na zdroje,
  rozdíly mezi zadáním a zdroji, otevřené otázky, živé ověření (§15)
- [docs/ADR-001-protocol-core.md](docs/ADR-001-protocol-core.md): protokolové jádro nad
  `@finitoapp/eet-client`
- [docs/ADR-002-response-trust.md](docs/ADR-002-response-trust.md): důvěra v podpis potvrzení
  a čtení X.509

## Vyzkoušej

Pošle jednu vymyšlenou tržbu na playground EET se sdíleným testovacím certifikátem a vypíše
výsledek. Playground nic neeviduje a jeho POK (končí `-ff`) nejsou platné.

```sh
bun install
bun run certs:playground          # jednou: stáhne testovací certifikáty do .cache/playground/
bun run playground:send           # ostrý mód → "kind": "accepted", POK …-ff
bun run playground:send --verify  # ověřovací mód → "kind": "verification_ok"
bun run playground:send --unit 10 # id_jednotky nekončí 1–4 → varování 6
bun run playground:send --debug   # přidá raw XML požadavku a odpovědi (SignatureValue skryté)
```

Jako knihovna:

```ts
import { createEetTransport, createHeader, formatEetDateTime, loadPkcs12 } from "@eet-gateway/core";

const certificate = await loadPkcs12(p12Bytes, password);
const transport = createEetTransport({ environment: "playground", certificate });
const outcome = await transport.send({
  data: {
    eic_popl: certificate.info.eic,
    id_jednotky: "11",
    id_pokl: "pokladna-1",
    porad_cis: "2026/0001",
    dat_trzby: formatEetDateTime(new Date()),
    celk_trzba: "250.00",
  },
  header: createHeader({ prvni_zaslani: true }),
});
// outcome.kind: accepted | verification_ok | rejected | not_sent | uncertain
```

## Vývoj

Potřebuješ [Bun](https://bun.sh) ve verzi z `.bun-version` a `xmllint` (libxml2) pro kontraktní
testy proti XSD.

```sh
bun install
bun run check             # biome + tsc + bun test
bun run compat:node       # sestaví jádro a ověří, že běží v Node
bun run spec:drift        # porovná oficiální dokumenty na eet.gov.cz se stavem v docs/sources
bun run certs:playground  # stáhne sdílené testovací certifikáty do .cache/ (necommitují se)
bun run test:live         # živé testy proti playgroundu (3 vymyšlené tržby)
```

Offline testy potřebují testovací certifikáty (`bun run certs:playground`); bez nich selžou se
srozumitelnou hláškou.

| Balíček           | Účel                                           |
| ----------------- | ---------------------------------------------- |
| `packages/core`   | protokolová vrstva za rozhraním `EetTransport` |
| `packages/ingest` | parsery a normalizace vstupů                   |
| `packages/queue`  | perzistentní fronta a doposílání               |
| `packages/server` | HTTP API v1 + OpenAPI                          |
| `packages/cli`    | CLI                                            |

## Licence

[MIT](LICENSE)
