import express from "express";
import { z } from "zod";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { getSigningKeyStatus, probePolyesterApiKey } from "./polyester-auth.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const bearer = process.env.MCP_BEARER_TOKEN;
if (!bearer || bearer.length < 32) {
  throw new Error("MCP_BEARER_TOKEN must be set to a random value of at least 32 characters");
}

function authorized(header?: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(bearer!);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function createServer() {
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
          note: "The probe calls ListApiKeys and discards its response body. Swap and claim remain disabled."
        }, null, 2)
      }]
    };
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

app.get("/health", (_req, res) => res.status(200).json({ ok: true, service: "polyester-mcp" }));

const transports = new Map<string, StreamableHTTPServerTransport>();
app.post("/mcp", async (req, res) => {
  if (!authorized(req.header("authorization"))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const sessionId = req.header("mcp-session-id");
  try {
    let transport: StreamableHTTPServerTransport;
    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomBytes(24).toString("hex"),
        onsessioninitialized: (id) => { transports.set(id, transport); }
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) transports.delete(id);
      };
      await createServer().connect(transport);
    } else {
      res.status(400).json({ error: "Missing or invalid MCP session" });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed", error);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/mcp", (_req, res) => res.status(405).send("MCP GET stream is not enabled"));
app.delete("/mcp", async (req, res) => {
  if (!authorized(req.header("authorization"))) return res.status(401).end();
  const id = req.header("mcp-session-id");
  const transport = id ? transports.get(id) : undefined;
  if (transport) await transport.close();
  res.status(200).end();
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "0.0.0.0", () => console.log(`Polyester MCP listening on :${port}`));
