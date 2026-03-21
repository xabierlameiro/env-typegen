import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { loadCloudSource, type CloudProvider } from "./cloud/connectors.js";
import { finalizeVerifyReport } from "./commands/verify-command.js";
import { loadConfig, type EnvTypegenConfig } from "./config.js";
import { loadValidationContract } from "./contract.js";
import {
  applyContractPlugins,
  applyReportPlugins,
  applySourcePlugins,
  loadPlugins,
  type PluginReference,
} from "./plugins.js";
import { evaluatePolicy } from "./policy/policy-evaluator.js";
import { resolvePolicyWithPacks } from "./policy/policy-pack-registry.js";
import { attachPolicyEvaluation } from "./reporting/policy-report.js";
import { warn } from "./utils/logger.js";
import {
  buildDoctorReport,
  diffEnvironmentSources,
  validateAgainstContract,
} from "./validation/engine.js";
import { loadEnvSource } from "./validation/env-source.js";
import { emitValidationReport } from "./validation/output.js";
import type { ValidationIssue, ValidationReport } from "./validation/types.js";

type ValidationCommand = "check" | "diff" | "doctor" | "verify";
type JsonMode = "off" | "compact" | "pretty";

type ValidationArgValues = {
  env?: string[];
  targets?: string;
  contract?: string;
  example?: string;
  strict?: boolean;
  "no-strict"?: boolean;
  json?: boolean;
  "output-file"?: string;
  "debug-values"?: boolean;
  "cloud-provider"?: string;
  "cloud-file"?: string;
  plugin?: string[];
  config?: string;
  help?: boolean;
};

type ParsedValidationArgs = {
  values: ValidationArgValues;
  jsonMode: JsonMode;
};

type LoadCommandConfigModule = {
  default?: EnvTypegenConfig;
};

const HELP_TEXT: Record<ValidationCommand, string> = {
  check: [
    "Usage: env-typegen check [options]",
    "",
    "Options:",
    "  --env <path>              Environment file to validate (default: .env)",
    "  --contract <path>         Contract file path (default: env.contract.ts)",
    "  --example <path>          Fallback .env.example used to bootstrap contract",
    "  --strict                  Validate extras as errors (default: true)",
    "  --no-strict               Downgrade extras to warnings",
    "  --json                    Emit machine-readable JSON report",
    "  --json=pretty             Emit pretty JSON report",
    "  --output-file <path>      Persist JSON report to a file",
    "  --debug-values            Include raw values in issues (unsafe for CI logs)",
    "  --cloud-provider <name>   vercel | cloudflare | aws",
    "  --cloud-file <path>       Cloud snapshot JSON file",
    "  --plugin <path>           Plugin module path (repeatable)",
    "  -c, --config <path>       Config file path",
    "  -h, --help                Show this help",
    "",
    "Exit codes:",
    "  0  All checks passed (status: ok)",
    "  1  One or more checks failed (status: fail) or invalid usage",
  ].join("\n"),
  diff: [
    "Usage: env-typegen diff [options]",
    "",
    "Options:",
    "  --targets <list>          Comma-separated targets (default: .env,.env.production)",
    "  --contract <path>         Contract file path (default: env.contract.ts)",
    "  --example <path>          Fallback .env.example used to bootstrap contract",
    "  --strict                  Validate extras as errors (default: true)",
    "  --no-strict               Downgrade extras to warnings",
    "  --json                    Emit machine-readable JSON report",
    "  --json=pretty             Emit pretty JSON report",
    "  --output-file <path>      Persist JSON report to a file",
    "  --debug-values            Include raw values in issues (unsafe for CI logs)",
    "  --cloud-provider <name>   vercel | cloudflare | aws",
    "  --cloud-file <path>       Cloud snapshot JSON file added to diff sources",
    "  --plugin <path>           Plugin module path (repeatable)",
    "  -c, --config <path>       Config file path",
    "  -h, --help                Show this help",
    "",
    "Exit codes:",
    "  0  All checks passed (status: ok)",
    "  1  One or more checks failed (status: fail) or invalid usage",
  ].join("\n"),
  doctor: [
    "Usage: env-typegen doctor [options]",
    "",
    "Options:",
    "  --env <path>              Environment file to validate (default: .env)",
    "  --targets <list>          Comma-separated targets for drift analysis (default: .env,.env.production)",
    "  --contract <path>         Contract file path (default: env.contract.ts)",
    "  --example <path>          Fallback .env.example used to bootstrap contract",
    "  --strict                  Validate extras as errors (default: true)",
    "  --no-strict               Downgrade extras to warnings",
    "  --json                    Emit machine-readable JSON report",
    "  --json=pretty             Emit pretty JSON report",
    "  --output-file <path>      Persist JSON report to a file",
    "  --debug-values            Include raw values in issues (unsafe for CI logs)",
    "  --cloud-provider <name>   vercel | cloudflare | aws",
    "  --cloud-file <path>       Cloud snapshot JSON file",
    "  --plugin <path>           Plugin module path (repeatable)",
    "  -c, --config <path>       Config file path",
    "  -h, --help                Show this help",
    "",
    "Exit codes:",
    "  0  All checks passed (status: ok)",
    "  1  One or more checks failed (status: fail) or invalid usage",
  ].join("\n"),
  verify: [
    "Usage: env-typegen verify [options]",
    "",
    "Options:",
    "  --env <path>              Environment file to validate (default: .env)",
    "  --targets <list>          Comma-separated targets for drift analysis (default: .env,.env.production)",
    "  --contract <path>         Contract file path (default: env.contract.ts)",
    "  --example <path>          Fallback .env.example used to bootstrap contract",
    "  --strict                  Validate extras as errors (default: true)",
    "  --no-strict               Downgrade extras to warnings",
    "  --json                    Emit machine-readable JSON report",
    "  --json=pretty             Emit pretty JSON report",
    "  --output-file <path>      Persist JSON report to a file",
    "  --debug-values            Include raw values in issues (unsafe for CI logs)",
    "  --cloud-provider <name>   vercel | cloudflare | aws",
    "  --cloud-file <path>       Cloud snapshot JSON file",
    "  --plugin <path>           Plugin module path (repeatable)",
    "  -c, --config <path>       Config file path",
    "  -h, --help                Show this help",
    "",
    "Exit codes:",
    "  0  All checks passed without warnings (status: ok)",
    "  1  Any warning or error found (status: fail) or invalid usage",
  ].join("\n"),
};

