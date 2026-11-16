# Polyester MCP Connector

Private MCP server for Polyester Testnet account access, deployed on Vercel.

## Deployment

- Hosting: Vercel (Node.js serverless function)
- MCP endpoint: `/api/mcp`
- Deployment source: GitHub branch `main`
- Runtime: Node.js 22
- MCP transport: Streamable HTTP, stateless per request

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

## Enabled Polyester API permissions

The integration is limited to these four permission scopes:

| Permission | Access | MCP tools |
| --- | --- | --- |
| Spot Trading | Write | `polyester_swap_quote`, `polyester_execute_swap`, `polyester_get_swap` |
| Daily Status | Read | `polyester_daily_claim_status` |
| Daily Claim | Write | `polyester_claim_daily_reward` |
| Balances | Read | `polyester_get_balances` |

No VIP Status, Checkpoints, withdrawal, or unrelated API operations are exposed.

## Safety model

- Daily claim execution requires the exact `CLAIM_DAILY_REWARD` confirmation.
- Swap execution requires the exact `CONFIRM_SWAP` confirmation, a quote expiry, minimum output and an idempotency key.
- Swap quote generation and swap status retrieval are read-only.
- No claim or trade is executed automatically.
- API credentials are read only from server environment variables.
