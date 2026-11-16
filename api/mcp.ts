import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getSigningKeyStatus, getPolyesterBalances, probePolyesterApiKey } from "../src/polyester-auth.js";

type VercelRequest = IncomingMessage & { body?: unknown };

function isAuthorized(header: string | string[] | undefined): boolean {
  const expectedToken = process.env.MCP_BEARER_TOKEN;
  if (!expectedToken || expectedToken.length < 32 || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function createServer(): McpServer {
  const server = new McpServer({ name: "polyester-mcp", version: "0.1.0" });

  server.registerTool("polyester_status", {
    title: "Polyester integration status",
    description: "Reports connector configuration and performs a harmless signed read-only API-key authentication probe. Does not change funds.",
    inputSchema: {}
  }, async () => {
    let apiKeyProbe: Awaited<ReturnType<typeof probePolyesterApiKey>> | { error: string };
    try {
      apiKeyProbe = await probePolyesterApiKey();
    } catch (error) {
      apiKeyProbe = { error: error instanceof Error ? error.message : "API key probe failed" };
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          service: "polyester-mcp",
          polyesterBaseUrl: process.env.POLYESTER_BASE_URL ?? "https://api.testnet.polyester.com",
          credentialsConfigured: Boolean(process.env.POLYESTER_API_KEY_ID && process.env.POLYESTER_API_PRIVATE_KEY),
          signingKey: getSigningKeyStatus(),
          apiKeyProbe,
          tradingEnabled: false,
          dailyClaimEnabled: false,
          note: "The probe calls the policy-free AuthService/Me endpoint and discards its response body. Swap and claim remain disabled."
        }, null, 2)
      }]
    };
  });

  server.registerTool("polyester_get_balances", {
    title: "Check Polyester testnet token balances",
    description: "Read-only: fetches all supported token balances for the authenticated root account, including zero balances. Shows available, funding, trading and reserved amounts. Does not move funds.",
    inputSchema: {}
  }, async () => {
    try {
      const balances = await getPolyesterBalances();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            network: "Polyester Testnet",
            accountScope: "authenticated root account",
            balanceCount: balances.length,
            balances
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: error instanceof Error ? error.message : "Unable to retrieve Polyester balances"
        }]
      };
    }
  });

  server.registerTool("polyester_daily_claim", {
    title: "Claim Polyester daily reward",
    description: "Disabled until account authorization and the official claim request are fully implemented and tested.",
    inputSchema: {}
  }, async () => ({
    isError: true,
    content: [{ type: "text", text: "Daily claim is not enabled yet. No request was sent." }]
  }));

  server.registerTool("polyester_swap_quote", {
    title: "Get Polyester swap quote",
    description: "Disabled until signed ConnectRPC transport and quote request validation are implemented.",
    inputSchema: {
      fromAsset: z.string().min(1),
      toAsset: z.string().min(1),
      amount: z.string().regex(/^\\d+(\\.\\d+)?$/)
    }
  }, async () => ({
    isError: true,
    content: [{ type: "text", text: "Swap quote is not enabled yet. No request was sent." }]
  }));

  server.registerTool("polyester_execute_swap", {
    title: "Execute confirmed Polyester swap",
    description: "Disabled. Will require an explicit confirmation and a validated, unexpired quote.",
    inputSchema: {
      quoteId: z.string().min(1),
      confirmation: z.literal("CONFIRM_SWAP")
    }
  }, async () => ({
    isError: true,
    content: [{ type: "text", text: "Swap execution is disabled until signing, quote binding, expiry, slippage and confirmation handling are implemented and tested. No transaction was sent." }]
  }));

  return server;
}

export default async function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  if (!isAuthorized(req.headers.authorization)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await createServer().connect(transport);
    await transport.handleRequest(req as never, res as never, req.body);
  } catch (error) {
    console.error("Polyester MCP request failed", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  } finally {
    await transport.close().catch(() => undefined);
  }
}
