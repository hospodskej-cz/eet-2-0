# ADR-004: Jediná běhová závislost `@finitoapp/eet-client`: ponechat, připnout, sledovat

- **Stav:** přijato (28. 10. 2026). Doplňuje [ADR-001](ADR-001-protocol-core.md), který už
  zmiňuje přesný pin a kritéria přechodu na vlastní implementaci. Tady jsou ta kritéria
  zkonkretizována a podložena zjištěnými fakty.
- **Rozsah:** `packages/core` (běhová závislost), `packages/ingest` (jen vývojová, golden testy).
- **Fakta jsou z 28. 10. 2026.** Zjištěno příkazy `npm view`, `gh api` a čtením balíčku
  v `node_modules`. Co jsem neověřil, je výslovně uvedeno.

## Kontext

Brána stojí na `@finitoapp/eet-client` ve verzi 0.4.0 pro sestavení a podpis zprávy, odeslání,
parsování odpovědi a čtení PKCS#12. Je to jediná závislost jádra kromě `zod`. Bezpečnostně je
to nejcitlivější cizí kód: čte nedůvěryhodný XML ze sítě a rozhoduje, že podpis sedí na tělo
zprávy. Výsledek je právně závazný (POK).

## Co jsme zjistili

| Otázka                | Zjištění                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Licence               | MIT, soubor `LICENSE` v repozitáři i v balíčku: `Copyright (c) 2026 Finito`. `npm view` hlásí `MIT`, GitHub API `spdx_id: MIT`.                                                                                                                                                            |
| Vlastník a správce    | GitHub organizace `finitoapp`, repozitář založen 23. 7. 2026. V npm je jediný maintainer `pepakriz` (Josef Kříž, `author` v `package.json`). Členy organizace jsem nezjistil.                                                                                              |
| Stáří a tempo         | První publikace 25. 7. 2026, pět verzí: 0.0.0 (25. 7.), 0.1.0 (26. 7.), 0.2.0 (27. 7.), 0.3.0 (9. 8.), 0.4.0 (19. 10.). Mezi 0.3.0 a 0.4.0 je 10 týdnů. Poslední commit na `main` 19. 10. 2026.                                                                                             |
| Commity               | 41 commitů: 30 od `pepakriz`, 11 od `dependabot[bot]`. Žádný jiný člověk nepřispěl.                                                                                                                                                                   |
| Issues a PR           | Otevřených issues od lidí: 0. Otevřených je 5 PR, všechny od Dependabotu (aktualizace vývojových nástrojů z 13. 9.). Uzavřených PR od člověka: jen vlastní PR autora. 4 hvězdičky, 0 forků.                                                                                                |
| Bezpečnostní politika | `SECURITY.md` existuje: hlášení e-mailem autora nebo přes GitHub private vulnerability reporting, odpověď „do několika pracovních dnů“. Zveřejněných security advisories: 0. Ochrana větve `main` přes API nezjištěna (404), tedy nenastavená nebo nepřístupná.                              |
| Závislosti            | **Žádné běhové.** Volitelné peer závislosti `zod ^4` a `react-native-quick-crypto ^1`. Žádné `install` skripty. Balíček má 81 souborů, 971 572 B rozbaleno.                                                                                                                                |
| Původ publikace       | Publikace přes OIDC trusted publishing. Registr nese SLSA provenance: workflow `.github/workflows/release.yml` ze značky `v0.4.0`, commit `0b23b0f5bd44ae4ba2fccbd105a6ed536d1d3fc7`. Tentýž commit vrací `gh api` pro značku `v0.4.0` v repozitáři. **Podpis Sigstore jsem neověřoval**, jen četl obsah prohlášení. |
| Naše připnutí         | `"@finitoapp/eet-client": "0.4.0"` bez `^` v `packages/core` i `packages/ingest`; `bunfig.toml` má `exact = true`; CI používá `bun install --frozen-lockfile`. `bun.lock` nese `sha512-ayeFPTrgvu5Oxf9jBqpWkCvzKesrzxDl3Gc457zxPVJ9g5R6ac6BuoXL+wWNKLywDuZ/aMGGjabfkUClqQLXFA==`, shodné s `dist.integrity` v registru. |

