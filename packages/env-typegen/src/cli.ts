// CLI entry point — shebang (#!/usr/bin/env node) is injected by tsup banner config.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect, parseArgs } from "node:util";

import { runPlanCommand } from "./commands/plan-command.js";
import { runPullCommand } from "./commands/pull-command.js";
import { runSyncApplyCommand } from "./commands/sync-apply-command.js";
import { runSyncPreviewCommand } from "./commands/sync-preview-command.js";
import {
  CONFIG_FILE_NAMES,
  loadConfig,
  type EnvTypegenConfig,
  type GeneratorName,
} from "./config.js";
import { runGenerate, type RunGenerateOptions } from "./pipeline.js";
import { error, log, success } from "./utils/logger.js";
import { runValidationCommand } from "./validation-command.js";
import { startWatch } from "./watch.js";

// Re-export for consumers who import programmatic API via this file
export { runGenerate } from "./pipeline.js";
export type { RunGenerateOptions } from "./pipeline.js";

const _require = createRequire(import.meta.url);
const VERSION = (_require("../package.json") as { version: string }).version;

const HELP_TEXT = [
  "env-typegen — Stop using process.env wrong.",
  "",
  "Usage:",
  "  env-typegen                     Auto-detect .env.example, write src/env.ts",
  "  env-typegen generate [options]  Generate types from env files",
  "  env-typegen <subcommand> [options]",
  "",
  "Subcommands:",
  "  check         Validate one environment against the contract",
  "  diff          Compare multiple environments for drift",
  "  doctor        Combine check + diff diagnostics",
  "  verify        Strict CI verification (fails on warnings/errors)",
  "  pull          Pull environment values from providers",
  "  plan          Build a sync plan from source to destination",
  "  sync-preview  Preview a sync operation without writes",
  "  sync-apply    Apply a planned sync operation",
  "",
  "Options:",
  "  -i, --input <path>      Input env file (default: auto-detect .env.example)",
  "  -o, --output <path>     Output file (default: src/env.ts)",
  "  -f, --format <name>     Output format: ts|zod|t3|declaration (default: ts)",
  "  -g, --generator <name>  Alias for --format (backward compatible)",
  "      --no-format         Skip Prettier formatting",
  "  -m, --mode augment      Write env.d.ts augmentation instead (no migration needed)",
  "      --check             Exit 1 if src/env.ts is out of sync with source file",
  "  -w, --watch             Watch for changes and regenerate",
  "  -v, --version           Print version",
  "  -h, --help              Show this help",
].join("\n");

const VALIDATION_SUBCOMMANDS = new Set(["check", "diff", "doctor", "verify"]);

const FORMAT_TO_GENERATOR: Readonly<Record<string, GeneratorName>> = {
  ts: "typescript",
  typescript: "typescript",
  zod: "zod",
  t3: "t3",
  declaration: "declaration",
};

/** Ordered list of candidate input files checked when no --input flag is provided. */
const ENV_INPUT_FALLBACK_CHAIN = [".env.example", ".env.example.local", ".env"] as const;

/** Default output path for the zero-arg generate case. */
const DEFAULT_OUTPUT = "src/env.ts";

/** Default output path when --mode augment is used. */
const DEFAULT_AUGMENT_OUTPUT = "env.d.ts";

/**
 * Walks the fallback chain and returns the first candidate that exists in `cwd`.
 * Returns `undefined` when none are found.
 */
function findInputInFallbackChain(cwd: string): string | undefined {
  for (const candidate of ENV_INPUT_FALLBACK_CHAIN) {
    const resolved = path.resolve(cwd, candidate);
    if (existsSync(resolved)) return resolved;
  }
  return undefined;
}

/** Counts non-comment, non-blank lines that contain `=` (rough env variable count). */
function countEnvVars(content: string): number {
  return content.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#") && trimmed.includes("=");
  }).length;
}

