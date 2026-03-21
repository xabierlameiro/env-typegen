import { describe, expect, it } from "vitest";

import { evaluateWriteGuards } from "../../src/sync/write-guards.js";

describe("evaluateWriteGuards", () => {
  it("should allow dry-run mode regardless of write configuration", () => {
    const result = evaluateWriteGuards({
      mode: "dry-run",
      environment: "production",
      policyDecision: "block",
      writeEnabled: false,
      isProtectedEnvironment: true,
      isProtectedBranch: false,
      preflightValidation: {
        isValid: false,
        reasons: ["A valid preflight proof is required before apply mode."],
      },
      confirmationTokenValidation: {
        isValid: false,
        reasons: ["A one-time confirmation token is required for apply mode."],
      },
      hasOverrideReason: false,
    });

    expect(result.allowed).toBe(true);
    expect(result.reasons).toContain("Dry-run mode does not mutate remote state.");
  });

  it("should block apply when policy blocks the operation", () => {
    const result = evaluateWriteGuards({
      mode: "apply",
      environment: "staging",
      policyDecision: "block",
      writeEnabled: true,
      isProtectedEnvironment: false,
      isProtectedBranch: true,
      preflightValidation: {
        isValid: true,
        reasons: [],
      },
      confirmationTokenValidation: {
        isValid: true,
        reasons: [],
      },
      hasOverrideReason: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("Policy decision BLOCK prevents remote write operations.");
  });

  it("should block apply in protected environments when branch is not protected", () => {
    const result = evaluateWriteGuards({
      mode: "apply",
      environment: "production",
      policyDecision: "allow",
      writeEnabled: true,
      isProtectedEnvironment: true,
      isProtectedBranch: false,
      preflightValidation: {
        isValid: true,
        reasons: [],
      },
      confirmationTokenValidation: {
        isValid: true,
        reasons: [],
      },
      hasOverrideReason: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("protected");
  });

  it("should allow apply when all required checks are satisfied", () => {
    const result = evaluateWriteGuards({
      mode: "apply",
      environment: "production",
      policyDecision: "allow",
      writeEnabled: true,
      isProtectedEnvironment: true,
      isProtectedBranch: true,
      preflightValidation: {
        isValid: true,
        reasons: [],
      },
      confirmationTokenValidation: {
        isValid: true,
        reasons: [],
      },
      hasOverrideReason: true,
    });

    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.requiredChecks).toContain("branch-protection");
  });

  it("should block apply when confirmation token is missing", () => {
    const result = evaluateWriteGuards({
      mode: "apply",
      environment: "production",
      policyDecision: "allow",
      writeEnabled: true,
      isProtectedEnvironment: false,
      isProtectedBranch: true,
      preflightValidation: {
        isValid: true,
        reasons: [],
      },
      confirmationTokenValidation: {
        isValid: false,
        reasons: ["A one-time confirmation token is required for apply mode."],
      },
      hasOverrideReason: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("A one-time confirmation token is required for apply mode.");
  });
});