function resolveConfigRelative(value: string | undefined, configDir: string): string | undefined {
  if (value === undefined || path.isAbsolute(value)) return value;
  return path.resolve(configDir, value);
}

function resolvePluginReference(reference: PluginReference, configDir: string): PluginReference {
  if (typeof reference === "string" && !path.isAbsolute(reference)) {
    return path.resolve(configDir, reference);
  }
  return reference;
}

function applyConfigPaths(config: EnvTypegenConfig, configDir: string): EnvTypegenConfig {
  let input: string | string[] | undefined;
  if (Array.isArray(config.input)) {
    input = config.input.map((item) => resolveConfigRelative(item, configDir) ?? item);
  } else {
    input = resolveConfigRelative(config.input, configDir);
  }
  const output = resolveConfigRelative(config.output, configDir);
  const schemaFile = resolveConfigRelative(config.schemaFile, configDir);

  return {
    ...config,
    ...(input !== undefined && { input }),
    ...(output !== undefined && { output }),
    ...(schemaFile !== undefined && { schemaFile }),
    ...(config.diffTargets !== undefined && {
      diffTargets: config.diffTargets.map(
        (target) => resolveConfigRelative(target, configDir) ?? target,
      ),
    }),
    ...(config.plugins !== undefined && {
      plugins: config.plugins.map((reference) => resolvePluginReference(reference, configDir)),
    }),
  };
}

async function loadCommandConfig(
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
  const configDir = path.dirname(resolvedPath);
  const moduleValue = (await import(pathToFileURL(resolvedPath).href)) as LoadCommandConfigModule;
  if (moduleValue.default === undefined) return undefined;
  return applyConfigPaths(moduleValue.default, configDir);
}

function preprocessJsonArguments(argv: string[]): {
  normalizedArgs: string[];
  assignedMode: JsonMode;
} {
  const normalizedArgs: string[] = [];
  let assignedMode: JsonMode = "off";

  for (const item of argv) {
    if (item === "--json=pretty") {
      normalizedArgs.push("--json");
      assignedMode = "pretty";
      continue;
    }
    if (item === "--json=compact") {
      normalizedArgs.push("--json");
      assignedMode = "compact";
      continue;
    }
    normalizedArgs.push(item);
  }

  return { normalizedArgs, assignedMode };
}

