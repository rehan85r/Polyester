# Polyester MCP Connector

Private MCP server for read-only Polyester Testnet account access, deployed on Vercel.

## Deployment

- Hosting: Vercel (Node.js serverless function)
- MCP endpoint: `/api/mcp`
- Deployment source: GitHub branch `main`
- Runtime: Node.js 22
- MCP transport: Streamable HTTP, stateless per request

The Vercel function is implemented in `api/mcp.ts` and routed by `vercel.json`.

## Environment variables

Configure these in the Vercel project settings for Preview and Production:

- `MCP_BEARER_TOKEN` — strong private token used by the MCP client in the `Authorization: Bearer <token>` request header.
- `POLYESTER_API_KEY_ID` — Polyester API key ID.
- `POLYESTER_API_PRIVATE_KEY` — Ed25519 signing seed. Keep secret.
- `POLYESTER_BASE_URL` — use `https://api.testnet.polyester.com` for Testnet.

Never commit secrets or paste private keys into chat.

## Claude custom connector

- Server URL: `https://<your-vercel-deployment>/api/mcp`
- Authentication mode: No sign-in
- Request header: `Authorization: Bearer <MCP_BEARER_TOKEN>`

The MCP bearer token is separate from the Polyester API credentials.

## Available tools

- `polyester_status` — reports configuration and performs a harmless read-only API-key authentication probe.
- `polyester_get_balances` — retrieves supported token balances for the authenticated account.
- `polyester_daily_claim` — disabled; sends no request.
- `polyester_swap_quote` — disabled; sends no request.
- `polyester_execute_swap` — disabled; sends no request.

## Safety model

- No withdrawal or transfer tools are exposed.
- Trading and daily claims remain disabled.
- API credentials are read only from server environment variables.
- Read-only status and balance retrieval have been tested against Polyester Testnet.
- Do not enable trading or claims without implementing and independently testing the required signing, request validation, quote binding, expiry, slippage, and explicit confirmation safeguards.
