import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseEnvFile } from "../parser/env-parser.js";
import type { Environment, ReportStatus } from "../reporting/ci-contract.js";
import type { FormatCiReportOptions } from "../reporting/ci-reporter.js";
import { buildCiReport, formatCiReport } from "../reporting/ci-reporter.js";
import { loadContract } from "../schema/schema-loader.js";
import type { EnvContract } from "../schema/schema-model.js";
import { error, log, success, warn } from "../utils/logger.js";
import { validateContract } from "../validator/contract-validator.js";
import type { ValidateContractOptions, ValidationResult } from "../validator/types.js";

/**
 * Options for {@link runCheck}.
 *
 * @public
 */
export type RunCheckOptions = {
  /** Path to the env file to validate (e.g. `.env.local`). */
  input: string;
  /** Explicit path to the contract file. Relative to `cwd` when set. */
  contract?: string;
  /** Working directory for contract auto-discovery. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Environment label attached to validation issues. */
  environment?: Environment;
  /**
   * When `true` (default), undeclared variables are treated as errors.
   * When `false`, they become warnings.
   */
  strict?: boolean;
  /** Emit machine-readable JSON to stdout instead of human-readable lines. */
  json?: boolean;
  /** Pretty-print the JSON output when `json: true`. */
  pretty?: boolean;
  /** Suppress all output (status is still returned). */
  silent?: boolean;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolveContract(
  contractPath: string | undefined,
  cwd: string | undefined,
): Promise<EnvContract> {
  if (contractPath !== undefined) {
    const absPath = path.resolve(cwd ?? process.cwd(), contractPath);
    if (!existsSync(absPath)) {
      throw new Error(`Contract file not found: ${absPath}`);
    }
    // Dynamic import — works with ts-node/tsx compiled contract files
    const mod = (await import(pathToFileURL(absPath).href)) as {
      default?: EnvContract;
    };
    if (mod.default === undefined) {
      throw new Error(`Contract file has no default export: ${absPath}`);
    }
    return mod.default;
  }

  const contract = await loadContract(cwd);
  if (contract === undefined) {
    throw new Error("No contract file found");
  }
  return contract;
}

function outputJson(result: ValidationResult, input: string, pretty: boolean | undefined): void {
  const report = buildCiReport(result, {
    env: input,
    timestamp: new Date().toISOString(),
  });
  const formatOpts: FormatCiReportOptions = {};
  if (pretty) formatOpts.pretty = true;
  log(formatCiReport(report, formatOpts));
}

function outputHuman(result: ValidationResult): void {
  if (result.issues.length === 0) {
    success("No issues found");
    return;
  }
  for (const issue of result.issues) {
    const msg = `[${issue.code}] ${issue.key}`;
    if (issue.severity === "error") {
      error(msg);
    } else {
      warn(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Programmatic entry point for the `env-typegen check` command.
 *
 * Loads the contract, parses the env file, runs validation, and outputs results.
 * Returns `"ok"` when there are no errors, `"fail"` when there are.
 *
 * @throws {Error} When an explicit contract path does not exist.
 * @throws {Error} When an explicit contract module has no default export.
 * @throws {Error} When no contract file can be auto-discovered.
 * @throws {Error} When importing the explicit contract module fails.
 *
 * @public
 */
export async function runCheck(opts: RunCheckOptions): Promise<ReportStatus> {
  const contract = await resolveContract(opts.contract, opts.cwd);
  const parsed = parseEnvFile(opts.input);

  // Surface duplicate-key warnings detected during parsing.
  if (parsed.warnings !== undefined) {
    for (const w of parsed.warnings) {
      warn(`[${w.code}] ${w.message}`);
    }
  }

  const validatorOpts: ValidateContractOptions = {};
  if (opts.environment !== undefined) validatorOpts.environment = opts.environment;
  if (opts.strict !== undefined) validatorOpts.strict = opts.strict;

  const result = validateContract(parsed, contract, validatorOpts);

  const hasErrors = result.issues.some((issue) => issue.severity === "error");
  const status: ReportStatus = hasErrors ? "fail" : "ok";

  if (!opts.silent) {
    if (opts.json) {
      outputJson(result, opts.input, opts.pretty);
    } else {
      outputHuman(result);
    }
  }

  return status;
}
