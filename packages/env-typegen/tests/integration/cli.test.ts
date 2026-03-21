import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(CURRENT_DIR, "../..");
const DIST_CLI = path.resolve(PACKAGE_ROOT, "dist/cli.js");

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

  it("should default to typescript generator and write a single file when no --format flag is given", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-int-test-"));
    const inputPath = path.join(dir, ".env.example");
    const outputPath = path.join(dir, "env.ts");

    await writeFile(inputPath, "API_KEY=secret\n", "utf8");

    runBuiltCli(["--input", inputPath, "--output", outputPath], PACKAGE_ROOT);

    // Single generator (typescript): output uses the provided path directly, no suffix
    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("API_KEY");
    expect(content).toContain("ProcessEnv");
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
});
