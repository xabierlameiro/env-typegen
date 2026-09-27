import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunGenerateOptions } from "../src/cli.js";
import { runCli, runGenerate } from "../src/cli.js";

const _require = createRequire(import.meta.url);
const EXPECTED_VERSION = String((_require("../package.json") as { version: string }).version);

// ---------------------------------------------------------------------------
// runGenerate — pipeline unit tests (all using real temp dirs)
// ---------------------------------------------------------------------------

describe("runGenerate", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-gen-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function makeInput(content: string): Promise<string> {
    const p = path.join(dir, ".env.example");
    await writeFile(p, content);
    return p;
  }

  function opts(overrides: Partial<RunGenerateOptions> & { input: string }): RunGenerateOptions {
    return {
      output: path.join(dir, "env.generated.ts"),
      generators: ["typescript"],
      format: false,
      ...overrides,
    };
  }

  it("should write TypeScript types to the output file", async () => {
    const input = await makeInput("DATABASE_URL=postgres://localhost/db\n");
    const output = path.join(dir, "env.generated.ts");

    await runGenerate(opts({ input, output, generators: ["typescript"] }));

    const content = await readFile(output, "utf8");
    expect(content).toContain("DATABASE_URL");
    expect(content).toContain("string");
  });

  it("should write Zod schema to the output file", async () => {
    const input = await makeInput("PORT=3000\n");
    const output = path.join(dir, "env.generated.ts");

    await runGenerate(opts({ input, output, generators: ["zod"] }));

    const content = await readFile(output, "utf8");
    expect(content).toContain("PORT");
    expect(content).toContain("z.coerce.number");
  });

  it("should write t3 env config to the output file", async () => {
    const input = await makeInput("SECRET_KEY=abcdefgh\n");
    const output = path.join(dir, "env.generated.ts");

    await runGenerate(opts({ input, output, generators: ["t3"] }));

    const content = await readFile(output, "utf8");
    expect(content).toContain("createEnv");
    expect(content).toContain("SECRET_KEY");
  });

  it("should write a declaration file to the output path", async () => {
    const input = await makeInput("API_URL=https://api.example.com\n");
    // BUG-03: when a .ts base path is passed with the declaration generator in single-format
    // mode, the extension is coerced to .d.ts so TypeScript treats it as an ambient declaration.
    const outputBase = path.join(dir, "env.generated.ts");
    const expectedOutput = path.join(dir, "env.generated.d.ts");

    await runGenerate(opts({ input, output: outputBase, generators: ["declaration"] }));

    const content = await readFile(expectedOutput, "utf8");
    expect(content).toContain("API_URL");
    expect(content).toContain("ProcessEnv");
  });

  it("should format output with prettier when format is true", async () => {
    const input = await makeInput("PORT=3000\n");
    const output = path.join(dir, "env.generated.ts");

    await runGenerate(opts({ input, output, generators: ["typescript"], format: true }));

    const content = await readFile(output, "utf8");
    expect(content.endsWith("\n")).toBe(true);
  });

  it("should create intermediate output directories that do not exist", async () => {
    const input = await makeInput("KEY=value\n");
    const output = path.join(dir, "nested", "deep", "env.generated.ts");

    await runGenerate(opts({ input, output, generators: ["typescript"] }));

    const content = await readFile(output, "utf8");
    expect(content).toContain("KEY");
  });

  it("should write separate files when multiple generators are specified", async () => {
    const input = await makeInput("APP_SECRET=mysecret\n");
    const output = path.join(dir, "env.generated.ts");

    await runGenerate(opts({ input, output, generators: ["typescript", "zod"] }));

    // Multi-generator: files are named <base>.<generator><ext>
    const tsContent = await readFile(path.join(dir, "env.generated.typescript.ts"), "utf8");
    const zodContent = await readFile(path.join(dir, "env.generated.zod.ts"), "utf8");

    expect(tsContent).toContain("APP_SECRET");
    expect(zodContent).toContain("APP_SECRET");
    expect(zodContent).toContain("z.string");
  });

  it("should reject when the input file does not exist", async () => {
    await expect(
      runGenerate(opts({ input: path.join(dir, "nonexistent.env"), generators: ["typescript"] })),
    ).rejects.toThrow();
  });

  it("should not write an output file and not log generated content when dryRun is true", async () => {
    const input = await makeInput("API_KEY=secret\n");
    const output = path.join(dir, "env.dry.ts");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runGenerate(opts({ input, output, generators: ["typescript"], dryRun: true }));

    // Output file must NOT be created in dry-run mode.
    await expect(import("node:fs/promises").then((m) => m.access(output))).rejects.toThrow();
    // Generated TypeScript content must NOT appear in stdout.
    const logged = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("API_KEY");
    expect(logged).not.toContain("export");
  });

  it("should not write output files in dry-run with multiple generators", async () => {
    const input = await makeInput("PORT=8080\n");
    const output = path.join(dir, "env.multi.ts");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runGenerate(opts({ input, output, generators: ["typescript", "zod"], dryRun: true }));

    // Neither multi-generator output file should exist.
    await expect(
      import("node:fs/promises").then((m) => m.access(path.join(dir, "env.multi.typescript.ts"))),
    ).rejects.toThrow();
    await expect(
      import("node:fs/promises").then((m) => m.access(path.join(dir, "env.multi.zod.ts"))),
    ).rejects.toThrow();
    // Content from either generator must NOT appear in stdout.
    const logged = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("PORT");
  });
});

