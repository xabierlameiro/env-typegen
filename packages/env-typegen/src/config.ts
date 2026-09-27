import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { InferenceRule } from "./inferrer/rules.js";
import type { ExecutionBudget } from "./ops/execution-budget.js";
import type { IncidentState, IncidentStatus } from "./ops/incident-state.js";
import type { SloPolicy } from "./ops/slo-policy.js";
import type { PluginReference } from "./plugins.js";
import type { PolicyDistributionChannel, PolicyDistributionSink } from "./policy/policy-channel.js";
import type { EnvTypegenPolicyConfig } from "./policy/policy-model.js";
import type {
  FleetEnforcementLevel,
  FleetPolicyChannel,
  GovernanceTemplateId,
} from "./templates/governance-template.js";
import type { ExternalTrustRootConfig } from "./trust/external-trust-root.js";

export type { InferenceRule } from "./inferrer/rules.js";
export type { PluginReference } from "./plugins.js";
export type { EnvTypegenPolicyConfig } from "./policy/policy-model.js";

/** Write controls for sync-apply operations. */
export type EnvTypegenWritePolicyConfig = {
  /** Enable remote apply mode. Defaults to false. */
  enableApply?: boolean;
  /** Environments that require protected branch execution. */
  protectedEnvironments?: string[];
  /** Require an explicit preflight artifact path before apply. Defaults to true. */
  requirePreflight?: boolean;
  /** Optional JSONL audit trail output path. */
  auditLogPath?: string;
  /**
   * Directory that records used confirmation tokens so a later process cannot replay one.
   * Defaults to `.env-typegen/confirmation-nonces` under the working directory.
   */
  confirmationNonceStorePath?: string;
  /** Optional execution budget guardrails for apply operations. */
  executionBudget?: ExecutionBudget;
  /** Optional SLO policy used to derive operational readiness during apply orchestration. */
  sloPolicy?: SloPolicy;
  /** Optional pre-existing incident state used to throttle orchestration safely. */
  incidentState?:
    | IncidentState
    | {
        status: IncidentStatus;
        reason?: string;
        since?: string;
        consecutiveBreaches?: number;
        throttleFactor?: number;
      };
};

/** Lockfile controls for policy pack integrity pinning. */
export type EnvTypegenPolicyPackLockConfig = {
  /** Path to the lock file consumed by policy pack resolution. */
  path?: string;
  /** Fail when a referenced pack has no lock entry. Defaults to true. */
  strict?: boolean;
};

/** Remote policy pack fetch behavior for retry/cache/offline use cases. */
export type EnvTypegenPolicyPackFetchConfig = {
  /** Per-request timeout for remote pack fetches. */
  timeoutMs?: number;
  /** Maximum retry attempts for retryable failures. */
  maxRetries?: number;
  /** Base retry delay in milliseconds (exponential backoff). */
  retryDelayMs?: number;
  /** Cache freshness window in milliseconds. */
  cacheTtlMs?: number;
  /** Optional cache directory path for remote policy packs. */
  cacheDir?: string;
  /** When true, only cached remote packs are allowed. */
  offline?: boolean;
};

/** Trust controls for policy pack signature/provenance validation. */
export type EnvTypegenPolicyPackTrustConfig = {
  /** Validation mode. strict blocks on missing/invalid signatures, tolerant allows unsigned packs. */
  mode?: "strict" | "tolerant";
  /** Optional signer allow-list for trusted policy pack sources. */
  allowedSigners?: string[];
  /** Enforce signature expiration checks when true. */
  enforceExpiry?: boolean;
  /** Optional external trust root source for provider-scoped keyring material. */
  externalTrustRoot?: ExternalTrustRootConfig;
};

/** Policy distribution settings for channel-based publication and promotion. */
export type EnvTypegenPolicyDistributionConfig = {
  /** Default channel used when command/runtime does not provide one explicitly. */
  channel?: PolicyDistributionChannel;
  /** Publication sink strategy. */
  sink?: PolicyDistributionSink;
  /** Base destination path/identifier for distribution artifacts. */
  destination?: string;
};

/** Template defaults for multi-repo bootstrap and staged governance rollout. */
export type EnvTypegenTemplatesConfig = {
  /** Default template used when a fleet manifest entry omits `template`. */
  defaultTemplate?: GovernanceTemplateId;
  /** Optional default enforcement level for template-resolved entries. */
  defaultEnforcementLevel?: FleetEnforcementLevel;
  /** Optional default policy distribution channel for template-resolved entries. */
  defaultPolicyChannel?: FleetPolicyChannel;
};

/** Generator identifiers supported by env-typegen. */
export type GeneratorName = "typescript" | "zod" | "t3" | "declaration";

/** Rule set applied globally or per environment during validation. */
export type EnvTypegenRuleSet = {
  /** Treat undeclared variables as hard errors when true. */
  strict?: boolean;
  /** Allow variables that are not declared in the schema. */
  allowExtra?: boolean;
  /** Require all schema variables to be present in the target source. */
  requireAll?: boolean;
};

