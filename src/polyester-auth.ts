import {
  createHash,
  createPrivateKey,
  sign as ed25519Sign,
  type KeyObject
} from "node:crypto";

const ED25519_PKCS8_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export type PolyesterSignedRequest = {
  url: string;
  method: string;
  body?: string | Buffer;
  recvWindowMs?: number;
};

function loadPrivateKey(): KeyObject {
  const configured = process.env.POLYESTER_API_PRIVATE_KEY?.trim();
  if (!configured) throw new Error("POLYESTER_API_PRIVATE_KEY is not configured");

  // Polyester key material supplied as 64 hexadecimal characters is treated as a 32-byte Ed25519 seed.
  if (!/^[0-9a-fA-F]{64}$/.test(configured)) {
    throw new Error("POLYESTER_API_PRIVATE_KEY must be a 64-character hexadecimal Ed25519 seed");
  }

  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, Buffer.from(configured, "hex")]),
    format: "der",
    type: "pkcs8"
  });
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function canonicalQuery(rawQuery: string): string {
  if (!rawQuery) return "";
  const pairs = rawQuery.split("&").map((part) => {
    const separator = part.indexOf("=");
    const rawKey = separator === -1 ? part : part.slice(0, separator);
    const rawValue = separator === -1 ? "" : part.slice(separator + 1);
    return [decodeURIComponent(rawKey.replace(/\+/g, " ")), decodeURIComponent(rawValue.replace(/\+/g, " "))] as const;
  });

  pairs.sort(([keyA, valueA], [keyB, valueB]) =>
    keyA < keyB ? -1 : keyA > keyB ? 1 : valueA < valueB ? -1 : valueA > valueB ? 1 : 0
  );
  return pairs.map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`).join("&");
}

export function createPolyesterAuthHeaders(request: PolyesterSignedRequest): Record<string, string> {
  const keyId = process.env.POLYESTER_API_KEY_ID?.trim();
  if (!keyId) throw new Error("POLYESTER_API_KEY_ID is not configured");

  const privateKey = loadPrivateKey();
  const target = new URL(request.url);
  const method = request.method.toUpperCase();
  const body = request.body === undefined ? Buffer.alloc(0) : Buffer.from(request.body);
  const timestamp = Date.now().toString();
  const recvWindow = request.recvWindowMs;

  if (recvWindow !== undefined && (!Number.isInteger(recvWindow) || recvWindow < 1 || recvWindow > 60000)) {
    throw new Error("recvWindowMs must be an integer from 1 to 60000");
  }

  const path = decodeURIComponent(target.pathname);
  const query = canonicalQuery(target.search.length > 1 ? target.search.slice(1) : "");
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = [
    timestamp,
    ...(recvWindow === undefined ? [] : [String(recvWindow)]),
    method,
    path,
    query,
    bodyHash
  ].join("\n");

  const signature = ed25519Sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");
  const headers: Record<string, string> = {
    "X-API-KEY-ID": keyId,
    "X-API-TIMESTAMP": timestamp,
    "X-API-SIGNATURE": signature
  };
  if (recvWindow !== undefined) headers["X-API-RECV-WINDOW"] = String(recvWindow);
  return headers;
}

export function getSigningKeyStatus(): { configured: boolean; validFormat: boolean; format: string } {
  const value = process.env.POLYESTER_API_PRIVATE_KEY?.trim() ?? "";
  if (!value) return { configured: false, validFormat: false, format: "missing" };
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    try {
      loadPrivateKey();
      return { configured: true, validFormat: true, format: "ed25519-seed-hex-32-byte" };
    } catch {
      return { configured: true, validFormat: false, format: "invalid" };
    }
  }
  return { configured: true, validFormat: false, format: "unsupported" };
}

/**
 * Performs a harmless authenticated read probe. The response body is discarded; only the HTTP status is used so account identity and key metadata are never exposed. The Me endpoint accepts API-key authentication without a policy.
 */
export async function probePolyesterApiKey(): Promise<{
  httpStatus: number;
  authentication: "accepted" | "rejected" | "indeterminate";
  permission: "allowed" | "denied" | "unknown";
}> {
  const configuredBaseUrl = process.env.POLYESTER_BASE_URL ?? "https://api.testnet.polyester.com";
  const baseUrl = configuredBaseUrl.endsWith("/") ? configuredBaseUrl.slice(0, -1) : configuredBaseUrl;
  const url = `${baseUrl}/auth.v1.AuthService/Me`;
  const body = "{}";
  const headers = createPolyesterAuthHeaders({ url, method: "POST", body });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
      "Accept": "application/json"
    },
    body
  });
  // Consume but never return API response data.
  await response.arrayBuffer();

  if (response.status >= 200 && response.status < 300) {
    return { httpStatus: response.status, authentication: "accepted", permission: "allowed" };
  }
  if (response.status === 401) {
    return { httpStatus: response.status, authentication: "rejected", permission: "unknown" };
  }
  if (response.status === 403) {
    return { httpStatus: response.status, authentication: "accepted", permission: "denied" };
  }
  return { httpStatus: response.status, authentication: "indeterminate", permission: "unknown" };
}
