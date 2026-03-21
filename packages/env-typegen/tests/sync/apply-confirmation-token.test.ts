import { describe, expect, it } from "vitest";

import {
  buildSyncApplyCorrelationId,
  createApplyConfirmationToken,
  validateApplyConfirmationToken,
} from "../../src/sync/apply-confirmation-token.js";

describe("apply confirmation token", () => {
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
});
