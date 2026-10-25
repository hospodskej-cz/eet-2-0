# EET Gateway (pracovní název)

Open-source (MIT) brána pro odesílání tržeb do **EET 2.0** (Finanční správa ČR, SOAP rozhraní
4.1). Tržbu přijme v libovolném běžném formátu, převede ji na platnou datovou zprávu, podepíše,
odešle a vrátí normalizovanou odpověď. Integrovat ji půjde jako TypeScript knihovnu, jako HTTP
službu s OpenAPI nebo jako CLI.

> An open-source gateway for Czech EET 2.0 sales registration: library, HTTP service and CLI.
> Full English documentation will follow in phase 7.

**Stav: fáze 1 z 7.** Projekt zatím nic neodesílá. Je hotový jen podklad ze specifikace a kostra
monorepa.

- [docs/SPEC_NOTES.md](docs/SPEC_NOTES.md): výtah z oficiální specifikace s odkazy na zdroje,
  rozdíly mezi zadáním a zdroji, otevřené otázky
- [docs/ADR-001-protocol-core.md](docs/ADR-001-protocol-core.md): rozhodnutí o protokolovém jádru

## Vývoj

Potřebuješ [Bun](https://bun.sh) ve verzi z `.bun-version` a `xmllint` (libxml2) pro kontraktní
testy proti XSD.

```sh
bun install
bun run check             # biome + tsc + bun test
bun run compat:node       # sestaví jádro a ověří, že běží v Node
bun run spec:drift        # porovná oficiální dokumenty na eet.gov.cz se stavem v docs/sources
bun run certs:playground  # stáhne sdílené testovací certifikáty do .cache/ (necommitují se)
```

| Balíček           | Účel                                           |
| ----------------- | ---------------------------------------------- |
| `packages/core`   | protokolová vrstva za rozhraním `EetTransport` |
| `packages/ingest` | parsery a normalizace vstupů                   |
| `packages/queue`  | perzistentní fronta a doposílání               |
| `packages/server` | HTTP API v1 + OpenAPI                          |
| `packages/cli`    | CLI                                            |

## Licence

[MIT](LICENSE)
