# Podpora

> **English:** this is a volunteer-run open source project with **no SLA and no guaranteed
> response time**.
> - Questions and ideas: [GitHub Discussions](https://github.com/hospodskej-cz/eet-2-0/discussions).
> - Reproducible bugs and concrete feature requests: [Issues](https://github.com/hospodskej-cz/eet-2-0/issues/new/choose).
> - Security vulnerabilities: privately, see [SECURITY.md](SECURITY.md). Never in a public issue.
> - Never paste certificates (`.p12`, `.pem`), passwords, API keys or taxpayer data anywhere.

## Kam s čím

| Potřebuješ                                        | Kam                                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Poradit s nasazením, konfigurací, integrací       | [Discussions](https://github.com/hospodskej-cz/eet-2-0/discussions)                          |
| Nahlásit chybu, kterou jde zopakovat              | [Issues](https://github.com/hospodskej-cz/eet-2-0/issues/new/choose) → Chyba / Bug            |
| Navrhnout novou funkci                            | [Issues](https://github.com/hospodskej-cz/eet-2-0/issues/new/choose) → Návrh / Feature        |
| Zeptat se, jak se má EET chovat podle dokumentace | [Issues](https://github.com/hospodskej-cz/eet-2-0/issues/new/choose) → Otázka ke specifikaci  |
| Nahlásit zranitelnost                             | Soukromě přes záložku Security, viz [SECURITY.md](SECURITY.md)                                |
| Nahlásit porušení kodexu chování                  | Soukromě, viz [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)                                        |
| Přispět kódem nebo dokumentací                    | [CONTRIBUTING.md](CONTRIBUTING.md)                                                            |

## Než se zeptáš

1. Projdi [README](README.md) a dokumentaci v [`docs/`](docs/): [SERVER](docs/SERVER.md),
   [CLI](docs/CLI.md), [INGEST](docs/INGEST.md), [QUEUE](docs/QUEUE.md).
2. Pravidla EET (pole, kódy chyb, chování serveru) jsou shrnutá v
   [`docs/SPEC_NOTES.md`](docs/SPEC_NOTES.md) s odkazy na oficiální zdroje.
3. Vyhledej, jestli stejné téma už nebylo otevřené.

## Co do hlášení patří

- verze (`eet --version` nebo tag či obraz Dockeru), způsob běhu (binárka, Docker, knihovna
  v Bun/Node/Deno) a operační systém;
- prostředí EET: **playground**, nebo **produkce**;
- minimální postup k zopakování a co jsi čekal(a) místo toho;
- logy s **vymazanými** tajnými údaji.

## Co nikam nevkládej

Skutečné certifikáty a soukromé klíče, hesla, API klíče, `eet.config.yaml` s hesly ani data
poplatníků. K zopakování stačí sdílené testovací certifikáty playgroundu
(`bun run certs:playground`). Pokud ti něco takového uniklo, smaž to a certifikát nech
u vydavatele zneplatnit.

## Poznámky

- Projekt není produktem Finanční správy ČR ani s ní není nijak spojen a nenahrazuje právní ani
  daňové poradenství. Povinnosti podle zákona o evidenci tržeb zůstávají na provozovateli.
- Odpovědi poskytují dobrovolníci ve volném čase. Rychlou odpověď ani vyřešení nelze slíbit.
