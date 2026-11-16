# Polyester MCP Connector

Private MCP server for Polyester Testnet automation.

## Safety model
- No withdrawal or transfer tools are exposed.
- Swap execution must be explicitly confirmed by the user.
- API credentials are read only from server environment variables.
- Never commit secrets or paste private keys into chat.
- Until the official signing/authentication and ConnectRPC request schemas are verified, Polyester operations remain disabled (fail closed).

## Railway
Set `PORT` automatically via Railway. Configure the remaining variables only after verifying the exact key format and authentication procedure in Polyester's official docs. Generate a strong `MCP_BEARER_TOKEN` and keep it private.

## MCP endpoint
`/mcp` (Streamable HTTP). Health check: `/health`.

## Current status
MCP transport scaffold only. Verified Testnet API host: `https://api.testnet.polyester.com`. Daily claims and swap methods are documented, but the connector will remain fail-closed until their exact generated ConnectRPC contracts and signed transport are implemented and tested.
