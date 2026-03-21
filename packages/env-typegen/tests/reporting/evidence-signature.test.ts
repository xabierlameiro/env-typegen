import { afterEach, describe, expect, it, vi } from "vitest";

import {
  signEvidenceHash,
  verifyEvidenceSignature,
} from "../../src/reporting/evidence-signature.js";

describe("evidence-signature", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should produce a deterministic signature for the same payload and secret", () => {
    const first = signEvidenceHash({
      bundleHash: "bundle-hash",
      lifecycleHash: "lifecycle-hash",
      secret: "test-secret",
      signedAt: "2026-03-18T00:00:00.000Z",
    });
    const second = signEvidenceHash({
      bundleHash: "bundle-hash",
      lifecycleHash: "lifecycle-hash",
      secret: "test-secret",
      signedAt: "2026-03-18T00:00:00.000Z",
    });

    expect(first.signature).toBe(second.signature);
    expect(first.signatureId).toBe(second.signatureId);
    expect(first.algorithm).toBe("hmac-sha256");
  });

  it("should verify signatures generated from matching payload and secret", () => {
    const signature = signEvidenceHash({
      bundleHash: "bundle-hash",
      lifecycleHash: "lifecycle-hash",
      secret: "test-secret",
    });

    expect(
      verifyEvidenceSignature({
        bundleHash: "bundle-hash",
        lifecycleHash: "lifecycle-hash",
        signature,
        secret: "test-secret",
      }),
    ).toBe(true);

    expect(
      verifyEvidenceSignature({
        bundleHash: "bundle-hash",
        lifecycleHash: "different",
        signature,
        secret: "test-secret",
      }),
    ).toBe(false);
  });

  it("should return false when the provided signature has a different length", () => {
    const signature = signEvidenceHash({
      bundleHash: "bundle-hash",
      lifecycleHash: "lifecycle-hash",
      secret: "test-secret",
    });

    const signatureWithDifferentLength = {
      ...signature,
      signature: `${signature.signature}0`,
    };

    expect(
      verifyEvidenceSignature({
        bundleHash: "bundle-hash",
        lifecycleHash: "lifecycle-hash",
        signature: signatureWithDifferentLength,
        secret: "test-secret",
      }),
    ).toBe(false);
  });

  it("should throw when running in production without a signing secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENV_TYPEGEN_EVIDENCE_SIGNING_KEY", "");

    expect(() =>
      signEvidenceHash({
        bundleHash: "bundle-hash",
        lifecycleHash: "lifecycle-hash",
      }),
    ).toThrow("ENV_TYPEGEN_EVIDENCE_SIGNING_KEY is required in production for evidence signing.");
  });

  it("should use an ephemeral non-production secret when no signing secret is configured", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ENV_TYPEGEN_EVIDENCE_SIGNING_KEY", "");

    const implicit = signEvidenceHash({
      bundleHash: "bundle-hash",
      lifecycleHash: "lifecycle-hash",
      signedAt: "2026-03-18T00:00:00.000Z",
    });
    const explicitLegacy = signEvidenceHash({
      bundleHash: "bundle-hash",
      lifecycleHash: "lifecycle-hash",
      secret: "env-typegen-evidence-default-signing-key",
      signedAt: "2026-03-18T00:00:00.000Z",
    });

    expect(implicit.signature).not.toBe(explicitLegacy.signature);
  });
});
