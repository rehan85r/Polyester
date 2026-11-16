# Polyester MCP Connector

Private MCP server for Polyester Testnet account access, deployed on Vercel.

## Deployment

- Hosting: Vercel (Node.js serverless function)
- MCP endpoint: `/api/mcp`
- Deployment source: GitHub branch `main`
- Runtime: Node.js 22
- MCP transport: Streamable HTTP, stateless per request

The Vercel function is implemented in `api/mcp.ts` and routed by `vercel.json`.

## Environment variables

Configure these in Vercel for Preview and Production:

- `MCP_BEARER_TOKEN` — strong private token used by the MCP client in the `Authorization: Bearer <token>` header.
- `POLYESTER_API_KEY_ID` — Polyester API key ID.
- `POLYESTER_API_PRIVATE_KEY` — Ed25519 signing seed. Keep secret.
- `POLYESTER_BASE_URL` — `https://api.testnet.polyester.com` for Testnet.

Never commit secrets or paste private keys into chat.

## Claude custom connector

- Server URL: `https://<your-vercel-deployment>/api/mcp`
- Authentication mode: No sign-in
- Request header: `Authorization: Bearer <MCP_BEARER_TOKEN>`

The MCP bearer token is separate from the Polyester API credentials.

## Available tools

- `polyester_status` — connector configuration and harmless signed API-key probe.
- `polyester_get_balances` — read-only account balances.
- `polyester_daily_claim_status` — read today's root-account reward and claim state.
- `polyester_claim_daily_reward` — claims today's reward to the root account; requires exact `CLAIM_DAILY_REWARD` confirmation.
- `polyester_swap_quote` — read-only direct spot swap quote with slippage protection.
- `polyester_execute_swap` — executes a quoted swap only with exact `CONFIRM_SWAP` confirmation, a fresh quote expiry and idempotency key.
- `polyester_get_swap` — reads swap execution status by swap ID or idempotency key.

## Safety model

- No withdrawal or external transfer tools are exposed.
- Daily reward claims and spot swaps are available only through explicit MCP tool calls.
- Claim and swap mutations require exact confirmation strings.
- Swap execution re-prices against current market depth and enforces the quote's minimum output and expiry.
- Each swap requires a caller-provided idempotency key so uncertain outcomes can be safely reconciled.
- API credentials are read only from server environment variables.
- Checkpoint reads are not exposed: Polyester documents this API as session-only, not API-key accessible.
