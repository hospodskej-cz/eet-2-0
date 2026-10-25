# ADR-003: Fronta a pravidla doposílání

- **Stav:** přijato (fáze 4, 25. 10. 2026). Doposlání po ztracené odpovědi ověřeno živě na
  playgroundu (SPEC_NOTES §15).
- **Rozsah:** `packages/queue`. Řeší OQ1, OQ2 a OQ5 ze
  [SPEC_NOTES](SPEC_NOTES.md#14-otevřené-otázky). Kontrakt pro integrátory je v [QUEUE](QUEUE.md).

## Kontext

Pravidla odesílání shrnuje [SPEC_NOTES §11](SPEC_NOTES.md#11-pravidla-odesílání-a-opakování):

| Pravidlo                                                                                   | Zdroj             |
| ------------------------------------------------------------------------------------------ | ----------------- |
| První pokus nejpozději v okamžiku tržby                                                    | M 1.3             |
| Žádná bezdůvodná kumulace                                                                  | M 1.2             |
| Opakovat, dokud nedorazí POK, stejně, ať server zprávu přijal, nebo se ztratila odpověď    | M 1.3             |
| Při opakování nové `uuid_zpravy` a `dat_odesl`, `prvni_zaslani=false`, `<Data>` beze změny | R §3.3.3.1, M 1.1 |
| Doposlat do 48 h, povinnost trvá i potom                                                   | ZoET §20          |
| Zpráva se stejnými šesti údaji je tatáž tržba, ale dostane vlastní POK                     | R §4, R §2.1      |

Zadání chce: nejdřív uložit, pak odeslat; režimy `sync` a `async`; exponenciální backoff;
`retryUncertain` s výchozí hodnotou zdůvodněnou v tomto ADR; neopakovat odmítnuté zprávy;
`idempotencyKey`. Úložiště musí jít vyměnit (SQLite → Postgres). Cílem je knihovna, kterou si
kdokoli zabuduje do svého softwaru, proto musí fronta běžet v Bunu, Node 22.18+ i Deno 2.

## Rozhodnutí

1. **Stav záznamu je `SaleResult.status`.**
   - `queued`: tržba ještě není zaevidovaná a odešle se;
   - `uncertain`: některý pokus mohl do EET dojít a odpověď nedorazila. Tento stav zmizí jen
     s odpovědí EET;
   - `accepted` / `verification_ok` / `rejected` / `invalid`: konečné stavy (`rejected` jde
     ručně zopakovat).

2. **Rozhodovací tabulka** (`decide()` v `policy.ts`, test `policy.test.ts`):

   | Výsledek pokusu                                                                                          | Stav        | Další pokus                           |
   | -------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------- |
   | `accepted`, `verification_ok`                                                                            | konečný     | —                                     |
   | `rejected`, kód < 0 (dočasná technická chyba)                                                            | `queued`¹   | backoff                               |
   | `rejected`, kód 8, 1. a 2. výskyt                                                                        | `queued`¹   | backoff                               |
   | `rejected`, kód 8 potřetí, ostatní kódy                                                                  | `rejected`  | — (`needs_attention`)                 |
   | `not_sent` (`network`, `signer`, `aborted`)                                                              | `queued`¹   | backoff                               |
   | `not_sent` (`too_large`)                                                                                 | `invalid`   | — (`needs_attention`)                 |
   | `uncertain` (`timeout`, `network`, `aborted`, `http`, `soap_fault`, `malformed_response`), `interrupted` | `uncertain` | backoff, pokud `retryUncertain`       |
   | `uncertain` (`signature`, `environment_mismatch`)                                                        | `uncertain` | nikdy automaticky (`needs_attention`) |

   ¹ Pokud byl záznam předtím `uncertain`, zůstává `uncertain`.

3. **`retryUncertain = true` je výchozí (OQ2).** Metodika (M 1.3) chce stejné doposlání, ať
   zprávu server přijal, nebo ne. Doposlání téže tržby není nová tržba (R §4). Server jen vydá
   další POK. Opakování tedy nezpůsobí dvojí evidenci, a nečinnost by naopak porušila
   povinnost evidovat. **Ověřeno živě:** playground vydal pro doposlání se ztracenou odpovědí
   nový POK (`packages/queue/test/live`). `false` nechává nejisté záznamy k ručnímu rozhodnutí.

4. **Nikdy automaticky po nedůvěryhodné odpovědi.** U `signature` a `environment_mismatch`
   odpověděl buď podvržený server, nebo je chybně nastavený endpoint. Opakované odesílání tam
   nepomůže a mohlo by poslat další data útočníkovi.

5. **Kód 8 (OQ5):** zpráva „nebyla zpracována kvůli technické chybě nebo chybě dat“ je
   nejednoznačná. Pošle se nejvýš třikrát (`code8Attempts`), potom `rejected` k ruční kontrole.
   Kódy 2–7 a 9–999 se neopakují: zprávu je potřeba opravit, případně opravit certifikát (kód 4)
   a poslat ručně přes `retry()`.

6. **Backoff:** prodleva se zdvojnásobuje od 5 s (`initialDelayMs`) do stropu 5 min
   (`maxDelayMs`) s náhodným rozptylem ±20 %. Počet pokusů není omezený, protože povinnost
   trvá i po 48 h. Strop 5 min splňuje požadavek „bezodkladně po pominutí příčiny“ (ZoET §20)
   a přitom EET nezahltí.

7. **`prvni_zaslani=true` má jen pokus č. 1**, i když selhal nebo se spojení vůbec nenavázalo
   (M 1.3). Dvojí první odeslání tržby hlídají tři vrstvy:
   - unikátnost `saleKey` ve frontě (bod 10);
   - pravidlo `n === 1` v kódu;
   - unikátní index `eet_attempts (sale_id) WHERE prvni_zaslani = 1` v databázi.

8. **Write-ahead a výhrada (lease).**
   - Synchronní volání si záznam vezme už při vložení. Worker si bere jen splatné záznamy bez
     výhrady, a to jedním atomickým `UPDATE … RETURNING`.
   - Před odesláním se zapíše otevřený pokus (`beginAttempt`, jedna transakce).
   - Pokus se přeruší nejpozději po `leaseMs / 2`, takže výhradu nepřežije.
   - Pokud výhrada vyprší (pád procesu), pokus se uzavře jako `interrupted`. Nevíme, zda zpráva
     odešla, takže se s ním zachází jako s `uncertain`.
   - Pozdní výsledek přerušeného pokusu se nezapíše přes novější, protože `finishAttempt` je
     podmíněné.
   - SQLite běží ve WAL se `synchronous = FULL`: potvrzený zápis přežije pád procesu i stroje.

9. **Brána koncového bodu.** Když se pokus nespojí (`not_sent/network`, `uncertain/timeout`,
   `uncertain/network`), další doposílání na stejný endpoint čekají na jediný zkušební pokus
   v čase `probeAt`. Ten se při dalších selháních odkládá stejným backoffem. Jakmile EET
   odpoví, brána se otevře a čekající záznamy se pošlou hned (v rámci `concurrency`). Při
   výpadku tak nevznikne nápor N × timeout. **První pokusy brána nikdy nezdržuje** (pravidlo
   „nejpozději v okamžiku tržby“) a nezdržuje ani ruční `retry()`.

10. **Idempotence a duplicity.**
    - Stejný `idempotencyKey` a stejná tržba: vrátí se uložený záznam s varováním 1071
      a nic se neodešle. Souběžné synchronní volání počká na probíhající pokus.
    - Stejný klíč a jiná tržba: `invalid/idempotency_conflict`.
    - Bez klíče hlídá frontu `saleKey` (R §4), unikátní mimo ověřovací mód. Stejná tržba vrátí
      existující záznam (1071). Stejný klíč s jinými údaji vrátí `invalid/sale_conflict`:
      server by zprávu považoval za tutéž tržbu a rozhodnout musí integrátor.
    - Zprávy v ověřovacím módu nic neevidují, proto se nededuplikují a nemají 48h lhůtu.

11. **`async` posílá hned (OQ1).** Uložení je následované okamžitým pokusem na pozadí, i když
    worker (`start()`) neběží. Žádné umělé dávkování. `submitBatch` je pro doposílání po
    výpadku a pro migraci. Každý řádek je samostatný záznam a klíče idempotence mají tvar
    `${key}:${row}`.

12. **Úložiště za rozhraním `QueueStore`.** Všechna rozhodnutí dělá fronta. Úložiště jen drží
    záznamy a atomicky provede pět operací: vložení s kontrolou unikátnosti, převzetí
    splatných záznamů, zápis začátku pokusu, podmíněné uzavření pokusu a podmíněné uvolnění.
    - `createSqliteStore(db)` přijme `bun:sqlite` `Database` i `node:sqlite` `DatabaseSync`;
      fronta sama nic runtime-specifického neimportuje.
    - `createMemoryStore()` slouží jen pro testy.
    - Implementace Postgres projde stejnou sadou `test/store-contract.ts`. Převzetí:
      `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *`. Unikátnost
      `sale_key` zajistí částečný unikátní index jako v SQLite.

## Důsledky

- Záznam `uncertain` může na serveru znamenat dva POK pro jednu tržbu. Uložíme ten, který
  dorazil. Podle R §4 jde o tutéž tržbu, takže to evidenci nevadí.
- Po pádu procesu se nejistý pokus pozná až po vypršení výhrady (výchozí 120 s). Kratší
  `leaseMs` zrychlí obnovu, ale musí být víc než dvojnásobek `timeoutMs` transportu.
- `rawRequest` a `rawResponse` se nikdy neukládají, vrací je jen synchronní volání. Události
  (`onEvent`) nesou jen id, kódy a zprávy EET, nikdy klíče ani podpisy.
- Neověřeno: chování produkce. Skutečný výpadek EET jsme simulovali jen v testech.
