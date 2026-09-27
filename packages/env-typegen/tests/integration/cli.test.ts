import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(CURRENT_DIR, "../..");
const DIST_CLI = path.resolve(PACKAGE_ROOT, "dist/cli.js");
const DIST_INDEX_URL = pathToFileURL(path.resolve(PACKAGE_ROOT, "dist/index.js")).href;
const CONFIRMATION_SIGNING_KEY = "integration-confirmation-signing-key-01";
const EVIDENCE_SIGNING_KEY = "integration-evidence-signing-key-01";

/** Run the built CLI synchronously and return stdout as a string. */
function runBuiltCli(args: string[], cwd: string): string {
  const result = spawnSync("node", [DIST_CLI, ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `CLI exited with non-zero status.\nstdout: ${result.stdout ?? ""}\nstderr: ${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
}

type SyncApplyRun = { status: number | null; stdout: string };

/** Run `sync-apply` in its own process, with or without the confirmation signing key. */
function runSyncApply(args: string[], signingKey: string | undefined): SyncApplyRun {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ENV_TYPEGEN_EVIDENCE_SIGNING_KEY: EVIDENCE_SIGNING_KEY,
  };
  delete env.ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY;
  if (signingKey !== undefined) {
    env.ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY = signingKey;
  }

  const result = spawnSync("node", [DIST_CLI, "sync-apply", ...args], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    env,
  });
  return { status: result.status, stdout: result.stdout };
}

/** Create a confirmation token in a process that shares nothing but the signing key. */
function createTokenInSeparateProcess(changeSetHash: string): string {
  const script = [
    `import { buildSyncApplyCorrelationId, createApplyConfirmationToken } from ${JSON.stringify(DIST_INDEX_URL)};`,
    "const changeSetHash = process.argv[1];",
    'const context = { provider: "demo", environment: "development", changeSetHash };',
    'const correlationId = buildSyncApplyCorrelationId({ ...context, mode: "apply" });',
    "process.stdout.write(createApplyConfirmationToken({ ...context, correlationId }));",
  ].join("\n");

  const result = spawnSync("node", ["--input-type=module", "-e", script, changeSetHash], {
    encoding: "utf8",
    env: { ...process.env, ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY: CONFIRMATION_SIGNING_KEY },
  });
  if (result.status !== 0) {
    throw new Error(`Token creation failed.\nstderr: ${result.stderr}`);
  }
  return result.stdout;
}

/** Create a confirmation token with the `confirmation-token` command, in its own process. */
function createTokenWithCli(args: string[]): string {
  const result = spawnSync("node", [DIST_CLI, "confirmation-token", ...args], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    env: { ...process.env, ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY: CONFIRMATION_SIGNING_KEY },
  });
  if (result.status !== 0) {
    throw new Error(`Token creation failed.\nstderr: ${result.stderr}`);
  }
  return result.stdout.trim();
}

/** Write an adapter, a config and an env file that differ in one variable. */
async function writeSyncApplyFixture(fixtureDir: string): Promise<string[]> {
  const adapterPath = path.join(fixtureDir, "apply-adapter.mjs");
  const configPath = path.join(fixtureDir, "env-typegen.config.mjs");
  const envFilePath = path.join(fixtureDir, "sync.env");

  await writeFile(
    adapterPath,
    [
      "export default {",
      '  name: "apply-adapter",',
      '  pull: async () => ({ values: { PORT: "3000" } }),',
      "  push: async () => undefined,",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    configPath,
    [
      "export default {",
      '  input: ".env.example",',
      `  providers: { demo: { adapter: ${JSON.stringify(adapterPath)} } },`,
      // The default policy blocks any drift. Advisory mode lets the change through.
      '  policy: { mode: "advisory" },',
      "  writePolicy: {",
      "    enableApply: true,",
      "    requirePreflight: false,",
      `    confirmationNonceStorePath: ${JSON.stringify(path.join(fixtureDir, "confirmation-nonces"))},`,
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(envFilePath, "PORT=4000\n", "utf8");

  return ["demo", "--config", configPath, "--env-file", envFilePath];
}

function readGuardReasons(run: SyncApplyRun): string {
  const report = JSON.parse(run.stdout) as { guardResult: { reasons: string[] } };
  return report.guardResult.reasons.join(" ");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("cli integration", () => {
  beforeAll(() => {
    spawnSync("pnpm", ["build"], { cwd: PACKAGE_ROOT, stdio: "pipe" });
  });

  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("should generate typescript output using built dist/cli.js", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-int-test-"));
    const inputPath = path.join(dir, ".env.example");
    const outputPath = path.join(dir, "env.generated.ts");

    await writeFile(inputPath, "DATABASE_URL=postgres://localhost/db\n", "utf8");

    runBuiltCli(
      ["--input", inputPath, "--output", outputPath, "--generator", "typescript"],
      PACKAGE_ROOT,
    );

    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("DATABASE_URL");
  });

  it("should generate all four output files when no --generator flag is given", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-int-test-"));
    const inputPath = path.join(dir, ".env.example");
    const outputBase = path.join(dir, "env.ts");

    await writeFile(inputPath, "API_KEY=secret\n", "utf8");

    runBuiltCli(["--input", inputPath, "--output", outputBase], PACKAGE_ROOT);

    // With 4 generators, names are suffixed: env.typescript.ts, env.zod.ts, etc.
    const stem = path.join(dir, "env");
    expect(await exists(`${stem}.typescript.ts`)).toBe(true);
    expect(await exists(`${stem}.zod.ts`)).toBe(true);
    expect(await exists(`${stem}.t3.ts`)).toBe(true);
    expect(await exists(`${stem}.declaration.d.ts`)).toBe(true);
  });

  it("should not write any files in --dry-run mode", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-int-test-"));
    const inputPath = path.join(dir, ".env.example");
    const outputPath = path.join(dir, "env.generated.ts");

    await writeFile(inputPath, "SECRET=abc\n", "utf8");

    runBuiltCli(
      ["--input", inputPath, "--output", outputPath, "--generator", "typescript", "--dry-run"],
      PACKAGE_ROOT,
    );

    expect(await exists(outputPath)).toBe(false);
  });

  it("should run without error when --no-format flag is given", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-int-test-"));
    const inputPath = path.join(dir, ".env.example");
    const outputPath = path.join(dir, "env.generated.ts");

    await writeFile(inputPath, "PORT=3000\n", "utf8");

    runBuiltCli(
      ["--input", inputPath, "--output", outputPath, "--generator", "typescript", "--no-format"],
      PACKAGE_ROOT,
    );

    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("PORT");
  });

  it("should handle multiple --input files and produce one output per input", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-int-test-"));
    // Use non-dotfile names so derived outputs are clearly visible (not hidden files)
    const input1 = path.join(dir, "app.env.example");
    const input2 = path.join(dir, "local.env.example");
    const outputPath = path.join(dir, "out.ts");

    await writeFile(input1, "DATABASE_URL=postgres://localhost/db\n", "utf8");
    await writeFile(input2, "REDIS_URL=redis://localhost\n", "utf8");

    runBuiltCli(
      ["--input", input1, "--input", input2, "--output", outputPath, "--generator", "typescript"],
      PACKAGE_ROOT,
    );

    // Multi-input + 1 generator (isSingle=true): each output is named after the
    // input's basename-without-ext + the output extension.
    // app.env.example → app.env.ts ; local.env.example → local.env.ts
    const content1 = await readFile(path.join(dir, "app.env.ts"), "utf8");
    const content2 = await readFile(path.join(dir, "local.env.ts"), "utf8");

    expect(content1).toContain("DATABASE_URL");
    expect(content2).toContain("REDIS_URL");
  });

  // F2: dotfile collision regression test
  it("should produce distinct output files for dotfile inputs with the same .env prefix", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-int-test-"));
    // Both inputs are dotfiles sharing the ".env" stem — the old code would
    // derive the same stem (".env") for both, causing the second to overwrite first.
    const input1 = path.join(dir, ".env.example");
    const input2 = path.join(dir, ".env.extra");
    const outputPath = path.join(dir, "out.ts");

    await writeFile(input1, "DATABASE_URL=postgres://localhost/db\n", "utf8");
    await writeFile(input2, "REDIS_URL=redis://localhost\n", "utf8");

    runBuiltCli(
      ["--input", input1, "--input", input2, "--output", outputPath, "--generator", "typescript"],
      PACKAGE_ROOT,
    );

    // .env.example → env-example.ts ; .env.extra → env-extra.ts
    const content1 = await readFile(path.join(dir, "env-example.ts"), "utf8");
    const content2 = await readFile(path.join(dir, "env-extra.ts"), "utf8");

    expect(content1).toContain("DATABASE_URL");
    expect(content2).toContain("REDIS_URL");
    // Ensure neither file contains the other's content (no overwrite)
    expect(content1).not.toContain("REDIS_URL");
    expect(content2).not.toContain("DATABASE_URL");
  });

  it("should accept a confirmation token from another process once and reject its replay", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-int-test-"));
    const adapterPath = path.join(dir, "apply-adapter.mjs");
    const configPath = path.join(dir, "env-typegen.config.mjs");
    const envFilePath = path.join(dir, "sync.env");

    await writeFile(
      adapterPath,
      [
        "export default {",
        '  name: "apply-adapter",',
        '  pull: async () => ({ values: { PORT: "3000" } }),',
        "  push: async () => undefined,",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      configPath,
      [
        "export default {",
        '  input: ".env.example",',
        `  providers: { demo: { adapter: ${JSON.stringify(adapterPath)} } },`,
        "  writePolicy: {",
        "    enableApply: true,",
        "    requirePreflight: false,",
        `    confirmationNonceStorePath: ${JSON.stringify(path.join(dir, "confirmation-nonces"))},`,
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(envFilePath, "PORT=3000\n", "utf8");

    const baseArgs = ["demo", "--config", configPath, "--env-file", envFilePath, "--json"];
    const dryRun = runSyncApply(baseArgs, undefined);
    expect(dryRun.status).toBe(0);
    const dryRunReport = JSON.parse(dryRun.stdout) as {
      evidenceBundle: { changeSetHash: string };
    };

    const token = createTokenInSeparateProcess(dryRunReport.evidenceBundle.changeSetHash);
    const applyArgs = [...baseArgs, "--apply", "--confirmation-token", token];

    const applyWithoutKey = runSyncApply(applyArgs, undefined);
    expect(applyWithoutKey.status).toBe(1);
    expect(readGuardReasons(applyWithoutKey)).toContain("ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY");

    const firstApply = runSyncApply(applyArgs, CONFIRMATION_SIGNING_KEY);
    expect(firstApply.status).toBe(0);

    const replayedApply = runSyncApply(applyArgs, CONFIRMATION_SIGNING_KEY);
    expect(replayedApply.status).toBe(1);
    expect(readGuardReasons(replayedApply)).toContain("replay detected");
  });

  it("should accept a token created by the confirmation-token command", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-int-test-"));
    const fixtureArgs = await writeSyncApplyFixture(dir);

    const token = createTokenWithCli(fixtureArgs);
    const applyArgs = [...fixtureArgs, "--json", "--apply", "--confirmation-token", token];

    const otherEnvironment = runSyncApply(
      [...applyArgs, "--env", "staging"],
      CONFIRMATION_SIGNING_KEY,
    );
    expect(otherEnvironment.status).toBe(1);
    expect(readGuardReasons(otherEnvironment)).toContain("environment does not match");

    const firstApply = runSyncApply(applyArgs, CONFIRMATION_SIGNING_KEY);
    expect(firstApply.status).toBe(0);

    const replayedApply = runSyncApply(applyArgs, CONFIRMATION_SIGNING_KEY);
    expect(replayedApply.status).toBe(1);
    expect(readGuardReasons(replayedApply)).toContain("replay detected");
  });
});