// ---------------------------------------------------------------------------
// runCli — argument parsing and top-level behaviour
// ---------------------------------------------------------------------------

describe("runCli", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-cli-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should print the package version when --version is passed", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["--version"]);

    expect(spy).toHaveBeenCalledWith(EXPECTED_VERSION);
  });

  it("should print the package version when -v is passed", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["-v"]);

    expect(spy).toHaveBeenCalledWith(EXPECTED_VERSION);
  });

  it("should print help text when --help is passed", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["--help"]);

    const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("env-typegen");
    expect(output).toContain("--input");
    expect(output).toContain("--format");
    expect(output).toContain("--generator");
    expect(output).toContain("--no-format");
    expect(output).toContain("--watch");
    expect(output).toContain("--mode");
    expect(output).toContain("Subcommands:");
    expect(output).toContain("check");
    expect(output).toContain("diff");
    expect(output).toContain("doctor");
    expect(output).toContain("verify");
    expect(output).toContain("pull");
    expect(output).toContain("plan");
    expect(output).toContain("sync-preview");
    expect(output).toContain("sync-apply");
  });

  it("should print help text when -h is passed", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["-h"]);

    const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("env-typegen");
    expect(output).toContain("--input");
  });

  it("should call process.exit(1) when no env file is found in the fallback chain", async () => {
    // dir is a fresh empty temp dir — no .env.example, .env.example.local, or .env
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error(`process.exit(${String(_code)})`);
    });

    await expect(runCli([], dir)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should run the generate pipeline when --input and --output are provided", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "MY_VAR=hello\n");
    const outputPath = path.join(dir, "out.ts");

    await runCli(["--input", inputPath, "--output", outputPath, "--generator", "typescript"]);

    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("MY_VAR");
  });

  it("should use the --generator flag to select the generator", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "API_KEY=abc\n");
    const outputPath = path.join(dir, "out.ts");

    await runCli(["--input", inputPath, "--output", outputPath, "--generator", "zod"]);

    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("z.string");
  });

  it("should use the --format flag to select the generator", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "API_KEY=abc\n");
    const outputPath = path.join(dir, "out.ts");

    await runCli(["--input", inputPath, "--output", outputPath, "--format", "zod"]);

    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("z.string");
  });

  it("should use -g shorthand for the generator flag", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "TOKEN=xyz\n");
    const outputPath = path.join(dir, "out.ts");

    await runCli(["-i", inputPath, "-o", outputPath, "-g", "zod"]);

    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("TOKEN");
    expect(content).toContain("z.string");
  });

  it("should default to the typescript generator when no --format is specified", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "DB_HOST=localhost\n");
    const outputPath = path.join(dir, "out.ts");

    await runCli(["--input", inputPath, "--output", outputPath]);

    // Single generator (typescript): output uses the provided path directly, no suffix
    const tsContent = await readFile(outputPath, "utf8");
    expect(tsContent).toContain("DB_HOST");
    expect(tsContent).toContain("ProcessEnv");
  });

  it("should support --stdout without writing files", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "PUBLIC_URL=https://example.com\n");
    const outputPath = path.join(dir, "out.ts");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["--input", inputPath, "--output", outputPath, "--stdout"]);

    await expect(readFile(outputPath, "utf8")).rejects.toThrow();
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("PUBLIC_URL");
  });

  it("should support --dry-run without writing files", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "PUBLIC_URL=https://example.com\n");
    const outputPath = path.join(dir, "out.ts");

    await runCli(["--input", inputPath, "--output", outputPath, "--dry-run"]);

    await expect(readFile(outputPath, "utf8")).rejects.toThrow();
  });

  it("should print only 'would write' and not generated content in --dry-run mode", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "PUBLIC_URL=https://example.com\n");
    const outputPath = path.join(dir, "out.ts");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli([
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--generator",
      "typescript",
      "--dry-run",
    ]);

    // The output file must NOT be written in dry-run mode.
    await expect(readFile(outputPath, "utf8")).rejects.toThrow();
    // Generated TypeScript content must NOT appear in stdout — only the "would write" message.
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).not.toContain("PUBLIC_URL");
    expect(printed).not.toContain("export");
  });

  it("should disable formatting with --no-format", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "APP_NAME=my-app\n");
    const outputPath = path.join(dir, "out.ts");

    await runCli([
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--generator",
      "typescript",
      "--no-format",
    ]);

    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("APP_NAME");
  });

  it("should suppress success logs with --silent", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "APP_NAME=my-app\n");
    const outputPath = path.join(dir, "out.ts");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["--input", inputPath, "--output", outputPath, "--silent"]);

    const logs = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logs).not.toContain("Generated");
  });

  it("should document available output formats in --help", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["--help"]);

    const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("ts|zod|t3|declaration");
  });

  it("should document zero-arg usage in --help", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["--help"]);

    const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Auto-detect");
  });

  it("should document the viral tagline in --help", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["--help"]);

    const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Stop using process.env wrong");
  });

  it("should document exit codes in check --help", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["check", "--help"]);

    const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Exit codes:");
    expect(output).toContain("status: ok");
  });

  it("should document strict CI semantics in verify --help", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["verify", "--help"]);

    const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Usage: env-typegen verify");
    expect(output).toContain("Any warning or error found");
  });

  // F1: generate subcommand alias regression test
  it("should accept 'generate' as an explicit subcommand alias", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "PORT=3000\n");
    const outputPath = path.join(dir, "out-generate.ts");

    // "generate" must NOT trigger "Unexpected argument" — it is an alias for the default mode.
    await runCli([
      "generate",
      "-i",
      inputPath,
      "-o",
      outputPath,
      "--no-format",
      "-f",
      "typescript",
    ]);

    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("PORT");
  });

  it("should pass flags that follow 'generate' through to the generate pipeline", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "API_KEY=secret\n");
    const outputPath = path.join(dir, "out-gen-flags.ts");

    await runCli(["generate", "-i", inputPath, "-o", outputPath, "--no-format", "-f", "zod"]);

    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("z.string");
    expect(content).toContain("API_KEY");
  });

  // ---------------------------------------------------------------------------
  // Zero-arg auto-detection (Phase 1 viral feature)
  // ---------------------------------------------------------------------------

  it("should auto-detect .env.example and write src/env.ts when no --input is given", async () => {
    await writeFile(path.join(dir, ".env.example"), "DATABASE_URL=postgres://localhost/myapp\n");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli([], dir);

    const output = await readFile(path.join(dir, "src", "env.ts"), "utf8");
    expect(output).toContain("DATABASE_URL");
    expect(output).toContain("ProcessEnv");
  });

  it("should auto-detect .env.example.local as second fallback when .env.example is absent", async () => {
    await writeFile(path.join(dir, ".env.example.local"), "REDIS_URL=redis://localhost\n");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli([], dir);

    const output = await readFile(path.join(dir, "src", "env.ts"), "utf8");
    expect(output).toContain("REDIS_URL");
  });

  it("should auto-detect .env as last resort when neither .env.example variant exists", async () => {
    await writeFile(path.join(dir, ".env"), "STRIPE_KEY=sk_test_placeholder\n");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli([], dir);

    const output = await readFile(path.join(dir, "src", "env.ts"), "utf8");
    expect(output).toContain("STRIPE_KEY");
  });

  it("should print a Found message including variable count for zero-arg invocation", async () => {
    await writeFile(
      path.join(dir, ".env.example"),
      "DATABASE_URL=postgres://localhost\nNEXTAUTH_SECRET=changeme\n",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli([], dir);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("2 variables");
  });

  it("should print before/after import hint for zero-arg invocation", async () => {
    await writeFile(path.join(dir, ".env.example"), "API_KEY=placeholder\n");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli([], dir);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("process.env.API_KEY");
    expect(output).toContain("env.API_KEY");
    expect(output).toContain("import { env }");
  });

  // ---------------------------------------------------------------------------
  // --mode augment (Phase 1 viral feature)
  // ---------------------------------------------------------------------------

  it("should write env.d.ts augmentation when --mode augment is given", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "API_SECRET=placeholder\n");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli([
      "--input",
      inputPath,
      "--mode",
      "augment",
      "--output",
      path.join(dir, "env.d.ts"),
    ]);

    const output = await readFile(path.join(dir, "env.d.ts"), "utf8");
    expect(output).toContain("API_SECRET");
    expect(output).toContain("ProcessEnv");
    expect(output).toContain("declare namespace NodeJS");
  });

  it("should default augment output to env.d.ts in cwd when no --output is given", async () => {
    await writeFile(path.join(dir, ".env.example"), "SESSION_SECRET=placeholder\n");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["--mode", "augment"], dir);

    const output = await readFile(path.join(dir, "env.d.ts"), "utf8");
    expect(output).toContain("SESSION_SECRET");
    expect(output).toContain("declare namespace NodeJS");
  });

  it("should exit with 1 and print actionable guidance when no env file is found in fallback chain", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error(`process.exit(${String(_code)})`);
    });

    // dir is empty — no .env.example, .env.example.local, or .env
    await expect(runCli([], dir)).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should reject an unknown --mode value with exit 1", async () => {
    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "KEY=value\n");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error(`process.exit(${String(_code)})`);
    });

    await expect(
      runCli(["--input", inputPath, "--output", path.join(dir, "out.ts"), "--mode", "invalid"]),
    ).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// --check flag (Phase 2 viral feature)