### Co z knihovny používáme

Z kódu repozitáře (`grep @finitoapp`):

| Import                                                  | Kde                                   | K čemu                                                                       |
| ------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `createEetClient` (`submit`)                            | `finito-transport.ts`                 | sestavení, podpis (WS-Security + XMLDSig, Exclusive C14N), odeslání, parsování odpovědi, kontrola digestu těla a uuid u potvrzení |
| `createCryptoKeySigner`                                 | `certificate.ts`                      | adaptér `CryptoKey` → `EetSigner`                                            |
| `parsePkcs12`, `pickPrivateKeyCertificate` (`/pkcs12`)  | `certificate.ts`                      | PKCS#12 včetně legacy RC2-40 a 3DES, které Web Crypto neumí                  |
| `parseEetReceiptData`, `parseHeader` (`/builtin`)       | `finito-transport.ts`                 | validace vstupu v tvaru, který knihovna vyžaduje                             |
| `serializeUnsignedRequest`, `parseAndVerifyResponse`    | testy ingestu, testy důvěry v odpověď | golden soubory a testy verifieru                                             |

Nepoužíváme `/caeet-renewal`, `/react-native`, `/zod` ani vestavěný pinning verifier. Vlastní
důvěru v odpověď máme v `response-trust.ts` (ADR-002).

### Kolik kódu by stálo nahrazení

Orientačně podle řádků zkompilovaného (nezminifikovaného, s komentáři) `dist` v balíčku. Není to
odhad pracnosti, jen velikost toho, co by přibylo:

| Část                                                     | Řádků v `dist` | Poznámka                                                                                         |
| -------------------------------------------------------- | -------------: | ------------------------------------------------------------------------------------------------ |
| XML parser, C14N, sestavení požadavku, podpis, odpověď, klient (`src-*.mjs`) | 1 117 | jádro protokolu; z toho C14N asi 70, parser asi 360, parsování odpovědi asi 270, klient asi 70   |
| PKCS#12 (`pkcs12-*.mjs`)                                 |          1 843 | DES asi 1 000 řádků jsou tabulky, RC2 asi 360, KDF asi 85, ASN.1 a parsování asi 370             |
| Validátory (`builtin.mjs`)                               |            110 | máme vlastní zod schémata v `schema.ts`; zbývá jen tvar vstupu pro klienta                       |

Nejtěžší a nejrizikovější jsou dvě věci: **kanonizace a pravidla pro XMLDSig** (chyby tu
neskončí pádem, ale tichým přijetím špatné zprávy) a **legacy PKCS#12** (kryptografie, kterou
nechceme psát). Vlastní čtečku X.509 už máme (`x509.ts`, `der.ts`); tu je nutné držet
oddělenou od XML.

Z toho plyne: výměna stojí zhruba velikost dnešního `packages/core`. Je proveditelná, ale není
levná, a proto ji nechceme dělat předčasně.

## Rozhodnutí

**Ponechat, připnout přesně, sledovat a mít připravený plán na fork.** Nepíšeme vlastní
implementaci teď. Důvody: knihovna je malá (bez vlastních závislostí), pod MIT, aktivní,
ověřená proti reálnému playgroundu (SPEC_NOTES §15, náš živý test) a naše vlastní review její
odpovědní větve (docs/AUDIT.md) v ní nenašlo chybu, kterou by adaptéry nezachytily. Rizikem je
jediný správce, ne kvalita kódu.

### 1. Připnutí a integrita (platí už dnes)

- Přesná verze bez rozsahu, `exact = true`, `--frozen-lockfile` v CI i při sestavení image a
  binárek. Integrita `sha512` v `bun.lock`.
