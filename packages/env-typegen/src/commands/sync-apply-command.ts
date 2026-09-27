import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { loadAdapter } from "../adapters/loader.js";
import type { EnvMap } from "../adapters/types.js";
import type { AuditEvent } from "../audit/audit-event.js";
import { writeAuditEvents } from "../audit/audit-writer.js";
import { loadConfig, type EnvTypegenConfig, type EnvTypegenWritePolicyConfig } from "../config.js";
import { evaluateFleetRollout } from "../fleet/rollout-controller.js";
import {
  runBoundedOrchestration,
  type OrchestrationResult,
  type OrchestrationStrategy,
  type PromotionStage,
} from "../ops/concurrency-orchestrator.js";
import { evaluatePolicy } from "../policy/policy-evaluator.js";
import { formatAuditEvent } from "../reporting/audit-report.js";
import { buildEvidenceBundle, type EvidenceBundle } from "../reporting/evidence-bundle.js";
import { buildGovernanceSummary } from "../reporting/governance-summary.js";
import {
  runApplyEngineV2,
  type ApplyExecutionResultV2,
  type ApplyOperationResultV2,
} from "../sync/apply-engine-v2.js";
import type { ApplyMode } from "../sync/apply-engine.js";
import {
  buildSyncApplyCorrelationId,
  validateApplyConfirmationToken,
  type ApplyConfirmationTokenValidationResult,
} from "../sync/apply-confirmation-token.js";
import { buildChangeSetFromMaps, calculateChangeSetHash } from "../sync/change-set.js";
import {
  claimConfirmationNonce,
  DEFAULT_CONFIRMATION_NONCE_STORE_PATH,
} from "../sync/confirmation-nonce-store.js";
import { validatePreflightProof } from "../sync/preflight-proof.js";
import { evaluateWriteGuards, type WriteGuardResult } from "../sync/write-guards.js";
import { validatePreflightAttestation } from "../trust/preflight-attestation.js";
import { loadEnvSource } from "../validation/env-source.js";
import type { ValidationReport } from "../validation/types.js";

type SyncApplyArgValues = {
  provider?: string;
  env?: string;
  "env-file"?: string;
  config?: string;
  json?: boolean;
  apply?: boolean;
  "preflight-file"?: string;
  "protected-branch"?: boolean;
  "confirmation-token"?: string;
  override?: boolean;
  reason?: string;
  strategy?: string;
  "max-concurrency"?: string;
  help?: boolean;
};

type LoadConfigModule = {
  default?: EnvTypegenConfig;
};

const SYNC_APPLY_HELP_TEXT = [
  "Usage: env-typegen sync-apply <provider> [options]",
  "",
  "Options:",
  "  --provider <name>         Provider name (fallback if positional omitted)",
  "  --env <name>              Logical environment (default: development)",
  "  --env-file <path>         Local env file to sync (default: .env)",
  "  --apply                   Enable write mode (default: dry-run)",
  "  --preflight-file <path>   Required plan artifact for apply mode when configured",
  "  --confirmation-token <v>  Signed one-time confirmation token for apply mode",
  "  --override                Enable manual emergency override flow",
  "  --reason <text>           Required when --override is set",
  "  --strategy <mode>         fail-fast | fail-late (default: fail-fast)",
  "  --max-concurrency <n>     Bounded parallelism for promotion targets (default: 1)",
  "  --protected-branch        Explicitly mark execution on protected branch",
  "  -c, --config <path>       Config file path",
  "  --json                    Emit machine-readable JSON output",
  "  -h, --help                Show this help",
  "",
  "Exit codes:",
  "  0  Operation allowed and completed (dry-run or apply)",
  "  1  Operation blocked by guards/policy or provider apply failure",
].join("\n");

function resolveProviderName(values: SyncApplyArgValues, positionals: string[]): string {
  const providerName = values.provider ?? positionals[0];
  if (providerName === undefined || providerName.trim().length === 0) {
    throw new Error("Provider is required. Use `env-typegen sync-apply <provider>`.");
  }
  return providerName;
}

async function loadSyncApplyConfig(
  configPath: string | undefined,
): Promise<EnvTypegenConfig | undefined> {
  if (configPath === undefined) {
    return loadConfig(process.cwd());
  }

  const resolvedPath = path.resolve(configPath);
  if (!existsSync(resolvedPath)) {
    const displayPath = path.isAbsolute(configPath)
      ? configPath
      : `${configPath} (resolved: ${resolvedPath})`;
    throw new Error(`Config file not found: ${displayPath}`);
  }

  const moduleValue = (await import(pathToFileURL(resolvedPath).href)) as LoadConfigModule;
  return moduleValue.default;
}