// ---------------------------------------------------------------------------

describe("runCli — --check flag", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-check-"));
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("should exit 0 when --check is passed and src/env.ts is in sync", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "DB_URL=placeholder\n");
    const outputPath = path.join(dir, "src", "env.ts");

    // Generate once so the file exists and is in sync
    await runCli(["--input", inputPath, "--output", outputPath]);

    // Reset mocks so we only observe --check output
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error(`process.exit(${String(_code)})`);
    });

    await runCli(["--input", inputPath, "--output", outputPath, "--check"]);

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("should exit 1 when --check is passed and src/env.ts is out of sync", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "DB_URL=placeholder\n");
    const outputPath = path.join(dir, "src", "env.ts");

    // Generate with old content
    await runCli(["--input", inputPath, "--output", outputPath]);
    // Now add a new variable — env.ts is now out of sync
    await writeFile(inputPath, "DB_URL=placeholder\nNEW_VAR=something\n");

    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error(`process.exit(${String(_code)})`);
    });

    await expect(runCli(["--input", inputPath, "--output", outputPath, "--check"])).rejects.toThrow(
      "process.exit(1)",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should exit 1 when --check is passed and src/env.ts does not exist yet", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error(`process.exit(${String(_code)})`);
    });

    const inputPath = path.join(dir, ".env.example");
    await writeFile(inputPath, "DB_URL=placeholder\n");
    // No env.ts written — it doesn't exist yet

    await expect(
      runCli(["--input", inputPath, "--output", path.join(dir, "src", "env.ts"), "--check"]),
    ).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// runCli — verify subcommand routing
