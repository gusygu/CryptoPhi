# Security (User-Friendly)

Plain-language summary of how your data is handled.

## Accounts & invites
- Each account is tied to the invite email. The email on the registration screen cannot be changed.
- Invite links are single-use. If a link is marked invalid/used, request a new one.

## Sign-in
- Session cookies are scoped to the app host (e.g., `app.cryptophi.xyz`) and are HTTP-only.

## Data protection
- Passwords and tokens are hashed before storage; plain values are not kept.
- Exchange keys (if you link them) are encrypted/hashed; not stored in plain text.
- Your settings, wallets, and preferences are isolated per account.

## If something looks off
- Use the same host you received in the invite link when signing in.
- If an invite fails, ask for a fresh link.
- If data looks stale, refresh; samplers warm up again after restarts.
