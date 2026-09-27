import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const APPLY_CONFIRMATION_TOKEN_PREFIX = "etgac";
const APPLY_CONFIRMATION_TOKEN_VERSION = "v1";
export const APPLY_CONFIRMATION_DEFAULT_TTL_SECONDS = 300;
export const APPLY_CONFIRMATION_MAX_TTL_SECONDS = 900;
const APPLY_CONFIRMATION_MIN_SIGNING_KEY_LENGTH = 32;

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

// The key is never generated here: a token is minted by one process and validated by
// another, so a per-process random key would reject every token it did not mint itself.
function resolveConfirmationSigningSecret(
  secret: string | undefined,
): ConfirmationTokenSecretResolution {
  const signingKey =
    secret !== undefined && secret.length > 0
      ? secret
      : process.env.ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY;

  if (signingKey === undefined || signingKey.length === 0) {
    return {
      ok: false,
      reason:
        "ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY is required for apply confirmation tokens. Set the same key where the token is created and where sync-apply runs.",
    };
  }

  if (signingKey.length < APPLY_CONFIRMATION_MIN_SIGNING_KEY_LENGTH) {
    return {
      ok: false,
      reason: `The confirmation signing key must be at least ${APPLY_CONFIRMATION_MIN_SIGNING_KEY_LENGTH} characters long.`,
    };
  }

  return { ok: true, secret: signingKey };
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

type ConfirmationTokenPayloadParseResult =
  | { ok: true; payload: ApplyConfirmationTokenPayload }
  | { ok: false; reasons: string[] };

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function readNonEmptyString(params: {
  record: Record<string, unknown>;
  field: string;
  reasons: string[];
}): string | undefined {
  const fieldValue = params.record[params.field];
  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    params.reasons.push(`Confirmation token ${params.field} must be a non-empty string.`);
    return undefined;
  }

  return fieldValue;
}

function parseTokenPayload(input: unknown): ConfirmationTokenPayloadParseResult {
  if (!isRecord(input)) {
    return { ok: false, reasons: ["Confirmation token payload must be a JSON object."] };
  }

  const reasons: string[] = [];
  if (input.version !== 1) {
    reasons.push("Confirmation token version must be 1.");
  }

  if (input.purpose !== "sync-apply") {
    reasons.push("Confirmation token purpose must be sync-apply.");
  }

  const nonce = readNonEmptyString({ record: input, field: "nonce", reasons });
  const issuedAt = readNonEmptyString({ record: input, field: "issuedAt", reasons });
  const expiresAt = readNonEmptyString({ record: input, field: "expiresAt", reasons });
  const provider = readNonEmptyString({ record: input, field: "provider", reasons });
  const environment = readNonEmptyString({ record: input, field: "environment", reasons });
  const changeSetHash = readNonEmptyString({ record: input, field: "changeSetHash", reasons });
  const correlationId = readNonEmptyString({ record: input, field: "correlationId", reasons });

  if (
    reasons.length > 0 ||
    nonce === undefined ||
    issuedAt === undefined ||
    expiresAt === undefined ||
    provider === undefined ||
    environment === undefined ||
    changeSetHash === undefined ||
    correlationId === undefined
  ) {
    return { ok: false, reasons };
  }

  return {
    ok: true,
    payload: {
      version: 1,
      purpose: "sync-apply",
      nonce,
      issuedAt,
      expiresAt,
      provider,
      environment,
      changeSetHash,
      correlationId,
    },
  };
}

function validateContextBinding(params: {
  payload: ApplyConfirmationTokenPayload;
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
  payload: ApplyConfirmationTokenPayload;
  now: Date;
  maxTtlSeconds: number;
  reasons: string[];
}): void {
  const issuedAtMs = parseIsoDate(params.payload.issuedAt);
  if (issuedAtMs === null) {
    params.reasons.push("Confirmation token issuedAt must be a valid ISO timestamp.");
  }

  const expiresAtMs = parseIsoDate(params.payload.expiresAt);
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
  payload: ApplyConfirmationTokenPayload;
  usedNonces?: Set<string>;
  reasons: string[];
}): void {
  if (params.usedNonces?.has(params.payload.nonce) === true) {
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

  const parsedPayload = parseTokenPayload(payloadInput);
  if (!parsedPayload.ok) {
    return {
      isValid: false,
      reasons: parsedPayload.reasons,
    };
  }

  const payload = parsedPayload.payload;
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
    payload,
  };
}
