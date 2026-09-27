import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasEvidenceSigningKey,
  signEvidenceHash,
  verifyEvidenceSignature,
} from "../../src/reporting/evidence-signature.js";

const ENVIRONMENT_SIGNING_KEY = "evidence-signature-test-environment-key";

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

  it("should mark the evidence as unsigned when no signing key is configured", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ENV_TYPEGEN_EVIDENCE_SIGNING_KEY", "");

    const unsignedEvidence = signEvidenceHash({
      bundleHash: "bundle-hash",
      lifecycleHash: "lifecycle-hash",
    });

    expect(unsignedEvidence.algorithm).toBe("none");
    expect(unsignedEvidence.keyId).toBe("unsigned");
    expect(unsignedEvidence.signature).toBe("");
    expect(hasEvidenceSigningKey()).toBe(false);
  });

  it("should never verify unsigned evidence, with or without a key", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ENV_TYPEGEN_EVIDENCE_SIGNING_KEY", "");
    const unsignedEvidence = signEvidenceHash({
      bundleHash: "bundle-hash",
      lifecycleHash: "lifecycle-hash",
    });
    const verification = {
      bundleHash: "bundle-hash",
      lifecycleHash: "lifecycle-hash",
      signature: unsignedEvidence,
    };

    expect(verifyEvidenceSignature(verification)).toBe(false);

    vi.stubEnv("ENV_TYPEGEN_EVIDENCE_SIGNING_KEY", ENVIRONMENT_SIGNING_KEY);
    expect(verifyEvidenceSignature(verification)).toBe(false);
  });

  it("should reject a signed evidence when the verifier has no key", () => {
    vi.stubEnv("ENV_TYPEGEN_EVIDENCE_SIGNING_KEY", ENVIRONMENT_SIGNING_KEY);
    const signedEvidence = signEvidenceHash({
      bundleHash: "bundle-hash",
      lifecycleHash: "lifecycle-hash",
    });

    vi.stubEnv("ENV_TYPEGEN_EVIDENCE_SIGNING_KEY", "");

    expect(
      verifyEvidenceSignature({
        bundleHash: "bundle-hash",
        lifecycleHash: "lifecycle-hash",
        signature: signedEvidence,
      }),
    ).toBe(false);
  });

  it("should verify in a separate module instance that shares only the key", async () => {
    vi.stubEnv("ENV_TYPEGEN_EVIDENCE_SIGNING_KEY", ENVIRONMENT_SIGNING_KEY);
    const signedEvidence = signEvidenceHash({
      bundleHash: "bundle-hash",
      lifecycleHash: "lifecycle-hash",
    });

    vi.resetModules();
    const separateInstance = await import("../../src/reporting/evidence-signature.js");

    expect(signedEvidence.algorithm).toBe("hmac-sha256");
    expect(
      separateInstance.verifyEvidenceSignature({
        bundleHash: "bundle-hash",
        lifecycleHash: "lifecycle-hash",
        signature: signedEvidence,
      }),
    ).toBe(true);
  });
});
