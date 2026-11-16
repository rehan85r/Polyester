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

function toE18(value: string): { hi: string; lo: string } {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error("Amount must be a positive decimal with up to 18 places");
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18));
  if (units <= 0n || units >= 1n << 128n) throw new Error("Amount is outside the supported 128-bit range");
  const mask = (1n << 64n) - 1n;
  return { hi: (units >> 64n).toString(), lo: (units & mask).toString() };
}

function requireE18(value: { hi: string; lo: string }): { hi: string; lo: string } {
  for (const part of [value.hi, value.lo]) {
    if (!/^(0|[1-9]\d*)$/.test(part) || BigInt(part) > (1n << 64n) - 1n) {
      throw new Error("Invalid 128-bit E18 amount");
    }
  }
  if (BigInt(value.hi) === 0n && BigInt(value.lo) === 0n) throw new Error("E18 amount must be positive");
  return value;
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

  server.registerTool("polyester_swap_quote", {
    title: "Get Polyester spot swap quote",
    description: "Read-only quote for a direct spot conversion. Amount is in whole asset units; slippage is 1-1000 basis points. A quote does not reserve funds or execute a trade.",
    inputSchema: {
      sourceAssetId: z.number().int().positive(),
      destinationAssetId: z.number().int().positive(),
      amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/),
      maxSlippageBps: z.number().int().min(1).max(1000)
    }
  }, async ({ sourceAssetId, destinationAssetId, amount, maxSlippageBps }) => {
    if (sourceAssetId === destinationAssetId) return { isError: true, content: [{ type: "text", text: "Source and destination assets must differ." }] };
    try {
      const result = await polyesterConnectRpc("swap.v1.SwapService/QuoteSwap", {
        terms: { sourceAssetId, destinationAssetId, amountE18: toE18(amount) },
        maxSlippageBps
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Unable to obtain swap quote" }] };
    }
  });

  server.registerTool("polyester_execute_swap", {
    title: "Execute confirmed Polyester spot swap",
    description: "Executes the exact quoted conversion after repricing and enforcing its minimum output and expiry. Requires an idempotency key and the exact confirmation string CONFIRM_SWAP. This is a real trade.",
    inputSchema: {
      sourceAssetId: z.number().int().positive(),
      destinationAssetId: z.number().int().positive(),
      amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/),
      minAmountOutE18: z.object({ hi: z.string(), lo: z.string() }),
      quoteExpiresAt: z.string().datetime(),
      idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
      confirmation: z.literal("CONFIRM_SWAP")
    }
  }, async ({ sourceAssetId, destinationAssetId, amount, minAmountOutE18, quoteExpiresAt, idempotencyKey, confirmation }) => {
    if (confirmation !== "CONFIRM_SWAP") return { isError: true, content: [{ type: "text", text: "Swap not confirmed. No order was submitted." }] };
    if (sourceAssetId === destinationAssetId) return { isError: true, content: [{ type: "text", text: "Source and destination assets must differ." }] };
    try {
      const result = await polyesterConnectRpc("swap.v1.SwapService/CreateSwap", {
        idempotencyKey,
        terms: { sourceAssetId, destinationAssetId, amountE18: toE18(amount) },
        minAmountOutE18: requireE18(minAmountOutE18),
        quoteExpiresAt
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Swap execution failed" }] };
    }
  });

  server.registerTool("polyester_get_swap", {
    title: "Check Polyester swap execution",
    description: "Read-only: retrieves a swap by its swap ID or idempotency key. Use it to reconcile execution until terminal.",
    inputSchema: {
      swapId: z.string().optional(),
      idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional()
    }
  }, async ({ swapId, idempotencyKey }) => {
    if ((!swapId && !idempotencyKey) || (swapId && idempotencyKey)) return { isError: true, content: [{ type: "text", text: "Provide exactly one of swapId or idempotencyKey." }] };
    try {
      const result = await polyesterConnectRpc("swap.v1.SwapService/GetSwap", swapId ? { swapId } : { idempotencyKey });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Unable to retrieve swap" }] };
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