/** Returns the key of the first non-comment variable in an env file, or `undefined`. */
function getFirstVarName(content: string): string | undefined {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith("#")) {
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex > 0) return trimmed.slice(0, eqIndex).trim();
    }
  }
  return undefined;
}

function normalizeGenerator(input: string): GeneratorName | undefined {
  return FORMAT_TO_GENERATOR[input] ?? FORMAT_TO_GENERATOR[input.toLowerCase()];
}

function resolveGenerators(
  rawFormats: readonly string[] | undefined,
  rawGenerators: readonly string[] | undefined,
  fallback: GeneratorName[] | undefined,
): GeneratorName[] {
  const requested = [...(rawFormats ?? []), ...(rawGenerators ?? [])].map(String);
  if (requested.length === 0) {
    return fallback ?? (["typescript"] as GeneratorName[]);
  }

  const normalizedGenerators = requested
    .map((item) => normalizeGenerator(item))
    .filter((item): item is GeneratorName => item !== undefined);

  const invalid = requested.filter((item) => normalizeGenerator(item) === undefined);
  if (invalid.length > 0) {
    error(`Unknown format(s): ${invalid.join(", ")}. Valid: ts, zod, t3, declaration`);
    process.exit(1);
  }

  return [...new Set(normalizedGenerators)];
}

function getErrorMessage(errorValue: unknown): string {
  if (errorValue instanceof Error) {
    return errorValue.message;
  }

  return inspect(errorValue, { depth: 2 });
}

/** Resolve a config-file path relative to the config file's directory when relative. */
function resolveConfigRelative(value: string | undefined, configDir: string): string | undefined {
  if (value === undefined || path.isAbsolute(value)) return value;
  return path.resolve(configDir, value);
}

/** Apply resolved (config-dir-relative) input/output paths onto a raw config object. */
function applyConfigPaths(config: EnvTypegenConfig, configDir: string): EnvTypegenConfig {
  let input: string | string[] | undefined;
  if (Array.isArray(config.input)) {
    input = config.input.map((v) => resolveConfigRelative(v, configDir) ?? v);
  } else {
    input = resolveConfigRelative(config.input, configDir);
  }
  const output = resolveConfigRelative(config.output, configDir);
  return {
    ...config,
    ...(input !== undefined && { input }),
    ...(output !== undefined && { output }),
  };
}

type ResolvedInput = {
  input: string | string[];
  isZeroArgMode: boolean;
  inputContent: string | undefined;
};

/**
 * Resolves the input file for the generate pipeline.
 * When no explicit input is provided, walks the ENV_INPUT_FALLBACK_CHAIN.
 * Exits with code 1 and prints actionable guidance when no file is found.
 */
function resolveInput(
  cliInput: string[] | undefined,
  configInput: string | string[] | undefined,
  cwd: string,
): ResolvedInput {
  const explicit = cliInput ?? configInput;
  if (explicit !== undefined) {
    return { input: explicit, isZeroArgMode: false, inputContent: undefined };
  }

  const detected = findInputInFallbackChain(cwd);
  if (detected === undefined) {
    error("No input file found.");
    log("");
    log(`  Tried: ${ENV_INPUT_FALLBACK_CHAIN.join(", ")}`);
    log("");
    log("  Create a .env.example with your required environment variables:");
    log("    DATABASE_URL=postgres://localhost/myapp");
    log("    NEXTAUTH_SECRET=changeme");
    log("");
    log("  Or specify a file: npx env-typegen --input .env.local");
    process.exit(1);
  }

  const inputContent = readFileSync(detected, "utf8");
  const count = countEnvVars(inputContent);
  const displayPath = path.relative(cwd, detected);
  success(`Found ${displayPath} (${count} variable${count === 1 ? "" : "s"})`);
  return { input: detected, isZeroArgMode: true, inputContent };
}

