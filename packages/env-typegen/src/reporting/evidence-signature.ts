import { createHmac, timingSafeEqual } from "node:crypto";

export const UNSIGNED_EVIDENCE_KEY_ID = "unsigned";

export type EvidenceSignature = {
  version: 1;
  /** `unsigned` when no signing key was configured. */
  keyId: string;
  /** `none` marks evidence that carries no signature and can never be verified. */
  algorithm: "hmac-sha256" | "none";
  payloadHash: string;
  signature: string;
  signatureId: string;
  signedAt: string;
};

function toHexDigest(input: string): string {
  return createHmac("sha256", "env-typegen:evidence:signature-id")
    .update(input, "utf8")
    .digest("hex");
}

function isTimingSafeSignatureMatch(params: {
  expectedSignature: string;
  providedSignature: string;
}): boolean {
  const expectedSignatureBuffer = Buffer.from(params.expectedSignature, "utf8");
  const providedSignatureBuffer = Buffer.from(params.providedSignature, "utf8");

  if (expectedSignatureBuffer.length !== providedSignatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedSignatureBuffer, providedSignatureBuffer);
}

// The key is never generated here. A signature made with a per-process random key
// cannot be verified by anyone once the process exits.
function resolveSigningSecret(secret: string | undefined): string | undefined {
  if (secret !== undefined && secret.length > 0) {
    return secret;
  }

  const envSecret = process.env.ENV_TYPEGEN_EVIDENCE_SIGNING_KEY;
  if (envSecret !== undefined && envSecret.length > 0) {
    return envSecret;
  }

  return undefined;
}

export function hasEvidenceSigningKey(secret?: string): boolean {
  return resolveSigningSecret(secret) !== undefined;
}

export function signEvidenceHash(params: {
  bundleHash: string;
  lifecycleHash: string;
  secret?: string;
  keyId?: string;
  signedAt?: string;
}): EvidenceSignature {
  const payloadHash = `${params.bundleHash}:${params.lifecycleHash}`;
  const signedAt = params.signedAt ?? new Date().toISOString();
  const secret = resolveSigningSecret(params.secret);

  if (secret === undefined) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ENV_TYPEGEN_EVIDENCE_SIGNING_KEY is required in production for evidence signing.",
      );
    }

    return {
      version: 1,
      keyId: UNSIGNED_EVIDENCE_KEY_ID,
      algorithm: "none",
      payloadHash,
      signature: "",
      signatureId: toHexDigest(`${UNSIGNED_EVIDENCE_KEY_ID}:${payloadHash}`).slice(0, 24),
      signedAt,
    };
  }

  const signature = createHmac("sha256", secret).update(payloadHash, "utf8").digest("hex");
  const signatureId = toHexDigest(`${params.keyId ?? "default"}:${signature}`).slice(0, 24);

  return {
    version: 1,
    keyId: params.keyId ?? "default",
    algorithm: "hmac-sha256",
    payloadHash,
    signature,
    signatureId,
    signedAt,
  };
}

export function verifyEvidenceSignature(params: {
  bundleHash: string;
  lifecycleHash: string;
  signature: EvidenceSignature;
  secret?: string;
}): boolean {
  if (params.signature.algorithm !== "hmac-sha256" || !hasEvidenceSigningKey(params.secret)) {
    return false;
  }

  const expected = signEvidenceHash({
    bundleHash: params.bundleHash,
    lifecycleHash: params.lifecycleHash,
    ...(params.secret === undefined ? {} : { secret: params.secret }),
    keyId: params.signature.keyId,
    signedAt: params.signature.signedAt,
  });

  return isTimingSafeSignatureMatch({
    expectedSignature: expected.signature,
    providedSignature: params.signature.signature,
  });
}