- **Upgrade jen přes PR**, ve kterém:
  1. se přečte rozdíl balíčků (`npm diff --diff=@finitoapp/eet-client@0.4.0 --diff=@finitoapp/eet-client@<nová>`),
     zvlášť `parse-response`, `c14n`, `sign`, `http`, `pkcs12`;
  2. projdou kontraktní testy (XSD, vzorové zprávy), testy důvěry a `bun test packages/core`;
  3. projdou živé testy (`docs/live-testing.md`);
  4. se zkontroluje původ nové verze: registr má provenance, značka v repozitáři odpovídá
     commitu z provenance, seznam maintainerů v npm se nezměnil;
  5. se zapíše verze a výsledek do ADR-001, bod 2.
- Žádný automatický upgrade (ani Dependabot s automatickým sloučením).

### 2. Sledování

Dokud to není automatizované, dělá to správce při každém vydání a nejméně jednou za čtvrtletí:

```sh
npm view @finitoapp/eet-client time.modified dist-tags maintainers license --json
gh api repos/finitoapp/eet-client/commits?per_page=1 -q '.[0].commit.author.date'
gh api repos/finitoapp/eet-client/security-advisories
```

A zapnout v GitHubu u repozitáře `finitoapp/eet-client` **Watch → Custom → Releases a Security
alerts**. Doporučené doplnění (mimo tento ADR a mimo rozsah revize, zapsáno jako návrh):
`.github/dependabot.yml` jen pro `npm` s upozorněním bez automatického sloučení a týdenní krok
v `spec-drift.yml`, který selže, pokud se změní `maintainers`, `license` nebo `dist-tags.latest`.

### 3. Spouštěče pro fork nebo vendoring

Přechod rozhodne správce a zapíše se jako nový ADR. Fork se spouští, pokud nastane aspoň jedno:

| #   | Spouštěč                                                                                                                                                                                  | Okamžitá reakce                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Zranitelnost v knihovně (advisory nebo náš nález), kterou upstream neopraví do **14 dnů** od nahlášení. U přijetí podvržené odpovědi jako `accepted` hned, bez čekání.                     | záplata ve forku, v mezidobu `leafPins` a omezení endpointu                                                      |
| 2   | Blokující chyba, kterou nejde obejít adaptéry (`fetch`, signer, verifier), bez opravy do **14 dnů** (ADR-001).                                                                              | fork s opravou, PR upstreamu                                                                                     |
| 3   | Opuštění projektu: repozitář archivován nebo smazán, balíček odpublikován nebo `npm deprecate`, **žádný commit ani vydání déle než 6 měsíců** a zároveň čekající potřebná změna.             | fork z naposledy ověřeného commitu                                                                              |
| 4   | Změna správy: nový maintainer v npm nebo převod repozitáře. Nová verze se nepřijme, dokud se její rozdíl proti 0.4.0 nezkontroluje celý.                                                    | zůstat na 0.4.0                                                                                                  |
| 5   | Změna licence v jakékoli nové verzi. Používáme jen verze pod MIT.                                                                                                                          | zůstat na poslední MIT verzi, fork z ní                                                                          |
| 6   | GFŘ vydá nové rozhraní (např. `/v5`) nebo změní podpisový profil a upstream ho nepodporuje do **30 dnů** od zachycení změny v `spec:drift`.                                                | fork nebo vlastní implementace dotčené části                                                                     |
| 7   | Publikovaná verze neodpovídá zdroji: chybí provenance, značka neukazuje na commit z provenance, nebo se obsah `dist` liší od sestavení ze značky.                                          | verzi nepřijmout, nahlásit upstreamu                                                                             |

### 4. Plán záložní varianty

1. **Fork (preferovaný první krok).** Organizace `hospodskej-cz` forkne `finitoapp/eet-client`
   z commitu naposledy ověřené verze (dnes `0b23b0f5…`, značka `v0.4.0`), ponechá historii a
   `LICENSE`. Závislost se přepne na vlastní publikovaný balíček (scope čeká na OQ7) nebo na
   git commit s ověřeným sestavením. Rozhraní `EetTransport` zůstává, mění se jen import ve
   dvou souborech (`finito-transport.ts`, `certificate.ts`) a v testech ingestu.
