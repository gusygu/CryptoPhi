import { sql, withConn } from "../../../db/client";
import type { MoveParamsV2 } from "./types";

// --- sessions ---
export async function createCinSession(windowLabel: string) {
  const rows = await sql<{ session_id: number }>`
    insert into strategy_aux.cin_session(window_label)
      values (${windowLabel})
      returning session_id
  `;
  return rows[0]!.session_id;
}

export async function closeCinSessionV2(sessionId: number) {
  await sql`
    select strategy_aux.cin_close_session_v2(${sessionId})
  `;
}

export async function ensureBalanceRow(sessionId: number, assetId: string) {
  await sql`
    insert into strategy_aux.cin_balance(session_id, asset_id, opening_principal, opening_profit, principal_usdt, profit_usdt)
      values (${sessionId}, ${assetId}, 0, 0, 0, 0)
      on conflict (session_id, asset_id) do nothing
  `;
}

export async function seedBalance(
  sessionId: number,
  assetId: string,
  principalUSDT: number,
  profitUSDT: number
) {
  await ensureBalanceRow(sessionId, assetId);
  await sql`
    update strategy_aux.cin_balance
       set opening_principal = ${principalUSDT},
           opening_profit    = ${profitUSDT},
           principal_usdt    = ${principalUSDT},
           profit_usdt       = ${profitUSDT}
     where session_id = ${sessionId} and asset_id = ${assetId}
  `;
}

// --- marks ---
export async function addMark(sessionId: number, assetId: string, bulkUSDT: number, ts: Date = new Date()) {
  await sql`
    insert into strategy_aux.cin_mark(session_id, asset_id, ts, bulk_usdt)
      values (${sessionId}, ${assetId}, ${ts}, ${bulkUSDT})
      on conflict do nothing
  `;
}

// --- move v2 ---
export async function execMoveV2(p: MoveParamsV2) {
  const rows = await sql<{ strategy_aux_cin_exec_move_v2: number }>`
    select strategy_aux.cin_exec_move_v2(
      ${p.sessionId},
      ${p.ts},
      ${p.fromAsset},
      ${p.toAsset},
      ${p.executedUSDT},
      ${p.feeUSDT},
      ${p.slippageUSDT},
      ${p.refTargetUSDT ?? null},
      ${p.plannedUSDT ?? null},
      ${p.availableUSDT ?? null},
      ${p.priceFromUSDT ?? null},
      ${p.priceToUSDT ?? null},
      ${p.priceBridgeUSDT ?? null}
    )
  `;
  return rows[0]!.strategy_aux_cin_exec_move_v2;
}

// convenience: register acquisition (usually not used directly because exec_move v2 does it)
export async function registerAcquisition(
  sessionId: number, moveId: number, assetId: string, units: number, priceUSDT: number
) {
  const rows = await sql<{ strategy_aux_cin_register_acquisition: number }>`
    select strategy_aux.cin_register_acquisition(
      ${sessionId},
      ${moveId},
      ${assetId},
      ${units},
      ${priceUSDT}
    )
  `;
  return rows[0]!.strategy_aux_cin_register_acquisition;
}