/**
 * Strip lines that are expected to differ between two otherwise identical
 * generated files — currently just the ISO timestamp comment emitted by the
 * TypeScript generator's header.
 */
function normalizeForComparison(content: string): string {
  return content
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("// Generated at:"))
    .join("\n")
    .trim();
}

/**
 * Simple sync-check: compares the currently on-disk output file to what would
 * be generated from the input right now. Exits 0 if in sync, 1 if not.
 *
 * This is distinct from the `check` subcommand (which requires an explicit
 * contract file). The `--check` flag is the zero-config CI gate: "is my
 * generated env.ts current?"
 */
async function runSyncCheck(options: RunGenerateOptions, outputPath: string): Promise<void> {
  // Read what's on disk  first; if it doesn't exist we can exit immediately
  let onDisk: string;
  try {
    onDisk = await readFile(outputPath, "utf8");
  } catch {
    error(`${path.relative(process.cwd(), outputPath)} does not exist yet.`);
    log("");
    log("  Fix: run npx env-typegen to generate it.");
    process.exit(1);
    return; // unreachable — process.exit is stubbed in tests
  }

  // Generate fresh content to a temp file alongside the real output, then
  // compare. Using a file avoids monkey-patching console.log (which is
  // fragile under Vitest spies).
  const tmpPath = `${outputPath}.check.tmp`;
  try {
    await runGenerate({ ...options, stdout: false, dryRun: false, silent: true, output: tmpPath });
  } catch {
    await unlink(tmpPath).catch(() => undefined);
    throw new Error("env-typegen: failed to re-generate for --check comparison");
  }
  const generated = await readFile(tmpPath, "utf8");
  await unlink(tmpPath).catch(() => undefined);

  if (normalizeForComparison(generated) === normalizeForComparison(onDisk)) {
    success(`${path.relative(process.cwd(), outputPath)} is up to date.`);
    return;
  }

  const inputDisplay = Array.isArray(options.input)
    ? (options.input[0] ?? "")
    : (options.input ?? "");
  error(
    `${path.relative(process.cwd(), outputPath)} is out of sync with ${path.relative(process.cwd(), inputDisplay)}.`,
  );
  log("");
  log("  Fix: run npx env-typegen to regenerate.");
  process.exit(1);
}

/** Drives the final generate/check/watch dispatch and the zero-arg hint. */
async function dispatchGenerate(
  params: {
    shouldWatch: boolean;
    isCheck: boolean;
    isDryRun: boolean;
    useStdout: boolean;
    isSilent: boolean;
    isAugmentMode: boolean;
    isZeroArgMode: boolean;
    input: string | string[];
    output: string;
    cwd: string;
    zeroArgInputContent: string | undefined;
  },
  options: RunGenerateOptions,
): Promise<void> {
  const {
    shouldWatch,
    isCheck,
    isDryRun,
    useStdout,
    isSilent,
    isAugmentMode,
    isZeroArgMode,
    input,
    output,
    cwd,
    zeroArgInputContent,
  } = params;

  if (shouldWatch) {
    startWatch({ inputPath: input, runOptions: options });
  } else if (isCheck) {
    await runSyncCheck(options, output);
  } else {
    await runGenerate(options);
    if (isZeroArgMode && !isDryRun && !useStdout && !isSilent && !isAugmentMode) {
      const content = zeroArgInputContent ?? readFileSync(input as string, "utf8");
      printGenerationHint(cwd, output, content);
    }
  }
}

/** Attempts to route `argv` to a subcommand handler. Returns true if handled. */
async function dispatchSubcommand(argv: string[]): Promise<boolean> {
  if (await maybeRunPullSubcommand(argv)) return true;
  if (await maybeRunPlanSubcommand(argv)) return true;
  if (await maybeRunSyncApplySubcommand(argv)) return true;
  if (await maybeRunSyncPreviewSubcommand(argv)) return true;
  if (await maybeRunValidationSubcommand(argv)) return true;
  return false;
}

