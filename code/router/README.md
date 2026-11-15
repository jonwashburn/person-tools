# code/router: askpeople-api

The router an agent talks to: the HTTP API (`/v1/...`), the MCP server (`/mcp`), the discovery file
(`/.well-known/<wire_prefix>.json`). Cloudflare Pages Functions + D1 (`DB`) + R2 (`MEDIA`).

- `functions/[[path]].js` sends every path to `src/app.js`.
- `src/screening/` is trust's (shipped from its READY copy by `bin/golive`; a missing module makes every real_ call HOLD).
- `src/build_info.js`, `src/canon_words.json`, `src/canon_terms.json`, `src/openapi_spec.json` and `src/card_fixtures.json`
  are written by `bin/golive` at build time; the copies here are stand-ins for local checks.
- `schema/*.sql` are applied in order by `bin/golive` (additive only: a rollback must still run on the newer schema).
  `schema_pending/` holds tables that wait for their row in `policy/DATA.md` (no table is made before its row).
- `src/pools/` holds the outside pools (adapters): the contract is `ADAPTERS.md`, the Prolific steps `PROLIFIC_GO_LIVE.md`.
- `checks/mcp_sdk_client.py` drives the live server with the official MCP Python SDK (modern, handshake and keyless roads).

## Beyond the standard (this server's own routes)

- `POST /v1/members/{token}/feedback` — a tester's note to the operator (deleted by the member's one-tap leave).
- `PUT|GET|DELETE /v1/pools/{pool}/account` — a principal's own account with an outside pool (live keys only for a real
  token; the token is sealed at rest and only its last four characters are ever shown).
- `POST /v1/arrivals/{token}` — a person an outside pool sends, posted by the runner's `/p/<token>` page.
- `POST /v1/topups`, `POST /v1/topups/webhook` — top-ups behind a stand-in processor (no processor is connected).
- `/internal/*` — the operator's: `tick` (settle and delete on time; also run from ordinary traffic at most every 10
  minutes), `keys`, `keys/demo` (the front page's server-side mint), `keys/suspend` (`{"all_live": true}` stops every
  live key: `bin/real_keys_off --yes`), `members`, `calls/{id}`, `card_fixtures`, `selftest`.

## Secrets (project secrets, pushed by `bin/golive` from `~/.config/humancall/`)

`router.env`: RECEIPT_KEY_PKCS8, SEAT_SECRET, TICK_TOKEN, ADMIN_TOKEN, POOL_TOKEN_KEY. `vapid.env`: the ring's VAPID keys.
`demo_mint.env`: DEMO_MINT_TOKEN (the site holds the same value). `team_check.env`: TEAM_CHECK_TOKEN (the team's own checks
send it as `x-hc-team-check`; it lifts only the per-address hourly limits). Set by hand when their step comes:
WEBHOOK_SECRET (the card processor), PROLIFIC_TOKEN and PROLIFIC_MODE=live, PROLIFIC_PRINCIPAL_ACCOUNTS=on.
