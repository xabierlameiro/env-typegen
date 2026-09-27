import type { PolicyDecision } from "../policy/policy-model.js";

export type WriteGuardMode = "dry-run" | "apply";

export type WriteGuardContext = {
  mode: WriteGuardMode;
  environment: string;
  policyDecision: PolicyDecision;
  writeEnabled: boolean;
  isProtectedEnvironment: boolean;
  isProtectedBranch: boolean;
  preflightValidation: {
    isValid: boolean;
    reasons: string[];
  };
  attestationValidation?: {
    isValid: boolean;
    reasons: string[];
  };
  confirmationTokenValidation: {
    isValid: boolean;
    reasons: string[];
  };
  evidenceSigningValidation?: {
    isValid: boolean;
    reasons: string[];
  };
  hasOverrideReason: boolean;
};

export type WriteGuardResult = {
  allowed: boolean;
  reasons: string[];
  requiredChecks: string[];
};

export function evaluateWriteGuards(context: WriteGuardContext): WriteGuardResult {
  if (context.mode === "dry-run") {
    return {
      allowed: true,
      reasons: ["Dry-run mode does not mutate remote state."],
      requiredChecks: ["policy-evaluation", "change-set-generation"],
    };
  }

  const reasons: string[] = [];
  const requiredChecks: string[] = [
    "policy-evaluation",
    "change-set-generation",
    "preflight-proof-validation",
    "one-time-confirmation-token",
    "branch-protection",
  ];

  if (context.attestationValidation !== undefined) {
    requiredChecks.push("preflight-attestation-validation");
  }

  if (context.evidenceSigningValidation !== undefined) {
    requiredChecks.push("evidence-signing-key");
  }

  if (context.writeEnabled === false) {
    reasons.push("Write mode is disabled in current configuration.");
  }

  if (context.policyDecision === "block") {
    reasons.push("Policy decision BLOCK prevents remote write operations.");
  }

  if (!context.preflightValidation.isValid) {
    reasons.push(...context.preflightValidation.reasons);
  }

  if (!context.confirmationTokenValidation.isValid) {
    reasons.push(...context.confirmationTokenValidation.reasons);
  }

  if (context.evidenceSigningValidation?.isValid === false) {
    reasons.push(...context.evidenceSigningValidation.reasons);
  }

  if (!context.hasOverrideReason) {
    reasons.push("Override mode requires an explicit emergency reason.");
  }

  if (context.isProtectedEnvironment && context.isProtectedBranch === false) {
    reasons.push(
      `Environment ${context.environment} is protected and requires execution from a protected branch.`,
    );
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    requiredChecks,
  };
}