/** Prints the before/after usage hint after a successful zero-arg generation. */
function printGenerationHint(cwd: string, output: string, inputContent: string): void {
  const firstVar = getFirstVarName(inputContent);
  const importPath = `./${path.relative(cwd, output).replace(/\.ts$/, "").replaceAll("\\", "/")}`;
  log("");
  if (firstVar !== undefined) {
    log(`  Before:  process.env.${firstVar}  // string | undefined`);
    log(`  After:   env.${firstVar}          // string  \u2713`);
    log("");
  }
  log(`  Import:  import { env } from '${importPath}'`);
}

type ValidationSubcommand = "check" | "diff" | "doctor" | "verify";

async function runValidationSubcommand(
  subcommand: ValidationSubcommand,
  argv: string[],
): Promise<void> {
  const exitCode = await runValidationCommand({ command: subcommand, argv });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

async function maybeRunPullSubcommand(argv: string[]): Promise<boolean> {
  const maybeSubcommand = argv[0];
  if (maybeSubcommand !== "pull") {
    return false;
  }

  const exitCode = await runPullCommand(argv.slice(1));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }

  return true;
}

async function maybeRunPlanSubcommand(argv: string[]): Promise<boolean> {
  const maybeSubcommand = argv[0];
  if (maybeSubcommand !== "plan") {
    return false;
  }

  const exitCode = await runPlanCommand(argv.slice(1));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }

  return true;
}

async function maybeRunSyncPreviewSubcommand(argv: string[]): Promise<boolean> {
  const maybeSubcommand = argv[0];
  if (maybeSubcommand !== "sync-preview") {
    return false;
  }

  const exitCode = await runSyncPreviewCommand(argv.slice(1));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }

  return true;
}

async function maybeRunSyncApplySubcommand(argv: string[]): Promise<boolean> {
  const maybeSubcommand = argv[0];
  if (maybeSubcommand !== "sync-apply") {
    return false;
  }

  const exitCode = await runSyncApplyCommand(argv.slice(1));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }

  return true;
}

/** Resolve the config file at an explicit user-supplied path, with an existence check. */
async function loadExplicitConfig(
  configPath: string,
  userPath: string,
): Promise<EnvTypegenConfig | undefined> {
  if (!existsSync(configPath)) {
    const displayPath = path.isAbsolute(userPath)
      ? userPath
      : `${userPath} (resolved: ${configPath})`;
    throw new Error(`Config file not found: ${displayPath}`);
  }
  const configDir = path.dirname(configPath);
  const mod = (await import(pathToFileURL(configPath).href)) as {
    default?: EnvTypegenConfig;
  };
  const rawConfig = mod.default;
  return rawConfig ? applyConfigPaths(rawConfig, configDir) : undefined;
}

