// CLI entry point — shebang (#!/usr/bin/env node) is injected by tsup banner config.
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect, parseArgs } from "node:util";

import { runConfirmationTokenCommand } from "./commands/confirmation-token-command.js";
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
import { error, log } from "./utils/logger.js";
import { runValidationCommand } from "./validation-command.js";
import { startWatch } from "./watch.js";

// Re-export for consumers who import programmatic API via this file
export { runGenerate } from "./pipeline.js";
export type { RunGenerateOptions } from "./pipeline.js";

const _require = createRequire(import.meta.url);
const VERSION = (_require("../package.json") as { version: string }).version;

const HELP_TEXT = [
  "env-typegen — Generate TypeScript types from .env.example",
  "",
  "Usage:",
  "  env-typegen [generate] -i <path> [options]",
  "  env-typegen pull <provider> [options]",
  "  env-typegen plan [options]",
  "  env-typegen sync-apply <provider> [options]",
  "  env-typegen confirmation-token <provider> [options]",
  "  env-typegen sync-preview <provider> [options]",
  "  env-typegen verify [options]",
  "  env-typegen check [options]",
  "  env-typegen diff [options]",
  "  env-typegen doctor [options]",
  "",
  "Options:",
  "  -i, --input <path>         Path to .env.example file(s). May be specified multiple times.",
  "  -o, --output <path>        Output base path (default: env.generated.ts).",
  "                             With multiple generators, suffixes are appended:",
  "                             env.generated.typescript.ts, .zod.ts, .t3.ts, .declaration.d.ts",
  "  -f, --format <name>        Generator format: ts|zod|t3|declaration",
  "                             May be specified multiple times.",
  "  -g, --generator <name>     Backward-compatible alias for --format",
  "      --stdout               Print generated output to stdout",
  "      --dry-run              Parse and generate without writing files",
  "      --no-format            Disable prettier formatting",
  "      --strategy <mode>      sync-apply only: fail-fast | fail-late",
  "      --max-concurrency <n>  sync-apply only: bounded target parallelism",
  "  -s, --silent               Suppress success logs",
  "  -w, --watch                Watch for changes and regenerate",
  "  -c, --config <path>        Path to config file",
  "  -v, --version              Print version",
  "  -h, --help                 Show this help",
  "",
  "Config file:",
  "  Auto-discovered in order: env-typegen.config.mjs → .js (in cwd)",
  "  CLI flags always override config file values.",
  "  Use defineConfig() from @xlameiro/env-typegen for IDE autocompletion.",
  "  Note: with multiple --input values, --output basename is ignored;",
  "        outputs are named from each input file stem.",
  "",
  "Exit codes:",
  "  0  Success — files generated without errors",
  "  1  Error — invalid flags or generation failed",
].join("\n");

const VALIDATION_SUBCOMMANDS = new Set(["check", "diff", "doctor", "verify"]);

const FORMAT_TO_GENERATOR: Readonly<Record<string, GeneratorName>> = {
  ts: "typescript",
  typescript: "typescript",
  zod: "zod",
  t3: "t3",
  declaration: "declaration",
};

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
    return fallback ?? (["typescript", "zod", "t3", "declaration"] as GeneratorName[]);
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

async function maybeRunConfirmationTokenSubcommand(argv: string[]): Promise<boolean> {
  const maybeSubcommand = argv[0];
  if (maybeSubcommand !== "confirmation-token") {
    return false;
  }

  const exitCode = await runConfirmationTokenCommand(argv.slice(1));
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

async function loadCliConfig(values: { config?: string }): Promise<EnvTypegenConfig | undefined> {
  if (values.config !== undefined) {
    return loadExplicitConfig(path.resolve(values.config), values.config);
  }

  const cwd = process.cwd();
  const fileConfig = await loadConfig(cwd);
  if (fileConfig !== undefined) {
    const autoConfigPath = findAutoDiscoveredConfigPath(cwd);
    if (autoConfigPath !== undefined) {
      log(`Using config: ${autoConfigPath}`);
    }
  }

  return fileConfig;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  // "generate" is the implicit default subcommand — accept it explicitly as an alias
  // so `env-typegen generate -i ...` behaves the same as `env-typegen -i ...`.
  const normalizedArgv = parseGenerateAlias(argv);
  if (await maybeRunPullSubcommand(normalizedArgv)) {
    return;
  }
  if (await maybeRunPlanSubcommand(normalizedArgv)) {
    return;
  }
  if (await maybeRunSyncApplySubcommand(normalizedArgv)) {
    return;
  }
  if (await maybeRunConfirmationTokenSubcommand(normalizedArgv)) {
    return;
  }
  if (await maybeRunSyncPreviewSubcommand(normalizedArgv)) {
    return;
  }
  if (await maybeRunValidationSubcommand(normalizedArgv)) {
    return;
  }

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

  const fileConfig = await loadCliConfig(values);

  // Merge: CLI flags take precedence over config file values
  const cliInput = values.input?.length ? values.input : undefined;
  const input: string | string[] | undefined = cliInput ?? fileConfig?.input;
  if (input === undefined) {
    error("No input file specified. Use -i <path> or set input in env-typegen.config.mjs");
    process.exit(1);
  }

  const output = values.output ?? fileConfig?.output ?? "env.generated.ts";

  // Collect and validate generators from --format (spec) and --generator (compat)
  const generators = resolveGenerators(values.format, values.generator, fileConfig?.generators);

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

  if (shouldWatch) {
    startWatch({ inputPath: input, runOptions: options });
  } else {
    await runGenerate(options);
  }
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