function parseValidationArgs(argv: string[]): ParsedValidationArgs {
  const { normalizedArgs, assignedMode } = preprocessJsonArguments(argv);
  const { values } = parseArgs({
    args: normalizedArgs,
    options: {
      env: { type: "string", multiple: true },
      targets: { type: "string" },
      contract: { type: "string" },
      example: { type: "string" },
      strict: { type: "boolean" },
      "no-strict": { type: "boolean" },
      json: { type: "boolean" },
      "output-file": { type: "string" },
      "debug-values": { type: "boolean" },
      "cloud-provider": { type: "string" },
      "cloud-file": { type: "string" },
      plugin: { type: "string", multiple: true },
      config: { type: "string", short: "c" },
      help: { type: "boolean", short: "h" },
    } as const,
  });

  const castValues = values as ValidationArgValues;
  let jsonMode: JsonMode = "off";
  if (castValues.json === true) {
    jsonMode = assignedMode === "off" ? "compact" : assignedMode;
  }

  return { values: castValues, jsonMode };
}

function resolveStrict(
  values: ValidationArgValues,
  fileConfig: EnvTypegenConfig | undefined,
): boolean {
  if (values["no-strict"] === true) return false;
  if (values.strict !== undefined) return values.strict;
  if (fileConfig?.strict !== undefined) return fileConfig.strict;
  return true;
}

function parseCloudProvider(value: string | undefined): CloudProvider | undefined {
  if (value === undefined) return undefined;
  if (value === "vercel" || value === "cloudflare" || value === "aws") return value;
  throw new Error(`Unknown cloud provider: ${value}. Valid: vercel, cloudflare, aws`);
}