function createDriftReport(params: {
  environment: string;
  localValues: EnvMap;
  remoteValues: EnvMap;
}): ValidationReport {
  const localKeys = Object.keys(params.localValues).sort((left, right) =>
    left.localeCompare(right),
  );
  const remoteKeys = Object.keys(params.remoteValues).sort((left, right) =>
    left.localeCompare(right),
  );

  const remoteSet = new Set(remoteKeys);
  const localSet = new Set(localKeys);

  const missingInRemote = localKeys.filter((key) => !remoteSet.has(key));
  const extraInRemote = remoteKeys.filter((key) => !localSet.has(key));
  const mismatches = localKeys
    .filter((key) => remoteSet.has(key))
    .filter((key) => (params.localValues[key] ?? "") !== (params.remoteValues[key] ?? ""));

  const issues = [
    ...missingInRemote.map((key) => ({
      code: "ENV_MISSING" as const,
      type: "missing" as const,
      severity: "warning" as const,
      key,
      environment: params.environment,
      message: `Variable ${key} is missing in remote source.`,
      value: null,
    })),
    ...extraInRemote.map((key) => ({
      code: "ENV_EXTRA" as const,
      type: "extra" as const,
      severity: "warning" as const,
      key,
      environment: params.environment,
      message: `Variable ${key} exists only in remote source.`,
      value: null,
    })),
    ...mismatches.map((key) => ({
      code: "ENV_INVALID_VALUE" as const,
      type: "invalid_value" as const,
      severity: "warning" as const,
      key,
      environment: params.environment,
      message: `Variable ${key} differs between local and remote values.`,
      value: null,
    })),
  ];

  return {
    schemaVersion: 1,
    status: issues.length > 0 ? "fail" : "ok",
    summary: {
      errors: 0,
      warnings: issues.length,
      total: issues.length,
    },
    issues,
    meta: {
      env: params.environment,
      timestamp: new Date().toISOString(),
    },
    recommendations:
      issues.length > 0
        ? [
            "Review sync drift before any write operation.",
            "Resolve missing, extra, and mismatched variables before production sync.",
          ]
        : ["No drift detected between local and remote sources."],
  };
}

function resolveApplyMode(values: SyncApplyArgValues): ApplyMode {
  return values.apply === true ? "apply" : "dry-run";
}

function resolveOrchestrationStrategy(values: SyncApplyArgValues): OrchestrationStrategy {
  const strategy = values.strategy ?? "fail-fast";
  if (strategy === "fail-fast" || strategy === "fail-late") {
    return strategy;
  }

  throw new Error("Invalid --strategy. Allowed values: fail-fast, fail-late.");
}

function resolveMaxConcurrency(values: SyncApplyArgValues): number {
  if (values["max-concurrency"] === undefined) {
    return 1;
  }

  const parsed = Number.parseInt(values["max-concurrency"], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Invalid --max-concurrency. Expected a positive integer.");
  }

  return parsed;
}

function resolvePromotionStage(params: {
  mode: ApplyMode;
  policyDecision: ReturnType<typeof evaluatePolicy>["decision"];
}): PromotionStage {
  if (params.mode === "apply") {
    return "apply";
  }

  return params.policyDecision === "block" ? "advisory" : "enforce";
}

function resolveProtectedBranch(values: SyncApplyArgValues): boolean {
  if (values["protected-branch"] === true) {
    return true;
  }

  return process.env.GITHUB_REF_PROTECTED === "true";
}

function hasPreflightArtifact(values: SyncApplyArgValues): boolean {
  if (values["preflight-file"] === undefined) {
    return false;
  }

  return existsSync(path.resolve(values["preflight-file"]));
}

async function loadPreflightProof(values: SyncApplyArgValues): Promise<unknown> {
  if (values["preflight-file"] === undefined) {
    return null;
  }

  const filePath = path.resolve(values["preflight-file"]);
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (typeof parsed === "object" && parsed !== null && "preflightProof" in parsed) {
    return (parsed as { preflightProof: unknown }).preflightProof;
  }

  return parsed;
}

function resolvePreflightPayload(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return input;
  }

  const record = input as Record<string, unknown>;
  if (record.preflightAttestation !== undefined) {
    return record.preflightAttestation;
  }
  if (record.preflightProof !== undefined) {
    return record.preflightProof;
  }

  return input;
}

function getWritePolicy(config: EnvTypegenConfig | undefined): EnvTypegenWritePolicyConfig {
  const candidate = config?.writePolicy;
  return candidate ?? {};
}

