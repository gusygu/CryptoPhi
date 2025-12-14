# Badge-scoped API sanity checks

- User A universe: `BNB,BTC,ETH,USDT`; User B universe: `ADA,DOGE,SOL,XPL,USDT`.
- Verify `/api/<badgeA>/matrices/latest` (and `moo-aux`) return `x-universe` and payload coins matching only A; switch to `<badgeB>` and confirm it stays on B even if A updates settings last.
- Load matrices UI for each logged-in user and confirm the displayed universe matches the badge owner.
- Hit `/api/<badge>/debug/context` in a browser to confirm badge, resolved userId (from session_map when no cookie), DB context, and effective settings.
