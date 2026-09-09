import { createHash, createHmac, createPrivateKey, createPublicKey, randomUUID, sign, timingSafeEqual } from "node:crypto";
import { serviceConfig, webhookConfig } from "./env";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyGithubWebhook(rawBody: Buffer, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", webhookConfig().githubWebhookSecret).update(rawBody).digest("hex"), "hex");
  const suppliedHex = signatureHeader.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(suppliedHex)) return false;
  const supplied = Buffer.from(suppliedHex, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

export type EntitlementClaims = {
  issuer: string;
  subject: { github_account_id: number; github_account_type: string; github_login: string };
  principal?: { github_user_id: number; github_login: string };
  license_id: string;
  plan_id: string;
  seats: number | null;
  entitlements: string[];
  issued_at: string;
  not_before: string;
  expires_at: string | null;
};

export function signEntitlement(claims: EntitlementClaims) {
  const cfg = serviceConfig();
  const unsigned = {
    format_version: claims.principal ? 2 : 1,
    ...claims,
    jti: randomUUID(),
    key_id: cfg.entitlementKeyId,
    algorithm: "Ed25519",
  };
  const payload = Buffer.from(canonicalize(unsigned));
  const privateKey = createPrivateKey(cfg.entitlementPrivateKeyPem);
  const signature = sign(null, payload, privateKey).toString("base64url");
  return { ...unsigned, signature };
}

export function publicSigningKey() {
  const cfg = serviceConfig();
  const privateKey = createPrivateKey(cfg.entitlementPrivateKeyPem);
  const publicKey = createPublicKey(privateKey);
  return {
    key_id: cfg.entitlementKeyId,
    algorithm: "Ed25519",
    public_key_jwk: publicKey.export({ format: "jwk" }),
  };
}