function parseTargets(
  values: ValidationArgValues,
  fileConfig: EnvTypegenConfig | undefined,
): string[] {
  const fromCli = values.targets;
  if (fromCli !== undefined) {
    return fromCli
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (fileConfig?.diffTargets !== undefined && fileConfig.diffTargets.length > 0) {
    return fileConfig.diffTargets;
  }

  return [".env", ".env.production"];
}

function splitExistingAndMissingTargets(targets: string[]): {
  existingTargets: string[];
  missingTargets: string[];
} {
  const existingTargets: string[] = [];
  const missingTargets: string[] = [];

  for (const target of targets) {
    const resolvedTarget = path.resolve(target);
    if (existsSync(resolvedTarget)) {
      existingTargets.push(target);
      continue;
    }
    missingTargets.push(target);
  }

  return { existingTargets, missingTargets };
}

function buildMissingTargetIssue(target: string, missingCount: number): ValidationIssue {
  const suffix = missingCount === 1 ? "" : "s";
  return {
    code: "ENV_MISSING",
    type: "missing",
    severity: "error",
    key: "*",
    environment: target,
    message: `Target file ${target} was not found; treating as empty (${missingCount} missing variable${suffix}).`,
    value: null,
  };
}

function summarizeDoctorMissingTargetIssues(
  report: ValidationReport,
  missingTargets: string[],
): ValidationReport {
  if (missingTargets.length === 0) return report;

  const missingTargetSet = new Set(missingTargets);
  const retainedIssues = report.issues.filter(
    (issue) => !(issue.code === "ENV_MISSING" && missingTargetSet.has(issue.environment)),
  );

  const groupedIssues = missingTargets.map((target) => {
    const missingCount = report.issues.filter(
      (issue) => issue.code === "ENV_MISSING" && issue.environment === target,
    ).length;
    return buildMissingTargetIssue(target, missingCount);
  });

  const issues = [...retainedIssues, ...groupedIssues];
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;

  return {
    ...report,
    status: errors > 0 ? "fail" : "ok",
    issues,
    summary: {
      errors,
      warnings,
      total: issues.length,
    },
  };
}

async function prepareCommonContext(values: ValidationArgValues): Promise<{
  fileConfig: EnvTypegenConfig | undefined;
  strict: boolean;
  debugValues: boolean;
  outputFile: string | undefined;
  contractPath: string | undefined;
  fallbackExamplePath: string;
  cloudProvider: CloudProvider | undefined;
  cloudFile: string | undefined;
  plugins: Awaited<ReturnType<typeof loadPlugins>>;
}> {
  const fileConfig = await loadCommandConfig(values.config);
  const strict = resolveStrict(values, fileConfig);
  const debugValues = values["debug-values"] ?? false;
  const contractPath = values.contract ?? fileConfig?.schemaFile;
  const fallbackExamplePath = values.example ?? ".env.example";
  const cloudProvider = parseCloudProvider(values["cloud-provider"]);
  const cloudFile = values["cloud-file"];
  const pluginLoadOptions = {
    pluginPaths: values.plugin ?? [],
    cwd: process.cwd(),
    ...(fileConfig?.plugins !== undefined && { configPlugins: fileConfig.plugins }),
  };
  const plugins = await loadPlugins(pluginLoadOptions);

  return {
    fileConfig,
    strict,
    debugValues,
    outputFile: values["output-file"],
    contractPath,
    fallbackExamplePath,
    cloudProvider,
    cloudFile,
    plugins,
  };
}

async function emitAndReturnExitCode(
  report: ValidationReport,
  params: {
    jsonMode: JsonMode;
    outputFile?: string;
  },
): Promise<number> {
  const emitOptions = {
    report,
    jsonMode: params.jsonMode,
    ...(params.outputFile !== undefined && { outputFile: params.outputFile }),
  };
  await emitValidationReport(emitOptions);
  return report.status === "fail" ? 1 : 0;
}

async function runCheckCommand(args: ParsedValidationArgs): Promise<number> {
  const context = await prepareCommonContext(args.values);
  const loadContractOptions = {
    fallbackExamplePath: context.fallbackExamplePath,
    cwd: process.cwd(),
    ...(context.contractPath !== undefined && { contractPath: context.contractPath }),
  };
  const contract = applyContractPlugins(
    await loadValidationContract(loadContractOptions),
    context.plugins,
  );

  const provider = context.cloudProvider;
  let environment = args.values.env?.[0] ?? ".env";
  let sourceValues: Record<string, string>;

  if (provider === undefined) {
    sourceValues = await loadEnvSource({ filePath: environment, allowMissing: true });
  } else {
    const cloudFile = context.cloudFile ?? `${provider}.env.json`;
    sourceValues = await loadCloudSource({ provider, filePath: cloudFile });
    environment = `cloud:${provider}`;
  }

  sourceValues = applySourcePlugins({ environment, values: sourceValues }, context.plugins);

  const report = applyReportPlugins(
    validateAgainstContract({
      contract,
      values: sourceValues,
      environment,
      strict: context.strict,
      debugValues: context.debugValues,
    }),
    context.plugins,
  );

  return emitAndReturnExitCode(report, {
    jsonMode: args.jsonMode,
    ...(context.outputFile !== undefined && { outputFile: context.outputFile }),
  });
}

async function runDiffCommand(args: ParsedValidationArgs): Promise<number> {
  const context = await prepareCommonContext(args.values);
  const loadContractOptions = {
    fallbackExamplePath: context.fallbackExamplePath,
    cwd: process.cwd(),
    ...(context.contractPath !== undefined && { contractPath: context.contractPath }),
  };
  const contract = applyContractPlugins(
    await loadValidationContract(loadContractOptions),
    context.plugins,
  );

  const targets = parseTargets(args.values, context.fileConfig);
  const { existingTargets, missingTargets } = splitExistingAndMissingTargets(targets);
  for (const missingTarget of missingTargets) {
    warn(`Target file not found: ${missingTarget} — treating as empty`);
  }

  const sources: Record<string, Record<string, string>> = {};
  for (const target of existingTargets) {
    const values = await loadEnvSource({ filePath: target, allowMissing: true });
    sources[target] = applySourcePlugins({ environment: target, values }, context.plugins);
  }

  if (context.cloudProvider !== undefined) {
    const cloudFile = context.cloudFile ?? `${context.cloudProvider}.env.json`;
    const cloudEnvironment = `cloud:${context.cloudProvider}`;
    const cloudValues = await loadCloudSource({
      provider: context.cloudProvider,
      filePath: cloudFile,
    });
    sources[cloudEnvironment] = applySourcePlugins(
      { environment: cloudEnvironment, values: cloudValues },
      context.plugins,
    );
  }

  const report = applyReportPlugins(
    diffEnvironmentSources({
      contract,
      sources,
      strict: context.strict,
      debugValues: context.debugValues,
    }),
    context.plugins,
  );

  return emitAndReturnExitCode(report, {
    jsonMode: args.jsonMode,
    ...(context.outputFile !== undefined && { outputFile: context.outputFile }),
  });
}

async function runDoctorLikeCommand(
  args: ParsedValidationArgs,
  mode: "doctor" | "verify",
): Promise<number> {
  const report = await buildDoctorLikeReport(args, mode);

  const outputFile = args.values["output-file"];
  return emitAndReturnExitCode(report, {
    jsonMode: args.jsonMode,
    ...(outputFile !== undefined && { outputFile }),
  });
}

async function buildDoctorLikeReport(
  args: ParsedValidationArgs,
  mode: "doctor" | "verify",
): Promise<ValidationReport> {
  const context = await prepareCommonContext(args.values);
  const loadContractOptions = {
    fallbackExamplePath: context.fallbackExamplePath,
    cwd: process.cwd(),
    ...(context.contractPath !== undefined && { contractPath: context.contractPath }),
  };
  const contract = applyContractPlugins(
    await loadValidationContract(loadContractOptions),
    context.plugins,
  );

  const checkEnvironment = args.values.env?.[0] ?? ".env";
  const isCheckEnvironmentMissing = !existsSync(path.resolve(checkEnvironment));
  let checkValues = await loadEnvSource({ filePath: checkEnvironment, allowMissing: true });
  checkValues = applySourcePlugins(
    { environment: checkEnvironment, values: checkValues },
    context.plugins,
  );

  const checkReport = validateAgainstContract({
    contract,
    values: checkValues,
    environment: checkEnvironment,
    strict: context.strict,
    debugValues: context.debugValues,
  });

  const targets = parseTargets(args.values, context.fileConfig);
  const { existingTargets, missingTargets } = splitExistingAndMissingTargets(targets);
  for (const missingTarget of missingTargets) {
    if (missingTarget === checkEnvironment && isCheckEnvironmentMissing) {
      // loadEnvSource already emitted a warning for the missing check environment.
      continue;
    }
    warn(`Target file not found: ${missingTarget} — treating as empty`);
  }

  const sources: Record<string, Record<string, string>> = {};
  for (const target of existingTargets) {
    const values = await loadEnvSource({ filePath: target, allowMissing: true });
    sources[target] = applySourcePlugins({ environment: target, values }, context.plugins);
  }

  if (context.cloudProvider !== undefined) {
    const cloudFile = context.cloudFile ?? `${context.cloudProvider}.env.json`;
    const cloudEnvironment = `cloud:${context.cloudProvider}`;
    const cloudValues = await loadCloudSource({
      provider: context.cloudProvider,
      filePath: cloudFile,
    });
    sources[cloudEnvironment] = applySourcePlugins(
      { environment: cloudEnvironment, values: cloudValues },
      context.plugins,
    );
  }

  const diffReport = diffEnvironmentSources({
    contract,
    sources,
    strict: context.strict,
    debugValues: context.debugValues,
  });

  const rawReport = buildDoctorReport({ checkReport, diffReport });
  const summarizedReport = summarizeDoctorMissingTargetIssues(rawReport, missingTargets);
  const pluginProcessedReport = applyReportPlugins(summarizedReport, context.plugins);
  let report =
    mode === "verify"
      ? finalizeVerifyReport(pluginProcessedReport, { redactValuesByDefault: true })
      : pluginProcessedReport;

  if (mode === "verify") {
    const resolvedPolicy = await resolvePolicyWithPacks({
      policy: context.fileConfig?.policy,
      cwd: process.cwd(),
    });
    const policy = evaluatePolicy(report, resolvedPolicy);
    report = attachPolicyEvaluation(report, policy);
  }

  return report;
}

export async function buildVerifyReport(argv: string[]): Promise<ValidationReport> {
  const parsed = parseValidationArgs(argv);
  if (parsed.values.help === true) {
    throw new Error("--help is not supported for buildVerifyReport");
  }

  return buildDoctorLikeReport(parsed, "verify");
}

export async function runValidationCommand(params: {
  command: ValidationCommand;
  argv: string[];
}): Promise<number> {
  const parsed = parseValidationArgs(params.argv);
  if (parsed.values.help === true) {
    console.log(HELP_TEXT[params.command]);
    return 0;
  }

  if (params.command === "check") {
    return runCheckCommand(parsed);
  }
  if (params.command === "diff") {
    return runDiffCommand(parsed);
  }
  if (params.command === "doctor") {
    return runDoctorLikeCommand(parsed, "doctor");
  }
  return runDoctorLikeCommand(parsed, "verify");
}