function buildAuditEvent(params: {
  event: AuditEvent["event"];
  level: AuditEvent["level"];
  correlationId: string;
  provider: string;
  environment: string;
  mode: ApplyMode;
  policyDecision: AuditEvent["policyDecision"];
  changeSetHash?: string;
  evidenceBundleId?: string;
  evidenceHash?: string;
  evidenceSignatureId?: string;
  forensicsIndexId?: string;
  forensicsIndexHash?: string;
  operationStatuses?: AuditEvent["operationStatuses"];
  message: string;
  reasons?: string[];
  summary?: AuditEvent["summary"];
}): AuditEvent {
  return {
    timestamp: new Date().toISOString(),
    event: params.event,
    level: params.level,
    command: "sync-apply",
    correlationId: params.correlationId,
    provider: params.provider,
    environment: params.environment,
    mode: params.mode,
    policyDecision: params.policyDecision,
    ...(params.changeSetHash === undefined ? {} : { changeSetHash: params.changeSetHash }),
    ...(params.evidenceBundleId === undefined ? {} : { evidenceBundleId: params.evidenceBundleId }),
    ...(params.evidenceHash === undefined ? {} : { evidenceHash: params.evidenceHash }),
    ...(params.evidenceSignatureId === undefined
      ? {}
      : { evidenceSignatureId: params.evidenceSignatureId }),
    ...(params.forensicsIndexId === undefined ? {} : { forensicsIndexId: params.forensicsIndexId }),
    ...(params.forensicsIndexHash === undefined
      ? {}
      : { forensicsIndexHash: params.forensicsIndexHash }),
    ...(params.operationStatuses === undefined
      ? {}
      : { operationStatuses: params.operationStatuses }),
    ...(params.summary !== undefined && { summary: params.summary }),
    ...(params.reasons !== undefined && { reasons: params.reasons }),
    message: params.message,
  };
}

async function resolvePreflightValidation(params: {
  mode: ApplyMode;
  requiresPreflight: boolean;
  values: SyncApplyArgValues;
  providerName: string;
  environment: string;
  changeSetHash: string;
  usedAttestationIds: Set<string>;
}): Promise<{ isValid: boolean; reasons: string[] }> {
  if (!(params.mode === "apply" && params.requiresPreflight)) {
    return { isValid: true, reasons: [] };
  }

  if (!hasPreflightArtifact(params.values)) {
    return {
      isValid: false,
      reasons: ["A valid preflight proof is required before apply mode."],
    };
  }

  const payload = resolvePreflightPayload(await loadPreflightProof(params.values));
  const attestationValidation = validatePreflightAttestation({
    attestation: payload,
    provider: params.providerName,
    environment: params.environment,
    changeSetHash: params.changeSetHash,
    usedAttestationIds: params.usedAttestationIds,
  });

  if (attestationValidation.isValid) {
    const parsed = payload as { attestationId: string };
    params.usedAttestationIds.add(parsed.attestationId);
    return attestationValidation;
  }

  return validatePreflightProof({
    proof: payload,
    provider: params.providerName,
    environment: params.environment,
    changeSetHash: params.changeSetHash,
  });
}

function resolveConfirmationTokenValidation(params: {
  mode: ApplyMode;
  values: SyncApplyArgValues;
  providerName: string;
  environment: string;
  changeSetHash: string;
  correlationId: string;
}): ApplyConfirmationTokenValidationResult {
  if (params.mode === "dry-run") {
    return {
      isValid: true,
      reasons: [],
    };
  }

  return validateApplyConfirmationToken({
    token: params.values["confirmation-token"],
    provider: params.providerName,
    environment: params.environment,
    changeSetHash: params.changeSetHash,
    expectedCorrelationId: params.correlationId,
  });
}

// The token is spent only when every guard allows the apply, right before any write.
// A run blocked by another guard leaves the token usable for the corrected retry.
// Dry-run carries no token payload, so there is nothing to spend.
async function spendConfirmationToken(params: {
  guardResult: WriteGuardResult;
  confirmationTokenValidation: ApplyConfirmationTokenValidationResult;
  nonceStorePath: string;
}): Promise<WriteGuardResult> {
  const tokenPayload = params.confirmationTokenValidation.payload;
  if (!params.guardResult.allowed || tokenPayload === undefined) {
    return params.guardResult;
  }

  const nonceClaim = await claimConfirmationNonce({
    storePath: params.nonceStorePath,
    nonce: tokenPayload.nonce,
    expiresAt: tokenPayload.expiresAt,
  });
  if (nonceClaim.isClaimed) {
    return params.guardResult;
  }

  return {
    allowed: false,
    reasons: [nonceClaim.reason],
    requiredChecks: params.guardResult.requiredChecks,
  };
}

