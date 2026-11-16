import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getPolyesterBalances, polyesterConnectRpc } from "../src/polyester-auth.js";

type VercelRequest = IncomingMessage & { body?: unknown };

function isAuthorized(header: string | string[] | undefined): boolean {
  const expectedToken = process.env.MCP_BEARER_TOKEN;
  if (!expectedToken || expectedToken.length < 32 || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function createServer(): McpServer {
  const server = new McpServer({ name: "polyester-mcp", version: "0.2.0" });

  server.registerTool("polyester_get_balances", {
    title: "Check Polyester testnet token balances",
    description: "Read-only balance lookup. Does not move funds.",
    inputSchema: {}
  }, async () => {
    try {
      const balances = await getPolyesterBalances();
      return { content: [{ type: "text", text: JSON.stringify({
        network: "Polyester Testnet", accountScope: "authenticated root account", balanceCount: balances.length, balances
      }, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Unable to retrieve balances" }] };
    }
  });

  server.registerTool("polyester_daily_claim_status", {
    title: "Check Polyester daily reward status",
    description: "Read-only: checks today's root-account reward, claim state, reset time and reward assets.",
    inputSchema: {}
  }, async () => {
    try {
      const result = await polyesterConnectRpc("claims.v1.ClaimsService/GetDailyClaimStatus", {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Unable to check daily claim status" }] };
    }
  });

  server.registerTool("polyester_claim_daily_reward", {
    title: "Claim Polyester daily reward",
    description: "Claims today's reward to the authenticated root account. This moves the reward and requires the exact confirmation string CLAIM_DAILY_REWARD.",
    inputSchema: { confirmation: z.literal("CLAIM_DAILY_REWARD") }
  }, async ({ confirmation }) => {
    if (confirmation !== "CLAIM_DAILY_REWARD") return { isError: true, content: [{ type: "text", text: "Claim not confirmed. No request was sent." }] };
    try {
      const result = await polyesterConnectRpc("claims.v1.ClaimsService/ClaimDailyReward", {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Daily reward claim failed" }] };
    }
  });

  return server;
}

export default async function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405; res.setHeader("Allow", "POST"); res.end("Method Not Allowed"); return;
  }
  if (!isAuthorized(req.headers.authorization)) {
    res.statusCode = 401; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Unauthorized" })); return;
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await createServer().connect(transport);
    await transport.handleRequest(req as never, res as never, req.body);
  } catch (error) {
    console.error("Polyester MCP request failed", error);
    if (!res.headersSent) { res.statusCode = 500; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "Internal server error" })); }
  } finally {
    await transport.close().catch(() => undefined);
  }
}