2. **Vendoring.** Pokud fork není udržitelný, zdroj se zkopíruje do `packages/` (např.
   `packages/protocol`) a stává se naším kódem. Nejdřív se přenese jen to, co používáme (viz
   tabulka výše): klient, C14N, parser, odpověď a PKCS#12. `caeet-renewal` a React Native se
   nekopírují.
3. **Vlastní implementace** (ADR-001, „Kdy napsat vlastní“) až když zdroj nejde převzít ani
   udržet.

V každém z kroků zůstávají naše kontraktní testy, testy důvěry a živé testy (`docs/live-testing.md`),
takže nahrazení se dokazuje stejnými testy jako dnes.

### 5. Licenční povinnosti

MIT vyžaduje, aby **oznámení o autorských právech a text licence zůstaly součástí všech kopií
nebo podstatných částí** softwaru.

- **Při vendoringu nebo forku:** `Copyright (c) 2026 Finito` a celý text MIT licence zůstanou
  v souboru `LICENSE` zkopírovaného adresáře a v hlavičce vendorovaných souborů. Naše licence
  (MIT, `LICENSE` v kořeni) je kompatibilní, ale soubor původního autora se nepřepisuje ani
  nenahrazuje. Úpravy se značí v historii forku.
- **Už dnes:** standalone binárky (`bun build --compile`) a Docker image knihovnu obsahují
  zabalenou a vydávají se bez jakéhokoli oznámení třetích stran. V repozitáři není
  `THIRD_PARTY_NOTICES` ani jiný soubor s oznámením a skripty sestavení ani `release.yml`
  licence k binárkám nepřikládají. **To je mezera**, týká se i `zod` (MIT). Řešení je mimo
  rozsah tohoto ADR a revize (patří do `scripts/build-binaries.ts`, `Dockerfile`, `release.yml`):
  vygenerovat `THIRD_PARTY_NOTICES` z licencí zabalených závislostí a přiložit je k binárkám a
  do image.
- Upstream nijak neomezuje další vydávání (MIT). Nepotřebujeme jeho souhlas, jen zachovat
  oznámení. Pokud forkujeme a publikujeme pod vlastním jménem, uvedeme původ v README forku.

## Co jsme při revizi knihovny viděli

Čtení `dist` verze 0.4.0 (viz docs/AUDIT.md). Nic z toho nevedlo k přijetí podvržené odpovědi:

- Kontrola digestu těla, shoda `URI` reference s `wsu:Id` těla a přesně jedna `Reference` jsou
  ve všech cestách k `accepted`; tělo, ze kterého se čte `Odpoved`, je totéž, které se hashuje.
- `uuid_zpravy` se u potvrzení porovnává s požadavkem. U chybových odpovědí ne (nejsou
  podepsané); to doplňuje náš transport.
- Chybová odpověď „příliš velká“ se používá pro požadavek i odpověď; náš transport je teď
  rozlišuje.
- XML parser je rekurzivní bez omezení hloubky; ochranou je limit 1 MB na tělo a zachycení
  přetečení zásobníku. Náš test posílá 130 000 vnořených prvků a výsledek je `uncertain`.
- C14N nezahrnuje instrukce zpracování a nedědí `xml:*` atributy. Pro strukturu odpovědí EET
  to nevadí, poznamenává to i upstream v komentáři. Pokud GFŘ změní profil, je to důvod ke
  kontrole (spouštěč 6).

## Důsledky

- Nic se nemění v kódu. Pin, integrita a pravidlo „upgrade jen přes PR“ už platí.
- Riziko jediného správce se nesnižuje, ale má definovaná kritéria a postup, takže reakce není
  improvizace.
- Mezeru v oznámení licencí třetích stran je třeba uzavřít před zveřejněním binárek.
- Kdy rozhodnutí přehodnotit: zapnul se některý ze spouštěčů, vydala se verze 1.0 knihovny,
  přibyl druhý maintainer (riziko klesá), nebo se zjistí, že jí GFŘ nebo jiný integrátor věří
  víc, než dokládají naše testy.