function buildInitialLifecycleEvents(params: {
  providerName: string;
  environment: string;
  mode: ApplyMode;
  policyDecision: AuditEvent["policyDecision"];
  correlationId: string;
  changeSetHash: string;
  evidenceBundleId: string;
  preflightValidation: { isValid: boolean; reasons: string[] };
}): AuditEvent[] {
  const lifecycleEvents: AuditEvent[] = [
    buildAuditEvent({
      event: "sync-apply.requested",
      level: "info",
      correlationId: params.correlationId,
      provider: params.providerName,
      environment: params.environment,
      mode: params.mode,
      policyDecision: params.policyDecision,
      changeSetHash: params.changeSetHash,
      evidenceBundleId: params.evidenceBundleId,
      message: "Sync apply request accepted for guard evaluation.",
    }),
  ];

  if (params.mode === "apply" && params.preflightValidation.isValid) {
    lifecycleEvents.push(
      buildAuditEvent({
        event: "sync-apply.preflight-validated",
        level: "info",
        correlationId: params.correlationId,
        provider: params.providerName,
        environment: params.environment,
        mode: params.mode,
        policyDecision: params.policyDecision,
        changeSetHash: params.changeSetHash,
        evidenceBundleId: params.evidenceBundleId,
        message: "Preflight proof validated successfully.",
      }),
    );
  }

  return lifecycleEvents;
}

export async function runSyncApplyCommand(argv: string[]): Promise<number> {
  const parsed = parseArgs({
    args: argv,
    options: {
      provider: { type: "string" },
      env: { type: "string" },
      "env-file": { type: "string" },
      config: { type: "string", short: "c" },
      json: { type: "boolean" },
      apply: { type: "boolean" },
      "preflight-file": { type: "string" },
      "protected-branch": { type: "boolean" },
      "confirmation-token": { type: "string" },
      override: { type: "boolean" },
      reason: { type: "string" },
      strategy: { type: "string" },
      "max-concurrency": { type: "string" },
      help: { type: "boolean", short: "h" },
    } as const,
    allowPositionals: true,
  });

  const values = parsed.values as SyncApplyArgValues;
  if (values.help === true) {
    console.log(SYNC_APPLY_HELP_TEXT);
    return 0;
  }

  return executeSyncApply(values, parsed.positionals);
}

function emitBlockedOutput(params: {
  values: SyncApplyArgValues;
  providerName: string;
  environment: string;
  mode: ApplyMode;
  policy: ReturnType<typeof evaluatePolicy>;
  guardResult: ReturnType<typeof evaluateWriteGuards>;
  changeSet: ReturnType<typeof buildChangeSetFromMaps>;
  evidenceBundle: EvidenceBundle;
  governanceSummary: ReturnType<typeof buildGovernanceSummary>;
  auditEvents: AuditEvent[];
  auditLines: string[];
}): void {
  if (params.values.json === true) {
    process.stdout.write(
      `${JSON.stringify({
        command: "sync-apply",
        provider: params.providerName,
        environment: params.environment,
        mode: params.mode,
        allowed: false,
        policy: params.policy,
        guardResult: params.guardResult,
        changeSet: params.changeSet,
        evidenceBundle: params.evidenceBundle,
        governanceSummary: params.governanceSummary,
        auditLifecycle: params.auditEvents,
        audits: params.auditLines.map((line) => line.trim()),
      })}\n`,
    );
    return;
  }

  process.stdout.write(params.auditEvents.map((event) => formatAuditEvent(event)).join(""));
}

function emitCompletedOutput(params: {
  values: SyncApplyArgValues;
  providerName: string;
  environment: string;
  mode: ApplyMode;
  policy: ReturnType<typeof evaluatePolicy>;
  guardResult: ReturnType<typeof evaluateWriteGuards>;
  changeSet: ReturnType<typeof buildChangeSetFromMaps>;
  applyResult: Awaited<ReturnType<typeof runApplyEngineV2>>;
  orchestration: OrchestrationResult<ApplyExecutionResultV2>;
  evidenceBundle: EvidenceBundle;
  governanceSummary: ReturnType<typeof buildGovernanceSummary>;
  auditEvents: AuditEvent[];
  auditLines: string[];
}): void {
  if (params.values.json === true) {
    process.stdout.write(
      `${JSON.stringify({
        command: "sync-apply",
        provider: params.providerName,
        environment: params.environment,
        mode: params.mode,
        policy: params.policy,
        guardResult: params.guardResult,
        changeSet: params.changeSet,
        apply: params.applyResult,
        orchestration: params.orchestration,
        evidenceBundle: params.evidenceBundle,
        governanceSummary: params.governanceSummary,
        auditLifecycle: params.auditEvents,
        audits: params.auditLines.map((line) => line.trim()),
      })}\n`,
    );
    return;
  }

  process.stdout.write(params.auditEvents.map((event) => formatAuditEvent(event)).join(""));
}

