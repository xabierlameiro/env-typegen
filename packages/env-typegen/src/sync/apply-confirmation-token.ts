import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const APPLY_CONFIRMATION_TOKEN_PREFIX = "etgac";
const APPLY_CONFIRMATION_TOKEN_VERSION = "v1";
const APPLY_CONFIRMATION_DEFAULT_TTL_SECONDS = 300;
const APPLY_CONFIRMATION_MAX_TTL_SECONDS = 900;
let nonProductionConfirmationSigningSecret: string | undefined;

export type ApplyConfirmationTokenPayload = {
  version: 1;
  purpose: "sync-apply";
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  provider: string;
  environment: string;
  changeSetHash: string;
  correlationId: string;
};

export function buildSyncApplyCorrelationId(params: {
  provider: string;
  environment: string;
  mode: "dry-run" | "apply";
  changeSetHash: string;
}): string {
  const fingerprint = params.changeSetHash.slice(0, 16);
  return `${params.provider}:${params.environment}:${params.mode}:${fingerprint}`;
}

export type ApplyConfirmationTokenValidationResult = {
  isValid: boolean;
  reasons: string[];
  payload?: ApplyConfirmationTokenPayload;
};

type ConfirmationTokenSecretResolution =
  | { ok: true; secret: string }
  | { ok: false; reason: string };

function resolveConfirmationSigningSecret(
  secret: string | undefined,
): ConfirmationTokenSecretResolution {
  if (secret !== undefined && secret.length > 0) {
    return { ok: true, secret };
  }

  const envSecret = process.env.ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY;
  if (envSecret !== undefined && envSecret.length > 0) {
    return { ok: true, secret: envSecret };
  }

  if (process.env.NODE_ENV === "production") {
    return {
      ok: false,
      reason:
        "ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY is required in production for apply confirmation token validation.",
    };
  }

  if (nonProductionConfirmationSigningSecret === undefined) {
    nonProductionConfirmationSigningSecret = randomBytes(32).toString("hex");
  }

  return {
    ok: true,
    secret: nonProductionConfirmationSigningSecret,
  };
}

