# SMOKES - CryptoPill Core

> Replace `<DB_URL>`, `<SESSION_ID>` as needed.

## CIN ingestion suite (entry → DB → pipeline → API)

```
CIN_RUNTIME_SESSION_ID=<SESSION_ID> pnpm tsx src/scripts/smoke/cin-ingestion-suite.ts
# or via package.json scripts
CIN_RUNTIME_SESSION_ID=<SESSION_ID> pnpm smoke:cin:suite
# full sequence (entrypoint, db, job tick, pipeline, core, client)
CIN_RUNTIME_SESSION_ID=<SESSION_ID> pnpm smoke:cin:all
```

Options:
- `CIN_SMOKE_BASE_URL` (default `http://localhost:3000`)
- `CIN_SMOKE_ACCOUNT_SCOPE` (default `__env__`)
- `CIN_SMOKE_MAX_STALE_MINUTES` (default `60`)
- `CIN_SMOKE_REQUIRE_BINANCE=1` to fail if Binance account check is unreachable
- `CIN_SMOKE_SKIP_API=1` to skip client API calls

Checks: core tables exist, runtime session is registered, Binance entrypoint reachable, server health route up, account_trades are fresh, pipeline (import moves + balances), client API (balances + moves).

## Matrices / str-aux ingestion smokes

- Persist + gaps recompute (DB only):  
  `pnpm smoke:mat:persist`
- IDHR bins sanity (DB only):  
  `pnpm smoke:mat:idhr` (env: `SYMBOL`, `LIMIT`, `DATABASE_URL`/`POSTGRES_URL`)
- Sampling HTTP endpoint (requires dev/prod server running):  
  `pnpm smoke:mat:sampling` (env: `ORIGIN`, `SYMBOLS`, `LIMIT`)
- End-to-end ingestion + matrices (pulls klines/tickers via public API and checks latest matrices):  
  `pnpm smoke:mat:ingestion`  
  Env: `MATRIX_SMOKE_SYMBOLS` (comma list), `MATRIX_SMOKE_MAX_SYMBOLS` (default 3), `MATRIX_SMOKE_KLINES_INTERVAL` (default 1m), `MATRIX_SMOKE_WINDOW` (default 1h), `MATRIX_SMOKE_SKIP_MATRICES=1` to only check market.klines.
- Full matrices bundle:  
  `pnpm smoke:mat:all`

## 0) Schema & Seeds

### 0.1 Apply DDL (packs)
psql "<DB_URL>" -f db/ddl/cin-aux-pack.sql

### 0.2 Seed universe & demo session
psql "<DB_URL>" -f db/seeds/0001_seed_universe.sql
# (optional) run helper to snapshot universe, combos, and sample `id_pct`
pnpm ts-node scripts/seed.ts
# outputs: { "session_id": "..." }

---

## 1) Vectors API

### 1.1 Compute & store vectors (POST)
curl -sX POST http://localhost:3000/api/str-aux/vectors \
  -H "content-type: application/json" \
  -d '{
    "session_id":"<SESSION_ID>",
    "bins":128,
    "symbols":["BTCUSDT","ETHUSDT"],
    "ohlcv_map":{
      "BTCUSDT":[{"close":100},{"close":101},{"close":102}],
      "ETHUSDT":[{"close":50},{"close":49},{"close":50}]
    }
  }' | jq

### 1.2 Read vectors (GET)
curl -s "http://localhost:3000/api/str-aux/vectors?session_id=<SESSION_ID>" | jq

Expected: two rows with vInner/vOuter/spread/vTendency.

---

## 2) MEA (stub logic OK)

### 2.1 Compute MEA per symbol
curl -sX POST http://localhost:3000/api/mea \
  -H "content-type: application/json" \
  -d '{
    "session_id":"<SESSION_ID>",
    "symbols":["BTCUSDT","ETHUSDT"],
    "bulk_per_coin":{"BTCUSDT":100,"ETHUSDT":100},
    "n_of_coins":2
  }' | jq

### 2.2 Verify table
psql "<DB_URL>" -c "select session_id, symbol, value, components from mea_result where session_id = '<SESSION_ID>';"

Expected: one row per symbol with value and components.

---

## 3) OPS (paper trading)

### 3.1 Place a paper order
curl -sX POST http://localhost:3000/api/ops/place \
  -H "content-type: application/json" \
  -d '{
    "session_id":"<SESSION_ID>",
    "symbol":"BTCUSDT",
    "side":"buy",
    "qty":"0.01"
  }' | jq

### 3.2 Check order & fill
psql "<DB_URL>" -c "select status, symbol, qty, px from ops_order order by created_at desc limit 5;"
psql "<DB_URL>" -c "select symbol, qty, px, fee from ops_fill order by created_at desc limit 5;"

Expected: order filled with a synthetic price (from vectors proxy if px not given).

---

## 4) CIN Grid (aᵢⱼ with j = profit, imprint, luggage)

### 4.1 Create a cycle
psql "<DB_URL>" -c "insert into cin_cycle(session_id,label) values ('<SESSION_ID>','#1') returning cycle_id;"

### 4.2 Upsert three metrics for a symbol
psql "<DB_URL>" -c "
insert into cin_ledger(session_id,cycle_id,symbol,metric,value) values
('<SESSION_ID>','<CYCLE_ID>','BTCUSDT','profit',10),
('<SESSION_ID>','<CYCLE_ID>','BTCUSDT','imprint',0.30),
('<SESSION_ID>','<CYCLE_ID>','BTCUSDT','luggage',1.20)
on conflict do nothing;
"

### 4.3 Read grid view via API
curl -s "http://localhost:3000/api/cin-aux/grid?session_id=<SESSION_ID>&cycle_id=<CYCLE_ID>" | jq

Expected: row `{ symbol: BTCUSDT, profit: 10, imprint: 0.3, luggage: 1.2 }`.

---

## 5) Matrix Registry quick check

### 5.1 Verify `id_pct` registry & cells
psql "<DB_URL>" -c "
select r.name, r.symbol, count(c.*) cells
from mat_registry r
left join mat_cell c on c.mat_id = r.mat_id
where r.session_id = '<SESSION_ID>'
group by 1,2;
"

Expected: at least one `id_pct` entry (BTCUSDT) with a few cells.

