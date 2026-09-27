import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuditEvent } from "../../src/audit/audit-event.js";
import { buildEvidenceBundle } from "../../src/reporting/evidence-bundle.js";

function makeAuditEvents(): AuditEvent[] {
  return [
    {
      timestamp: "2026-03-18T10:00:00.000Z",
      event: "sync-apply.requested",
      level: "info",
      command: "sync-apply",
      correlationId: "corr-123",
      provider: "demo",
      environment: "production",
      mode: "apply",
      policyDecision: "allow",
      changeSetHash: "abc",
      message: "requested",
    },
    {
      timestamp: "2026-03-18T10:00:01.000Z",
      event: "sync-apply.completed",
      level: "info",
      command: "sync-apply",
      correlationId: "corr-123",
      provider: "demo",
      environment: "production",
      mode: "apply",
      policyDecision: "allow",
      changeSetHash: "abc",
      message: "completed",
    },
  ];
}

describe("buildEvidenceBundle", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should produce a stable evidence schema and deterministic hash correlation fields", () => {
    vi.stubEnv("ENV_TYPEGEN_EVIDENCE_SIGNING_KEY", "evidence-bundle-test-signing-key");
    const governanceSummary = {
      stage: "apply" as const,
      provider: "demo",
      environment: "production",
      mode: "apply" as const,
      policyDecision: "allow" as const,
      guardAllowed: true,
      hasFailures: false,
      totals: {
        planned: 0,
        applied: 1,
        failed: 0,
        skipped: 0,
        total: 1,
      },
      auditEvents: 2,
      outcome: "pass" as const,
      generatedAt: "2026-03-18T10:00:02.000Z",
    };

    const bundle = buildEvidenceBundle({
      provider: "demo",
      environment: "production",
      mode: "apply",
      correlationId: "corr-123",
      changeSetHash: "abc",
      governanceSummary,
      auditEvents: makeAuditEvents(),
      apply: {
        summary: {
          planned: 0,
          applied: 1,
          failed: 0,
          skipped: 0,
          total: 1,
          mode: "apply",
        },
        budget: {
          allowed: true,
          reasons: [],
          limitsApplied: ["maxOperations"],
          durationMs: 12,
        },
        reconciliation: {
          planned: 0,
          applied: 1,
          failed: 0,
          skipped: 0,
          total: 1,
        },
        compensation: {
          planned: 0,
          notRequired: 1,
          total: 1,
        },
        rollbackSimulation: {
          canRollback: true,
          rollbackPlanned: 1,
          rollbackBlocked: 0,
          noRollback: 0,
          total: 1,
        },
      },
    });

    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.bundleId).toContain("corr-123");
    expect(bundle.changeSetHash).toBe("abc");
    expect(bundle.audit.lifecycleHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(bundle.bundleHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(bundle.signature.signature).toMatch(/^[a-f0-9]{64}$/u);
    expect(bundle.signature.signatureId.length).toBeGreaterThan(0);
    expect(bundle.forensicsIndex.indexHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(bundle.forensicsIndex.signatureId).toBe(bundle.signature.signatureId);
  });

  it("should keep bundleHash stable across runs with different volatile timestamps", () => {
    const governanceSummaryFirst = {
      stage: "apply" as const,
      provider: "demo",
      environment: "production",
      mode: "apply" as const,
      policyDecision: "allow" as const,
      guardAllowed: true,
      hasFailures: false,
      totals: {
        planned: 0,
        applied: 1,
        failed: 0,
        skipped: 0,
        total: 1,
      },
      auditEvents: 2,
      outcome: "pass" as const,
      generatedAt: "2026-03-18T10:00:02.000Z",
    };

    const governanceSummarySecond = {
      ...governanceSummaryFirst,
      generatedAt: "2026-03-18T10:59:59.000Z",
    };

    const first = buildEvidenceBundle({
      provider: "demo",
      environment: "production",
      mode: "apply",
      correlationId: "corr-123",
      changeSetHash: "abc",
      governanceSummary: governanceSummaryFirst,
      auditEvents: makeAuditEvents(),
      apply: {
        summary: {
          planned: 0,
          applied: 1,
          failed: 0,
          skipped: 0,
          total: 1,
          mode: "apply",
        },
        budget: {
          allowed: true,
          reasons: [],
          limitsApplied: ["maxOperations"],
          durationMs: 12,
        },
        reconciliation: {
          planned: 0,
          applied: 1,
          failed: 0,
          skipped: 0,
          total: 1,
        },
        compensation: {
          planned: 0,
          notRequired: 1,
          total: 1,
        },
        rollbackSimulation: {
          canRollback: true,
          rollbackPlanned: 1,
          rollbackBlocked: 0,
          noRollback: 0,
          total: 1,
        },
      },
    });

    const second = buildEvidenceBundle({
      provider: "demo",
      environment: "production",
      mode: "apply",
      correlationId: "corr-123",
      changeSetHash: "abc",
      governanceSummary: governanceSummarySecond,
      auditEvents: makeAuditEvents(),
      apply: {
        summary: {
          planned: 0,
          applied: 1,
          failed: 0,
          skipped: 0,
          total: 1,
          mode: "apply",
        },
        budget: {
          allowed: true,
          reasons: [],
          limitsApplied: ["maxOperations"],
          durationMs: 999,
        },
        reconciliation: {
          planned: 0,
          applied: 1,
          failed: 0,
          skipped: 0,
          total: 1,
        },
        compensation: {
          planned: 0,
          notRequired: 1,
          total: 1,
        },
        rollbackSimulation: {
          canRollback: true,
          rollbackPlanned: 1,
          rollbackBlocked: 0,
          noRollback: 0,
          total: 1,
        },
      },
    });

    expect(first.bundleHash).toBe(second.bundleHash);
  });
});