function encodePayload(payload: ApplyConfirmationTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function parseIsoDate(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function buildSigningInput(encodedPayload: string): string {
  return `${APPLY_CONFIRMATION_TOKEN_PREFIX}.${APPLY_CONFIRMATION_TOKEN_VERSION}.${encodedPayload}`;
}

function signTokenPayload(params: { encodedPayload: string; secret: string }): string {
  return createHmac("sha256", params.secret)
    .update(buildSigningInput(params.encodedPayload), "utf8")
    .digest("hex");
}

function isTimingSafeSignatureMatch(params: {
  expectedSignature: string;
  providedSignature: string;
}): boolean {
  const expectedBuffer = Buffer.from(params.expectedSignature, "utf8");
  const providedBuffer = Buffer.from(params.providedSignature, "utf8");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function parseToken(token: string): {
  encodedPayload: string;
  providedSignature: string;
  payload: unknown;
} {
  const segments = token.split(".");
  if (segments.length !== 4) {
    throw new Error(
      "Confirmation token format is invalid. Expected <prefix>.<version>.<payload>.<signature>.",
    );
  }

  const [prefix, version, encodedPayload, providedSignature] = segments as [
    string,
    string,
    string,
    string,
  ];
  if (prefix !== APPLY_CONFIRMATION_TOKEN_PREFIX || version !== APPLY_CONFIRMATION_TOKEN_VERSION) {
    throw new Error("Confirmation token prefix/version is invalid.");
  }

  if (!/^[a-f0-9]{64}$/u.test(providedSignature)) {
    throw new Error("Confirmation token signature must be a 64-character SHA256 hex digest.");
  }

  const decodedPayload = Buffer.from(encodedPayload, "base64url").toString("utf8");
  const payload = JSON.parse(decodedPayload) as unknown;

  return {
    encodedPayload,
    providedSignature,
    payload,
  };
}

function validateRequiredFields(
  payload: Partial<ApplyConfirmationTokenPayload>,
  reasons: string[],
): void {
  if (payload.version !== 1) {
    reasons.push("Confirmation token version must be 1.");
  }

  if (payload.purpose !== "sync-apply") {
    reasons.push("Confirmation token purpose must be sync-apply.");
  }

  if (typeof payload.nonce !== "string" || payload.nonce.length === 0) {
    reasons.push("Confirmation token nonce must be a non-empty string.");
  }
}

function validateContextBinding(params: {
  payload: Partial<ApplyConfirmationTokenPayload>;
  provider: string;
  environment: string;
  changeSetHash: string;
  expectedCorrelationId: string;
  reasons: string[];
}): void {
  if (params.payload.provider !== params.provider) {
    params.reasons.push("Confirmation token provider does not match current provider.");
  }

  if (params.payload.environment !== params.environment) {
    params.reasons.push("Confirmation token environment does not match current environment.");
  }

  if (params.payload.changeSetHash !== params.changeSetHash) {
    params.reasons.push("Confirmation token change-set hash does not match current drift state.");
  }

  if (params.payload.correlationId !== params.expectedCorrelationId) {
    params.reasons.push(
      "Confirmation token correlationId does not match current execution context.",
    );
  }
}

function validateTimestamps(params: {
  payload: Partial<ApplyConfirmationTokenPayload>;
  now: Date;
  maxTtlSeconds: number;
  reasons: string[];
}): void {
  const issuedAtMs =
    typeof params.payload.issuedAt === "string" ? parseIsoDate(params.payload.issuedAt) : null;
  if (issuedAtMs === null) {
    params.reasons.push("Confirmation token issuedAt must be a valid ISO timestamp.");
  }

  const expiresAtMs =
    typeof params.payload.expiresAt === "string" ? parseIsoDate(params.payload.expiresAt) : null;
  if (expiresAtMs === null) {
    params.reasons.push("Confirmation token expiresAt must be a valid ISO timestamp.");
    return;
  }

  if (expiresAtMs <= params.now.getTime()) {
    params.reasons.push("Confirmation token has expired and cannot be used for apply.");
  }

  if (issuedAtMs === null) {
    return;
  }

  if (expiresAtMs <= issuedAtMs) {
    params.reasons.push("Confirmation token expiresAt must be later than issuedAt.");
    return;
  }

  const ttlMs = expiresAtMs - issuedAtMs;
  if (ttlMs > params.maxTtlSeconds * 1000) {
    params.reasons.push(
      `Confirmation token TTL exceeds maximum allowed window (${params.maxTtlSeconds} seconds).`,
    );
  }
}

function validateReplay(params: {
  payload: Partial<ApplyConfirmationTokenPayload>;
  usedNonces?: Set<string>;
  reasons: string[];
}): void {
  if (
    params.usedNonces !== undefined &&
    typeof params.payload.nonce === "string" &&
    params.usedNonces.has(params.payload.nonce)
  ) {
    params.reasons.push("Confirmation token replay detected for this process lifecycle.");
  }
}

export function createApplyConfirmationToken(params: {
  provider: string;
  environment: string;
  changeSetHash: string;
  correlationId: string;
  nonce?: string;
  ttlSeconds?: number;
  now?: Date;
  secret?: string;
}): string {
  const resolvedSecret = resolveConfirmationSigningSecret(params.secret);
  if (!resolvedSecret.ok) {
    throw new Error(resolvedSecret.reason);
  }

  const now = params.now ?? new Date();
  const ttlSeconds = params.ttlSeconds ?? APPLY_CONFIRMATION_DEFAULT_TTL_SECONDS;
  const payload: ApplyConfirmationTokenPayload = {
    version: 1,
    purpose: "sync-apply",
    nonce: params.nonce ?? randomUUID(),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    provider: params.provider,
    environment: params.environment,
    changeSetHash: params.changeSetHash,
    correlationId: params.correlationId,
  };

  const encodedPayload = encodePayload(payload);
  const signature = signTokenPayload({
    encodedPayload,
    secret: resolvedSecret.secret,
  });
  return `${buildSigningInput(encodedPayload)}.${signature}`;
}

export function validateApplyConfirmationToken(params: {
  token: string | undefined;
  provider: string;
  environment: string;
  changeSetHash: string;
  expectedCorrelationId: string;
  usedNonces?: Set<string>;
  now?: Date;
  maxTtlSeconds?: number;
  secret?: string;
}): ApplyConfirmationTokenValidationResult {
  if (typeof params.token !== "string" || params.token.trim().length === 0) {
    return {
      isValid: false,
      reasons: ["A one-time confirmation token is required for apply mode."],
    };
  }

  const reasons: string[] = [];
  let encodedPayload = "";
  let providedSignature = "";
  let payloadInput: unknown;

  try {
    const parsed = parseToken(params.token.trim());
    encodedPayload = parsed.encodedPayload;
    providedSignature = parsed.providedSignature;
    payloadInput = parsed.payload;
  } catch (error) {
    return {
      isValid: false,
      reasons: [error instanceof Error ? error.message : String(error)],
    };
  }

  if (typeof payloadInput !== "object" || payloadInput === null) {
    return {
      isValid: false,
      reasons: ["Confirmation token payload must be a JSON object."],
    };
  }

  const payload = payloadInput as Partial<ApplyConfirmationTokenPayload>;
  validateRequiredFields(payload, reasons);
  validateContextBinding({
    payload,
    provider: params.provider,
    environment: params.environment,
    changeSetHash: params.changeSetHash,
    expectedCorrelationId: params.expectedCorrelationId,
    reasons,
  });
  validateTimestamps({
    payload,
    now: params.now ?? new Date(),
    maxTtlSeconds: params.maxTtlSeconds ?? APPLY_CONFIRMATION_MAX_TTL_SECONDS,
    reasons,
  });
  validateReplay({
    payload,
    ...(params.usedNonces === undefined ? {} : { usedNonces: params.usedNonces }),
    reasons,
  });

  const resolvedSecret = resolveConfirmationSigningSecret(params.secret);
  if (!resolvedSecret.ok) {
    reasons.push(resolvedSecret.reason);
  } else {
    const expectedSignature = signTokenPayload({
      encodedPayload,
      secret: resolvedSecret.secret,
    });
    if (
      !isTimingSafeSignatureMatch({
        expectedSignature,
        providedSignature,
      })
    ) {
      reasons.push("Confirmation token signature verification failed.");
    }
  }

  if (reasons.length > 0) {
    return {
      isValid: false,
      reasons,
    };
  }

  return {
    isValid: true,
    reasons: [],
    payload: payload as ApplyConfirmationTokenPayload,
  };
}