// ---------------------------------------------------------------------------

describe("runCli — verify subcommand routing", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-verify-cli-"));
    // Reset process.exitCode so tests don't bleed into each other
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("should display verify help without accessing any files", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["verify", "--help"]);

    const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Usage: env-typegen verify");
    expect(output).toContain("Any warning or error found");
  });

  it("should display pull help without requiring an adapter", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["pull", "--help"]);

    const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Usage: env-typegen pull");
  });

  it("should set exitCode 0 when all required variables are present and valid", async () => {
    const envPath = path.join(dir, ".env");
    const contractPath = path.join(dir, "env.contract.mjs");

    await writeFile(envPath, "PORT=3000\n");
    await writeFile(
      contractPath,
      [
        "export default {",
        "  schemaVersion: 1,",
        "  variables: {",
        '    PORT: { expected: { type: "number" }, required: true, clientSide: false },',
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    await runCli([
      "verify",
      "--env",
      envPath,
      "--contract",
      contractPath,
      "--targets",
      envPath, // override default .env,.env.production to avoid scanning project root
    ]);

    // cli.ts only sets process.exitCode when exitCode !== 0; undefined means success (0)
    expect(process.exitCode).toBeUndefined();
  });

  it("should set exitCode 1 when a required variable is missing from the env file", async () => {
    const envPath = path.join(dir, ".env");
    const contractPath = path.join(dir, "env.contract.mjs");

    // Only EXTRA_VAR is present — PORT (required) is missing
    await writeFile(envPath, "EXTRA_VAR=hello\n");
    await writeFile(
      contractPath,
      [
        "export default {",
        "  schemaVersion: 1,",
        "  variables: {",
        '    PORT: { expected: { type: "number" }, required: true, clientSide: false },',
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    await runCli([
      "verify",
      "--env",
      envPath,
      "--contract",
      contractPath,
      "--targets",
      envPath, // override default .env,.env.production to avoid scanning project root
    ]);

    expect(process.exitCode).toBe(1);
  });

  it("should set exitCode 1 when a variable fails type validation", async () => {
    const envPath = path.join(dir, ".env");
    const contractPath = path.join(dir, "env.contract.mjs");

    // PORT is present but has a non-numeric value
    await writeFile(envPath, "PORT=not-a-number\n");
    await writeFile(
      contractPath,
      [
        "export default {",
        "  schemaVersion: 1,",
        "  variables: {",
        '    PORT: { expected: { type: "number" }, required: true, clientSide: false },',
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    await runCli([
      "verify",
      "--env",
      envPath,
      "--contract",
      contractPath,
      "--targets",
      envPath, // override default .env,.env.production to avoid scanning project root
    ]);

    expect(process.exitCode).toBe(1);
  });
});
