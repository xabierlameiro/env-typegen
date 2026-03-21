import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type EvidenceSignature = {
  version: 1;
  keyId: string;
  algorithm: "hmac-sha256";
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

let nonProductionSigningSecret: string | undefined;

function resolveSigningSecret(secret: string | undefined): string {
  if (secret !== undefined && secret.length > 0) {
    return secret;
  }

  const envSecret = process.env.ENV_TYPEGEN_EVIDENCE_SIGNING_KEY;
  if (envSecret !== undefined && envSecret.length > 0) {
    return envSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ENV_TYPEGEN_EVIDENCE_SIGNING_KEY is required in production for evidence signing.",
    );
  }

  if (nonProductionSigningSecret === undefined) {
    nonProductionSigningSecret = randomBytes(32).toString("hex");
  }

  return nonProductionSigningSecret;
}

export function signEvidenceHash(params: {
  bundleHash: string;
  lifecycleHash: string;
  secret?: string;
  keyId?: string;
  signedAt?: string;
}): EvidenceSignature {
  const payloadHash = `${params.bundleHash}:${params.lifecycleHash}`;
  const secret = resolveSigningSecret(params.secret);
  const signature = createHmac("sha256", secret).update(payloadHash, "utf8").digest("hex");
  const signatureId = toHexDigest(`${params.keyId ?? "default"}:${signature}`).slice(0, 24);

  return {
    version: 1,
    keyId: params.keyId ?? "default",
    algorithm: "hmac-sha256",
    payloadHash,
    signature,
    signatureId,
    signedAt: params.signedAt ?? new Date().toISOString(),
  };
}

export function verifyEvidenceSignature(params: {
  bundleHash: string;
  lifecycleHash: string;
  signature: EvidenceSignature;
  secret?: string;
}): boolean {
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