function attachEvidenceChainToAuditEvents(params: {
  events: AuditEvent[];
  evidenceBundle: EvidenceBundle;
}): AuditEvent[] {
  const tailEventIndex = params.events.length - 1;
  if (tailEventIndex < 0) {
    return params.events;
  }

  return params.events.map((event, index) => {
    if (index !== tailEventIndex) {
      return event;
    }

    return {
      ...event,
      evidenceHash: params.evidenceBundle.bundleHash,
      evidenceSignatureId: params.evidenceBundle.signature.signatureId,
      forensicsIndexId: params.evidenceBundle.forensicsIndex.indexId,
      forensicsIndexHash: params.evidenceBundle.forensicsIndex.indexHash,
    };
  });
}

async function executeSyncApply(
  values: SyncApplyArgValues,
  positionals: string[],
): Promise<number> {
  try {
    return await executeSyncApplyUnsafe(values, positionals);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`env-typegen sync-apply: ${message}\n`);
    return 1;
  }
}

async function executeSyncApplyUnsafe(
  values: SyncApplyArgValues,
  positionals: string[],
): Promise<number> {
  const providerName = resolveProviderName(values, positionals);
  const environment = values.env ?? "development";
  const envFile = values["env-file"] ?? ".env";
  const mode = resolveApplyMode(values);
  const strategy = resolveOrchestrationStrategy(values);
  const maxConcurrency = resolveMaxConcurrency(values);

  const config = await loadSyncApplyConfig(values.config);
  const providerConfig = config?.providers?.[providerName];
  if (providerConfig === undefined) {
    throw new Error(`Provider "${providerName}" is not configured in env-typegen config.`);
  }

  const writePolicy = getWritePolicy(config);
  const adapter = await loadAdapter(providerConfig.adapter, { cwd: process.cwd() });
  const remote = await adapter.pull({
    environment,
    ...(providerConfig.projectId !== undefined && { projectId: providerConfig.projectId }),
    ...(providerConfig.token !== undefined && { token: providerConfig.token }),
    ...(providerConfig.options !== undefined && { providerConfig: providerConfig.options }),
    redactValues: true,
  });

  const local = await loadEnvSource({ filePath: envFile, allowMissing: true });
  const driftReport = createDriftReport({
    environment: `remote:${providerName}/${environment}`,
    localValues: local,
    remoteValues: remote.values,
  });
  const policy = evaluatePolicy(driftReport, config?.policy);
  const changeSet = buildChangeSetFromMaps({ localValues: local, remoteValues: remote.values });
  const changeSetHash = calculateChangeSetHash(changeSet);
  const correlationId = buildSyncApplyCorrelationId({
    provider: providerName,
    environment,
    mode,
    changeSetHash,
  });
  const evidenceBundleId = `${correlationId}:evidence:v1`;
  const usedAttestationIds = new Set<string>();

  const requiresPreflight = writePolicy.requirePreflight ?? true;
  const preflightValidation = await resolvePreflightValidation({
    mode,
    requiresPreflight,
    values,
    providerName,
    environment,
    changeSetHash,
    usedAttestationIds,
  });
  const confirmationTokenValidation = resolveConfirmationTokenValidation({
    mode,
    values,
    providerName,
    environment,
    changeSetHash,
    correlationId,
  });

  const hasOverrideReason =
    values.override === true ? (values.reason ?? "").trim().length > 0 : true;

  const guardResult = await spendConfirmationToken({
    guardResult: evaluateWriteGuards({
      mode,
      environment,
      policyDecision: policy.decision,
      writeEnabled: mode === "dry-run" ? true : (writePolicy.enableApply ?? false),
      isProtectedEnvironment: (writePolicy.protectedEnvironments ?? []).includes(environment),
      isProtectedBranch: resolveProtectedBranch(values),
      preflightValidation,
      confirmationTokenValidation,
      hasOverrideReason,
      attestationValidation: preflightValidation,
    }),
    confirmationTokenValidation,
    nonceStorePath: writePolicy.confirmationNonceStorePath ?? DEFAULT_CONFIRMATION_NONCE_STORE_PATH,
  });

  const lifecycleEvents = buildInitialLifecycleEvents({
    providerName,
    environment,
    mode,
    policyDecision: policy.decision,
    correlationId,
    changeSetHash,
    evidenceBundleId,
    preflightValidation,
  });

  if (!guardResult.allowed) {
    return handleBlockedApply({
      values,
      providerName,
      environment,
      mode,
      policy,
      guardResult,
      changeSet,
      correlationId,
      changeSetHash,
      evidenceBundleId,
      lifecycleEvents,
      strategy,
      ...(writePolicy.auditLogPath === undefined ? {} : { auditLogPath: writePolicy.auditLogPath }),
    });
  }

  return handleAllowedApply({
    values,
    providerName,
    environment,
    mode,
    policy,
    guardResult,
    changeSet,
    correlationId,
    changeSetHash,
    evidenceBundleId,
    lifecycleEvents,
    adapter,
    providerConfig,
    writePolicy,
    strategy,
    maxConcurrency,
    local,
    ...(writePolicy.auditLogPath === undefined ? {} : { auditLogPath: writePolicy.auditLogPath }),
  });
}

