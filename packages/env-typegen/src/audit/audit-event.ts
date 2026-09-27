export type AuditEventType =
  | "sync-apply.requested"
  | "sync-apply.preflight-validated"
  | "sync-apply.apply-started"
  | "sync-apply.blocked"
  | "sync-apply.completed"
  | "sync-apply.apply-failed";

export type AuditEventLevel = "info" | "warning" | "error";

export type AuditEvent = {
  timestamp: string;
  event: AuditEventType;
  level: AuditEventLevel;
  command: "sync-apply";
  correlationId?: string;
  provider: string;
  environment: string;
  mode: "dry-run" | "apply";
  policyDecision: "allow" | "warn" | "block";
  changeSetHash?: string;
  evidenceBundleId?: string;
  evidenceHash?: string;
  evidenceSignatureId?: string;
  forensicsIndexId?: string;
  forensicsIndexHash?: string;
  summary?: {
    planned?: number;
    applied: number;
    failed: number;
    skipped: number;
    total: number;
  };
  operationStatuses?: {
    planned: number;
    applied: number;
    failed: number;
    skipped: number;
  };
  reasons?: string[];
  metadata?: Record<string, unknown>;
  message: string;
};