function findAutoDiscoveredConfigPath(cwd: string): string | undefined {
  for (const configName of CONFIG_FILE_NAMES) {
    const resolvedPath = path.resolve(cwd, configName);
    if (existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }
  return undefined;
}

function parseGenerateAlias(argv: string[]): string[] {
  if (argv[0] === "generate") {
    return argv.slice(1);
  }
  return argv;
}

async function maybeRunValidationSubcommand(argv: string[]): Promise<boolean> {
  const maybeSubcommand = argv[0];
  if (maybeSubcommand === undefined || !VALIDATION_SUBCOMMANDS.has(maybeSubcommand)) {
    return false;
  }

  await runValidationSubcommand(maybeSubcommand as ValidationSubcommand, argv.slice(1));
  return true;
}

async function loadCliConfig(
  values: { config?: string },
  cwd: string,
): Promise<EnvTypegenConfig | undefined> {
  if (values.config !== undefined) {
    return loadExplicitConfig(path.resolve(values.config), values.config);
  }

  const fileConfig = await loadConfig(cwd);
  if (fileConfig !== undefined) {
    const autoConfigPath = findAutoDiscoveredConfigPath(cwd);
    if (autoConfigPath !== undefined) {
      log(`Using config: ${autoConfigPath}`);
    }
  }

  return fileConfig;
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  cwd = process.cwd(),
): Promise<void> {
  // "generate" is the implicit default subcommand — accept it explicitly as an alias
  // so `env-typegen generate -i ...` behaves the same as `env-typegen -i ...`.
  const normalizedArgv = parseGenerateAlias(argv);
  if (await dispatchSubcommand(normalizedArgv)) return;

  const { values } = parseArgs({
    args: normalizedArgv,
    options: {
      input: { type: "string", short: "i", multiple: true },
      output: { type: "string", short: "o" },
      generator: { type: "string", short: "g", multiple: true },
      format: { type: "string", short: "f", multiple: true },
      "no-format": { type: "boolean" },
      stdout: { type: "boolean" },
      "dry-run": { type: "boolean" },
      silent: { type: "boolean", short: "s" },
      watch: { type: "boolean", short: "w" },
      config: { type: "string", short: "c" },
      check: { type: "boolean" },
      mode: { type: "string", short: "m" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    } as const,
  });

  if (values.version === true) {
    console.log(VERSION);
    return;
  }

  if (values.help === true) {
    console.log(HELP_TEXT);
    return;
  }

  const fileConfig = await loadCliConfig(values, cwd);

  // Validate --mode flag
  if (values.mode !== undefined && values.mode !== "augment") {
    error(`Unknown --mode value: ${values.mode}. Valid: augment`);
    process.exit(1);
  }
  const isAugmentMode = values.mode === "augment";

  // Merge: CLI flags take precedence over config file values
  const cliInput = values.input?.length ? values.input : undefined;
  const {
    input,
    isZeroArgMode,
    inputContent: zeroArgInputContent,
  } = resolveInput(cliInput, fileConfig?.input, cwd);

  // Resolve output path (always absolute, anchored to cwd for testability)
  const defaultOutput = isAugmentMode ? DEFAULT_AUGMENT_OUTPUT : DEFAULT_OUTPUT;
  const rawOutput = values.output ?? fileConfig?.output ?? defaultOutput;
  const output = path.resolve(cwd, rawOutput);

  // Collect and validate generators from --format (spec) and --generator (compat)
  let generators = resolveGenerators(values.format, values.generator, fileConfig?.generators);
  if (isAugmentMode) {
    generators = ["declaration"];
  }

  const shouldFormat = values["no-format"] === true ? false : (fileConfig?.format ?? true);
  const useStdout = values.stdout ?? false;
  const isDryRun = values["dry-run"] ?? false;
  const isSilent = values.silent ?? false;
  const shouldWatch = values.watch ?? false;

  const options: RunGenerateOptions = {
    input,
    output,
    generators,
    format: shouldFormat,
    stdout: useStdout,
    dryRun: isDryRun,
    silent: isSilent,
    ...(fileConfig?.inferenceRules !== undefined && { inferenceRules: fileConfig.inferenceRules }),
  };

  await dispatchGenerate(
    {
      shouldWatch,
      isCheck: values.check === true,
      isDryRun,
      useStdout,
      isSilent,
      isAugmentMode,
      isZeroArgMode,
      input,
      output,
      cwd,
      zeroArgInputContent,
    },
    options,
  );
}

// Only auto-execute when this file is the CLI entry point, not when imported.
// realpathSync resolves both sides so the comparison works when invoked via an
// npm .bin/ symlink (where process.argv[1] is the symlink, not the real file).
if (
  process.argv[1] !== undefined &&
  (() => {
    try {
      return (
        realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
      );
    } catch {
      return false;
    }
  })()
) {
  await runCli().catch((err: unknown) => {
    error(getErrorMessage(err));
    process.exit(1);
  });
}