function buildFailedApplyResult(params: {
  mode: ApplyMode;
  changeSet: ReturnType<typeof buildChangeSetFromMaps>;
  errorMessage: string;
}): ApplyExecutionResultV2 {
  const operations: ApplyOperationResultV2[] = params.changeSet.operations.map((operation) => {
    if (operation.action === "no-op") {
      return {
        key: operation.key,
        action: operation.action,
        status: "skipped",
        failureKind: "none",
        message: "No-op operation; remote value already aligned.",
      };
    }

    return {
      key: operation.key,
      action: operation.action,
      status: "failed",
      failureKind: "permanent",
      message: `Orchestrated apply failed before execution. ${params.errorMessage}`,
    };
  });

  const failed = operations.filter((operation) => operation.status === "failed").length;
  const skipped = operations.filter((operation) => operation.status === "skipped").length;
  const total = operations.length;

  return {
    summary: {
      mode: params.mode,
      planned: 0,
      applied: 0,
      failed,
      skipped,
      total,
      atomic: false,
    },
    operations,
    compensationPlan: {
      version: 1,
      deterministic: true,
      operations: operations.map((operation) => ({
        key: operation.key,
        status: "compensation-not-required" as const,
        action: "none" as const,
        reason: "Compensation not required because forward execution never completed.",
      })),
      summary: {
        planned: 0,
        notRequired: total,
        total,
      },
    },
    reconciliationPlan: {
      version: 1,
      deterministic: true,
      operations: operations.map((operation) => ({
        key: operation.key,
        action: operation.action,
        status: operation.status,
        reason: operation.message,
        rollbackAction: operation.status === "failed" ? "update" : "none",
      })),
      summary: {
        planned: 0,
        applied: 0,
        failed,
        skipped,
        total,
      },
    },
    rollbackSimulation: {
      version: 1,
      canRollback: false,
      operations: operations.map((operation) => ({
        key: operation.key,
        status: operation.status === "failed" ? "rollback-blocked" : "no-rollback",
        rollbackAction: operation.status === "failed" ? "update" : "none",
        message: operation.message,
      })),
      summary: {
        rollbackPlanned: 0,
        rollbackBlocked: failed,
        noRollback: skipped,
        total,
      },
    },
    budget: {
      allowed: false,
      limitsApplied: [],
      reasons: ["Orchestrated apply terminated before provider execution."],
      slo: {
        status: "breach",
        violations: ["SLO evaluation unavailable because provider execution did not complete."],
        throttleFactor: 0.25,
        allowPromotion: false,
        metrics: {
          total,
          durationMs: 0,
          failureRate: total === 0 ? 0 : failed / total,
          successRate: 0,
        },
      },
      durationMs: 0,
    },
  };
}

