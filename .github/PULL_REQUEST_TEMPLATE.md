<!--
CS: Popiš, co a proč se mění. Piš česky nebo anglicky.
EN: Describe what changes and why. Czech or English is fine.
-->

## Co a proč / What and why

Closes #

## Typ změny / Type

- [ ] oprava chyby / bug fix (`fix`)
- [ ] nová funkce / feature (`feat`)
- [ ] dokumentace, CI, refactor, testy / docs, CI, refactor, tests
- [ ] rozbíjející změna / breaking change (označeno `!` nebo `BREAKING CHANGE:`)

## Checklist

- [ ] `bun run check` (lint, typy, testy) je zelený. / `bun run check` passes.
- [ ] Změna má testy (rozhodovací tabulka, kontrakt úložiště, golden soubory, OpenAPI dle situace). / The change comes with tests.
- [ ] Každý fakt o EET má zdroj v `docs/SPEC_NOTES.md` (dokument a kapitola); co zdroj neurčuje, je otevřená otázka v §14, ne odhad v kódu. / Every EET fact is cited in `docs/SPEC_NOTES.md`; gaps become open questions.
- [ ] Do repozitáře jsem nekopíroval(a) dokumenty PG a P (TLP:AMBER), jen jsem je citoval nebo odkázal. / No PG or P (TLP:AMBER) content was copied, only cited or linked.
- [ ] Žádná tajemství: certifikáty, `.p12`, `.pem`, hesla, API klíče, `eet.config.yaml`, databáze fronty ani skutečná data poplatníků. / No secrets or real taxpayer data.
- [ ] Commity (a název PR) odpovídají Conventional Commits (`feat(queue): …`, `fix(core): …`). / Conventional Commits.
- [ ] Při změně API se kódy varování a chyb i `SaleResult` jen rozšiřují; `bun run gen:openapi` a dokumentace v `docs/` jsou aktualizované. / API changes are additive; OpenAPI and docs regenerated.
- [ ] Architektonické rozhodnutí je zapsané jako ADR (`docs/ADR-00x-*.md`). / Architectural decisions are recorded as an ADR.
- [ ] Při změně transportu, fronty nebo podpisu jsem lokálně spustil(a) `bun run test:live` (playground, česká síť). / For transport, queue or signing changes I ran `bun run test:live` locally.

## Poznámky pro revizi / Notes for reviewers