/** Validation policy configuration. */
export type EnvTypegenRulesConfig = EnvTypegenRuleSet & {
  /** Optional overrides keyed by logical environment name. */
  perEnvironment?: Record<string, EnvTypegenRuleSet>;
};

/** Runtime source mapping for a logical environment. */
export type EnvTypegenEnvironmentConfig = {
  /** Source identifier or source chain (e.g. "local", "vercel"). */
  source: string | string[];
  /** Optional provider-specific environment aliases. */
  targets?: string[];
  /** Provider-specific extension point. */
  metadata?: Record<string, unknown>;
};

/** Adapter provider configuration loaded by command runtime. */
export type EnvTypegenProviderConfig = {
  /** Adapter module specifier (e.g. "@env-typegen/adapter-vercel"). */
  adapter: string;
  /** Common optional credentials/context hints. */
  token?: string;
  projectId?: string;
  /** Adapter-specific extension point. */
  options?: Record<string, unknown>;
};

/** Configuration shape accepted by env-typegen's CLI and programmatic API. */
export type EnvTypegenConfig = {
  /** Config schema version for compatibility checks. */
  version?: number;
  /** Path(s) to the .env.example file(s) to parse. */
  input: string | string[];
  /** Output directory for generated files. Defaults to the input file's directory. */
  output?: string;
  /** Which generators to run. When omitted, all four generators run. */
  generators?: GeneratorName[];
  /** Format generated output with prettier. Defaults to true. */
  format?: boolean;
  /**
   * Additional inference rules to prepend before the built-in rules.
   * Rules are matched in ascending priority order; lower numbers win.
   */
  inferenceRules?: InferenceRule[];

  /**
   * Path to the contract file (`env.contract.ts`).
   * When provided, the contract is the authoritative source of type information.
   * Relative to the config file directory or `process.cwd()`.
   */
  schemaFile?: string;

  /**
   * When `true`, variables absent from the contract emit errors rather than warnings.
   * Defaults to `true`.
   */
  strict?: boolean;

  /**
   * Resolution strategy for type information.
   * - `"legacy"` (default): inference-first; annotations override inferred types.
   * - `"contract-first"`: contract is authoritative; inference is a fallback only.
   */
  schemaMode?: "legacy" | "contract-first";

  /** Default target files for `env-typegen diff` when --targets is omitted. */
  diffTargets?: string[];

  /** Plugin references (module paths or plugin objects). */
  plugins?: PluginReference[];

  /** Logical environments (development/preview/production) and their source mapping. */
  environments?: Record<string, EnvTypegenEnvironmentConfig>;

  /** Provider registry used by adapters and runtime sync commands. */
  providers?: Record<string, EnvTypegenProviderConfig>;

  /** Validation policy for governance workflows. */
  rules?: EnvTypegenRulesConfig;

  /** Policy engine configuration for plan/sync-preview preflight decisions. */
  policy?: EnvTypegenPolicyConfig;

  /** Policy pack lockfile controls. */
  policyPackLock?: EnvTypegenPolicyPackLockConfig;

  /** Policy pack remote fetch controls. */
  policyPackFetch?: EnvTypegenPolicyPackFetchConfig;

  /** Policy pack trust/signature validation controls. */
  policyPackTrust?: EnvTypegenPolicyPackTrustConfig;

  /** Policy distribution settings for channel-aware governance rollout. */
  policyDistribution?: EnvTypegenPolicyDistributionConfig;

  /** Template defaults used for multi-repo bootstrap orchestration. */
  templates?: EnvTypegenTemplatesConfig;

  /** Write controls for sync-apply runtime behavior. */
  writePolicy?: EnvTypegenWritePolicyConfig;
};

/** Config file names searched in order when calling loadConfig(). */
export const CONFIG_FILE_NAMES = ["env-typegen.config.mjs", "env-typegen.config.js"] as const;

/**
 * Type-safe config helper.
 * Returns the config object unchanged — exists purely for IDE autocompletion
 * and compile-time validation of the config shape.
 */
export function defineConfig(config: EnvTypegenConfig): EnvTypegenConfig {
  return config;
}

/**
 * Loads env-typegen config by searching for a config file in `cwd`.
 * Searches for env-typegen.config.mjs → .js in order.
 * Returns `undefined` when no config file is found.
 */
export async function loadConfig(
  cwd: string = process.cwd(),
): Promise<EnvTypegenConfig | undefined> {
  for (const name of CONFIG_FILE_NAMES) {
    const filePath = path.resolve(cwd, name);
    if (existsSync(filePath)) {
      const fileUrl = pathToFileURL(filePath).href;
      const mod = (await import(fileUrl)) as { default?: EnvTypegenConfig };
      return mod.default;
    }
  }
  return undefined;
}