async function handleBlockedApply(params: {
  values: SyncApplyArgValues;
  providerName: string;
  environment: string;
  mode: ApplyMode;
  policy: ReturnType<typeof evaluatePolicy>;
  guardResult: ReturnType<typeof evaluateWriteGuards>;
  changeSet: ReturnType<typeof buildChangeSetFromMaps>;
  correlationId: string;
  changeSetHash: string;
  evidenceBundleId: string;
  lifecycleEvents: AuditEvent[];
  strategy: OrchestrationStrategy;
  auditLogPath?: string;
}): Promise<number> {
  const blockedEvent = buildAuditEvent({
    event: "sync-apply.blocked",
    level: "warning",
    correlationId: params.correlationId,
    provider: params.providerName,
    environment: params.environment,
    mode: params.mode,
    policyDecision: params.policy.decision,
    changeSetHash: params.changeSetHash,
    evidenceBundleId: params.evidenceBundleId,
    reasons: params.guardResult.reasons,
    message: "Sync apply blocked by policy/guardrails.",
  });
  const baseAuditEvents = [...params.lifecycleEvents, blockedEvent];
  const rollout = evaluateFleetRollout({
    stage: resolvePromotionStage({
      mode: params.mode,
      policyDecision: params.policy.decision,
    }),
    strategy: params.strategy,
    orchestration: {
      aborted: true,
      rejected: 1,
    },
    ...(params.policy.decision === "block"
      ? {
          sloEvaluation: {
            status: "breach" as const,
            allowPromotion: false,
          },
        }
      : {}),
  });
  const governanceSummaryBase = buildGovernanceSummary({
    provider: params.providerName,
    environment: params.environment,
    mode: params.mode,
    policyDecision: params.policy.decision,
    guardAllowed: params.guardResult.allowed,
    auditEvents: baseAuditEvents.length,
    rollout,
  });
  const evidenceBundle = buildEvidenceBundle({
    provider: params.providerName,
    environment: params.environment,
    mode: params.mode,
    correlationId: params.correlationId,
    changeSetHash: params.changeSetHash,
    governanceSummary: governanceSummaryBase,
    auditEvents: baseAuditEvents,
  });
  const auditEvents = attachEvidenceChainToAuditEvents({
    events: baseAuditEvents,
    evidenceBundle,
  });
  const auditLines = await writeAuditEvents({
    events: auditEvents,
    ...(params.auditLogPath === undefined ? {} : { filePath: params.auditLogPath }),
  });
  const governanceSummary = buildGovernanceSummary({
    provider: params.providerName,
    environment: params.environment,
    mode: params.mode,
    policyDecision: params.policy.decision,
    guardAllowed: params.guardResult.allowed,
    auditEvents: auditEvents.length,
    rollout,
    evidence: {
      schemaVersion: evidenceBundle.schemaVersion,
      bundleId: evidenceBundle.bundleId,
      bundleHash: evidenceBundle.bundleHash,
      lifecycleHash: evidenceBundle.audit.lifecycleHash,
    },
  });

  emitBlockedOutput({
    values: params.values,
    providerName: params.providerName,
    environment: params.environment,
    mode: params.mode,
    policy: params.policy,
    guardResult: params.guardResult,
    changeSet: params.changeSet,
    evidenceBundle,
    governanceSummary,
    auditEvents,
    auditLines,
  });

  return 1;
}

