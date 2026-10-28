# Správa projektu / Governance

> **English:** EET Gateway is a small, maintainer-led project. Day-to-day changes are decided in
> pull requests; architectural decisions are written down as ADRs in [`docs/`](docs/). Releases
> are cut by merging the release-please PR. Regular contributors can be invited as maintainers.

## Role

- **Správce (maintainer):** schvaluje a slučuje pull requesty, vydává verze, moderuje diskuse
  podle [kodexu chování](CODE_OF_CONDUCT.md) a vyřizuje bezpečnostní hlášení
  ([SECURITY](SECURITY.md)). Aktuálně: [@milos-podpalcem](https://github.com/milos-podpalcem)
  (viz [CODEOWNERS](.github/CODEOWNERS)).
- **Přispěvatel (contributor):** kdokoli, kdo pošle issue, pull request nebo odpověď v diskusi
  podle [CONTRIBUTING](CONTRIBUTING.md).

## Jak se rozhoduje

1. **Běžná změna** (oprava, test, dokumentace, drobná funkce): pull request s testy a se
   zdrojem v [`docs/SPEC_NOTES.md`](docs/SPEC_NOTES.md), kontrola od správce, sloučení po zelené
   CI. Lazy consensus: pokud nikdo nenamítá, rozhoduje správce.
2. **Architektonické rozhodnutí** (transport, podpis, důvěra v odpověď, chování fronty, tvar
   veřejného API): nejdřív návrh jako **ADR** (`docs/ADR-00x-*.md`, vzor jsou stávající ADR),
   projednání v pull requestu, až poté kód. Přijaté ADR se nemaže; změna se zapíše novým ADR,
   které ho nahrazuje.
3. **Fakta o EET** se berou jen z oficiálních zdrojů, ne z názoru. Co zdroj neurčuje, je
   otevřená otázka v SPEC_NOTES §14. Při sporu má přednost oficiální dokumentace.
4. **Stabilní API:** kódy varování a chyb, `SaleResult` a HTTP API v1 se jen rozšiřují.
   Rozbíjející změna musí být v commitu označena (`!` nebo `BREAKING CHANGE:`) a odůvodněna v ADR.
5. **Spor:** rozhoduje správce po veřejné diskusi; důvody zapíše do issue, pull requestu nebo ADR.

## Vydání

Verze vznikají sloučením release PR, které udržuje release-please z Conventional Commits.
Postup včetně kontroly release PR a sestavení binárek je v
[CONTRIBUTING → Commity a vydání](CONTRIBUTING.md#commity-a-vydání). Číslování je semver 0.x
(do 1.0 se API může měnit).

## Jak se stát správcem

Správcem se stává přispěvatel, který:

- dlouhodobě přispívá kvalitními změnami (kód, testy, dokumentace, revize cizích PR);
- zná pravidla projektu (fakta jen z oficiálních zdrojů, testy, žádná tajemství v gitu);
- dodržuje kodex chování a vychází s ostatními.

Nabídku podává stávající správce, případně se dá o roli požádat soukromě. Nový správce dostane
práva k zápisu do repozitáře a přibude v CODEOWNERS. Správce, který je dlouho neaktivní nebo
porušuje kodex, o roli přijde; práva se dají kdykoli vrátit.

## Změny tohoto dokumentu

Navrhují se pull requestem a schvaluje je správce.
