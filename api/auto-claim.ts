import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { polyesterConnectRpc } from "../src/polyester-auth.js";

type ClaimResponse = { state?: string; claimId?: string; claimedAt?: string; resetAt?: string };

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set. */
function isAuthorized(header: string | string[] | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/** Claims today's Polyester reward once per UTC day. Triggered by Vercel Cron. */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "Method Not Allowed" });
  }
  if (!isAuthorized(req.headers.authorization)) return json(res, 401, { error: "Unauthorized" });

  try {
    const status = await polyesterConnectRpc<ClaimResponse>("claims.v1.ClaimsService/GetDailyClaimStatus", {});
    if (status.state !== "CLAIM_AVAILABLE") {
      return json(res, 200, { claimed: false, state: status.state ?? "UNKNOWN", resetAt: status.resetAt });
    }
    const result = await polyesterConnectRpc<ClaimResponse>("claims.v1.ClaimsService/ClaimDailyReward", {});
    return json(res, 200, { claimed: true, state: result.state, claimId: result.claimId, claimedAt: result.claimedAt });
  } catch (error) {
    console.error("Auto daily claim failed", error instanceof Error ? error.message : error);
    return json(res, 500, { claimed: false, error: "Daily claim failed" });
  }
}