async function handleAllowedApply(params: {
  values: SyncApplyArgValues;
  providerName: string;
  environment: string;
  mode: ApplyMode;
  policy: ReturnType<typeof evaluatePolicy>;
  guardResult: ReturnType<typeof evaluateWriteGuards>;
  changeSet: ReturnType<typeof buildChangeSetFromMaps>;
  correlationId: string;
  changeSetHash: string;
  evidenceBundleId: string;
  lifecycleEvents: AuditEvent[];
  adapter: Awaited<ReturnType<typeof loadAdapter>>;
  providerConfig: NonNullable<EnvTypegenConfig["providers"]>[string];
  writePolicy: EnvTypegenWritePolicyConfig;
  strategy: OrchestrationStrategy;
  maxConcurrency: number;
  local: EnvMap;
  auditLogPath?: string;
}): Promise<number> {
  const runningEvents = [...params.lifecycleEvents];
  if (params.mode === "apply") {
    runningEvents.push(
      buildAuditEvent({
        event: "sync-apply.apply-started",
        level: "info",
        correlationId: params.correlationId,
        provider: params.providerName,
        environment: params.environment,
        mode: params.mode,
        policyDecision: params.policy.decision,
        changeSetHash: params.changeSetHash,
        evidenceBundleId: params.evidenceBundleId,
        message: "Provider apply execution started.",
      }),
    );
  }

  const promotionStage = resolvePromotionStage({
    mode: params.mode,
    policyDecision: params.policy.decision,
  });

  const orchestration = await runBoundedOrchestration({
    maxConcurrency: params.maxConcurrency,
    strategy: params.strategy,
    tasks: [
      {
        target: `${params.providerName}/${params.environment}`,
        stage: promotionStage,
        run: async () =>
          runApplyEngineV2({
            adapter: params.adapter,
            adapterContext: {
              environment: params.environment,
              ...(params.providerConfig.projectId !== undefined && {
                projectId: params.providerConfig.projectId,
              }),
              ...(params.providerConfig.token !== undefined && {
                token: params.providerConfig.token,
              }),
              ...(params.providerConfig.options !== undefined && {
                providerConfig: params.providerConfig.options,
              }),
              redactValues: true,
            },
            localValues: params.local,
            changeSet: params.changeSet,
            mode: params.mode,
            ...(params.writePolicy.executionBudget === undefined
              ? {}
              : { executionBudget: params.writePolicy.executionBudget }),
          }),
      },
    ],
  });

  const applyResult =
    orchestration.results[0]?.status === "fulfilled"
      ? orchestration.results[0].value
      : buildFailedApplyResult({
          mode: params.mode,
          changeSet: params.changeSet,
          errorMessage:
            orchestration.results[0]?.status === "rejected"
              ? orchestration.results[0].errorMessage
              : "Execution was skipped by orchestration policy.",
        });

  const rollout = evaluateFleetRollout({
    stage: promotionStage,
    strategy: params.strategy,
    orchestration: {
      aborted: orchestration.summary.aborted,
      rejected: orchestration.summary.rejected,
    },
    ...(applyResult.budget.slo === undefined
      ? {}
      : {
          sloEvaluation: {
            status: applyResult.budget.slo.status,
            allowPromotion: applyResult.budget.slo.allowPromotion,
          },
        }),
  });

  const hasFailures = applyResult.summary.failed > 0;
  const completedEvent = buildAuditEvent({
    event: hasFailures ? "sync-apply.apply-failed" : "sync-apply.completed",
    level: hasFailures ? "error" : "info",
    correlationId: params.correlationId,
    provider: params.providerName,
    environment: params.environment,
    mode: params.mode,
    policyDecision: params.policy.decision,
    changeSetHash: params.changeSetHash,
    evidenceBundleId: params.evidenceBundleId,
    operationStatuses: {
      planned: applyResult.summary.planned,
      applied: applyResult.summary.applied,
      failed: applyResult.summary.failed,
      skipped: applyResult.summary.skipped,
    },
    summary: {
      planned: applyResult.summary.planned,
      applied: applyResult.summary.applied,
      failed: applyResult.summary.failed,
      skipped: applyResult.summary.skipped,
      total: applyResult.summary.total,
    },
    message: hasFailures
      ? "Sync apply finished with failures; manual intervention required."
      : "Sync apply finished successfully.",
  });

  const baseAuditEvents = [...runningEvents, completedEvent];
  const governanceSummaryBase = buildGovernanceSummary({
    provider: params.providerName,
    environment: params.environment,
    mode: params.mode,
    policyDecision: params.policy.decision,
    guardAllowed: params.guardResult.allowed,
    auditEvents: baseAuditEvents.length,
    applySummary: applyResult.summary,
    rollout,
  });
  const evidenceBundle = buildEvidenceBundle({
    provider: params.providerName,
    environment: params.environment,
    mode: params.mode,
    correlationId: params.correlationId,
    changeSetHash: params.changeSetHash,
    governanceSummary: governanceSummaryBase,
    auditEvents: baseAuditEvents,
    apply: {
      summary: applyResult.summary,
      budget: applyResult.budget,
      reconciliation: applyResult.reconciliationPlan.summary,
      compensation: applyResult.compensationPlan.summary,
      rollbackSimulation: {
        canRollback: applyResult.rollbackSimulation.canRollback,
        rollbackPlanned: applyResult.rollbackSimulation.summary.rollbackPlanned,
        rollbackBlocked: applyResult.rollbackSimulation.summary.rollbackBlocked,
        noRollback: applyResult.rollbackSimulation.summary.noRollback,
        total: applyResult.rollbackSimulation.summary.total,
      },
    },
  });
  const auditEvents = attachEvidenceChainToAuditEvents({
    events: baseAuditEvents,
    evidenceBundle,
  });
  const auditLines = await writeAuditEvents({
    events: auditEvents,
    ...(params.auditLogPath === undefined ? {} : { filePath: params.auditLogPath }),
  });
  const governanceSummary = buildGovernanceSummary({
    provider: params.providerName,
    environment: params.environment,
    mode: params.mode,
    policyDecision: params.policy.decision,
    guardAllowed: params.guardResult.allowed,
    auditEvents: auditEvents.length,
    applySummary: applyResult.summary,
    rollout,
    evidence: {
      schemaVersion: evidenceBundle.schemaVersion,
      bundleId: evidenceBundle.bundleId,
      bundleHash: evidenceBundle.bundleHash,
      lifecycleHash: evidenceBundle.audit.lifecycleHash,
    },
  });

  emitCompletedOutput({
    values: params.values,
    providerName: params.providerName,
    environment: params.environment,
    mode: params.mode,
    policy: params.policy,
    guardResult: params.guardResult,
    changeSet: params.changeSet,
    applyResult,
    orchestration,
    evidenceBundle,
    governanceSummary,
    auditEvents,
    auditLines,
  });

  return hasFailures ? 1 : 0;
}
