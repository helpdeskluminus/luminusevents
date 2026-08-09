export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

function secret(): string {
  const s = Deno.env.get("QR_HMAC_SECRET");
  if (!s) throw new Error("QR_HMAC_SECRET is not configured");
  return s;
}

/**
 * Builds an opaque, tamper-proof ticket token: <payload>.<hmac>
 * payload = base64url(registrationId|competitionId|nonce)
 * The token is never guessable and any modification invalidates the signature.
 */
export async function signTicketToken(registrationId: string, competitionId: string): Promise<string> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const payload = b64url(enc.encode(`${registrationId}|${competitionId}|${nonce}`));
  return `${payload}.${await hmac(payload, secret())}`;
}

/** Constant-time-ish verification of a scanned token. Returns false on any tampering. */
export async function verifyTicketToken(token: string): Promise<boolean> {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = await hmac(payload, secret());
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/**
 * Best-effort client IP from standard proxy headers (Supabase Edge Functions
 * run behind a proxy that sets these). Falls back to "unknown" so rate
 * limiting degrades to "shared bucket" rather than throwing.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
}

/** Salted, non-reversible hash of an IP - never store the raw address. */
export async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get("QR_HMAC_SECRET") ?? "fallback-salt";
  return hmac(ip, salt);
}

export function generateTicketCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "TF-" + Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join("");
}
