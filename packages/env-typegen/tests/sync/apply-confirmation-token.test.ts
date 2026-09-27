import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSyncApplyCorrelationId,
  createApplyConfirmationToken,
  validateApplyConfirmationToken,
} from "../../src/sync/apply-confirmation-token.js";

const SIGNING_KEY = "unit-test-confirmation-signing-key-0001";
const SIGNING_KEY_ENV = "ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY";

function signRawPayload(rawPayload: string): string {
  const encodedPayload = Buffer.from(rawPayload, "utf8").toString("base64url");
  const signingInput = `etgac.v1.${encodedPayload}`;
  const signature = createHmac("sha256", SIGNING_KEY).update(signingInput, "utf8").digest("hex");
  return `${signingInput}.${signature}`;
}

describe("apply confirmation token", () => {
  beforeEach(() => {
    vi.stubEnv(SIGNING_KEY_ENV, SIGNING_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("should create a valid token with nonce, ttl, signature, and context binding", () => {
    const correlationId = buildSyncApplyCorrelationId({
      provider: "demo",
      environment: "production",
      mode: "apply",
      changeSetHash: "hash-1234567890abcdef",
    });

    const token = createApplyConfirmationToken({
      provider: "demo",
      environment: "production",
      changeSetHash: "hash-1234567890abcdef",
      correlationId,
      now: new Date("2026-03-18T10:00:00.000Z"),
      ttlSeconds: 60,
    });

    const validation = validateApplyConfirmationToken({
      token,
      provider: "demo",
      environment: "production",
      changeSetHash: "hash-1234567890abcdef",
      expectedCorrelationId: correlationId,
      now: new Date("2026-03-18T10:00:30.000Z"),
      usedNonces: new Set<string>(),
    });

    expect(validation.isValid).toBe(true);
    expect(validation.reasons).toEqual([]);
    expect(validation.payload?.nonce.length).toBeGreaterThan(0);
  });

  it("should reject token with context mismatch", () => {
    const correlationId = buildSyncApplyCorrelationId({
      provider: "demo",
      environment: "production",
      mode: "apply",
      changeSetHash: "hash-1234567890abcdef",
    });
    const token = createApplyConfirmationToken({
      provider: "demo",
      environment: "production",
      changeSetHash: "hash-1234567890abcdef",
      correlationId,
      now: new Date("2026-03-18T10:00:00.000Z"),
      ttlSeconds: 60,
    });

    const validation = validateApplyConfirmationToken({
      token,
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-wrong",
      expectedCorrelationId: "wrong-correlation",
      now: new Date("2026-03-18T10:00:30.000Z"),
    });

    expect(validation.isValid).toBe(false);
    expect(validation.reasons.join(" ")).toContain("environment");
    expect(validation.reasons.join(" ")).toContain("change-set hash");
    expect(validation.reasons.join(" ")).toContain("correlationId");
  });

  it("should reject token replay in the same process lifecycle", () => {
    const correlationId = buildSyncApplyCorrelationId({
      provider: "demo",
      environment: "development",
      mode: "apply",
      changeSetHash: "hash-123",
    });
    const token = createApplyConfirmationToken({
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      correlationId,
      nonce: "fixed-nonce",
      now: new Date("2026-03-18T10:00:00.000Z"),
      ttlSeconds: 60,
    });

    const validation = validateApplyConfirmationToken({
      token,
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      expectedCorrelationId: correlationId,
      now: new Date("2026-03-18T10:00:10.000Z"),
      usedNonces: new Set<string>(["fixed-nonce"]),
    });

    expect(validation.isValid).toBe(false);
    expect(validation.reasons.join(" ")).toContain("replay");
  });

  it("should reject expired token", () => {
    const correlationId = buildSyncApplyCorrelationId({
      provider: "demo",
      environment: "development",
      mode: "apply",
      changeSetHash: "hash-123",
    });
    const token = createApplyConfirmationToken({
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      correlationId,
      now: new Date("2026-03-18T10:00:00.000Z"),
      ttlSeconds: 5,
    });

    const validation = validateApplyConfirmationToken({
      token,
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      expectedCorrelationId: correlationId,
      now: new Date("2026-03-18T10:01:00.000Z"),
    });

    expect(validation.isValid).toBe(false);
    expect(validation.reasons.join(" ")).toContain("expired");
  });

  it("should reject token with tampered signature", () => {
    const correlationId = buildSyncApplyCorrelationId({
      provider: "demo",
      environment: "development",
      mode: "apply",
      changeSetHash: "hash-123",
    });
    const token = createApplyConfirmationToken({
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      correlationId,
      now: new Date("2026-03-18T10:00:00.000Z"),
      ttlSeconds: 60,
    });
    const tamperedToken = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;

    const validation = validateApplyConfirmationToken({
      token: tamperedToken,
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      expectedCorrelationId: correlationId,
      now: new Date("2026-03-18T10:00:20.000Z"),
    });

    expect(validation.isValid).toBe(false);
    expect(validation.reasons.join(" ")).toContain("signature verification failed");
  });

  it("should refuse to create a token when no signing key is configured", () => {
    vi.stubEnv(SIGNING_KEY_ENV, "");

    expect(() =>
      createApplyConfirmationToken({
        provider: "demo",
        environment: "development",
        changeSetHash: "hash-123",
        correlationId: "demo:development:apply:hash-123",
      }),
    ).toThrow(SIGNING_KEY_ENV);
  });

  it("should reject validation when no signing key is configured", () => {
    const token = createApplyConfirmationToken({
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      correlationId: "demo:development:apply:hash-123",
    });
    vi.stubEnv(SIGNING_KEY_ENV, "");

    const validation = validateApplyConfirmationToken({
      token,
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      expectedCorrelationId: "demo:development:apply:hash-123",
    });

    expect(validation.isValid).toBe(false);
    expect(validation.reasons.join(" ")).toContain(SIGNING_KEY_ENV);
  });

  it("should reject a signing key shorter than 32 characters", () => {
    expect(() =>
      createApplyConfirmationToken({
        provider: "demo",
        environment: "development",
        changeSetHash: "hash-123",
        correlationId: "demo:development:apply:hash-123",
        secret: "too-short",
      }),
    ).toThrow("at least 32 characters");
  });

  it("should validate a token created by a separate module instance", async () => {
    const token = createApplyConfirmationToken({
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      correlationId: "demo:development:apply:hash-123",
    });

    vi.resetModules();
    const freshModule = await import("../../src/sync/apply-confirmation-token.js");
    const validation = freshModule.validateApplyConfirmationToken({
      token,
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      expectedCorrelationId: "demo:development:apply:hash-123",
    });

    expect(validation.isValid).toBe(true);
  });

  it("should reject a signed payload that is not a JSON object", () => {
    const validation = validateApplyConfirmationToken({
      token: signRawPayload(JSON.stringify(["sync-apply"])),
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      expectedCorrelationId: "demo:development:apply:hash-123",
    });

    expect(validation.isValid).toBe(false);
    expect(validation.reasons).toEqual(["Confirmation token payload must be a JSON object."]);
  });

  it("should reject a signed payload with missing or mistyped fields", () => {
    const validation = validateApplyConfirmationToken({
      token: signRawPayload(
        JSON.stringify({
          version: 2,
          purpose: "other",
          nonce: 42,
          issuedAt: "2026-03-18T10:00:00.000Z",
          expiresAt: "2026-03-18T10:01:00.000Z",
          provider: "demo",
          environment: "development",
          changeSetHash: "hash-123",
        }),
      ),
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      expectedCorrelationId: "demo:development:apply:hash-123",
      now: new Date("2026-03-18T10:00:30.000Z"),
    });

    expect(validation.isValid).toBe(false);
    expect(validation.payload).toBeUndefined();
    expect(validation.reasons).toEqual([
      "Confirmation token version must be 1.",
      "Confirmation token purpose must be sync-apply.",
      "Confirmation token nonce must be a non-empty string.",
      "Confirmation token correlationId must be a non-empty string.",
    ]);
  });

  it("should reject a signed payload with invalid timestamps", () => {
    const validation = validateApplyConfirmationToken({
      token: signRawPayload(
        JSON.stringify({
          version: 1,
          purpose: "sync-apply",
          nonce: "nonce-1",
          issuedAt: "not-a-date",
          expiresAt: "2026-03-18T10:01:00.000Z",
          provider: "demo",
          environment: "development",
          changeSetHash: "hash-123",
          correlationId: "demo:development:apply:hash-123",
        }),
      ),
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      expectedCorrelationId: "demo:development:apply:hash-123",
      now: new Date("2026-03-18T10:00:30.000Z"),
    });

    expect(validation.isValid).toBe(false);
    expect(validation.reasons).toEqual([
      "Confirmation token issuedAt must be a valid ISO timestamp.",
    ]);
  });

  it("should reject a token that does not have four segments", () => {
    const validation = validateApplyConfirmationToken({
      token: "CHGSET-APPROVED-001",
      provider: "demo",
      environment: "development",
      changeSetHash: "hash-123",
      expectedCorrelationId: "demo:development:apply:hash-123",
    });

    expect(validation.isValid).toBe(false);
    expect(validation.reasons.join(" ")).toContain("format is invalid");
  });
});
