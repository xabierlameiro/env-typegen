import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runValidationCommand } from "../src/validation-command.js";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

async function createContractFile(dir: string): Promise<string> {
  // BUG-01: use .mjs extension — .ts files cannot be dynamically imported by Node.js
  // at runtime without a loader, so tests that write contract fixtures must use .mjs.
  const filePath = path.join(dir, "env.contract.mjs");
  await writeFile(
    filePath,
    [
      "export default {",
      "  schemaVersion: 1,",
      "  variables: {",
      '    PORT: { expected: { type: "number" }, required: true, clientSide: false },',
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  return filePath;
}

describe("validation command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should treat extras as errors by default in check command", async () => {
    const dir = await createTempDir("env-typegen-validation-cmd-");
    const contractPath = await createContractFile(dir);
    const envPath = path.join(dir, ".env");
    await writeFile(envPath, "PORT=3000\nEXTRA=true\n", "utf8");

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const strictExit = await runValidationCommand({
      command: "check",
      argv: ["--env", envPath, "--contract", contractPath, "--json"],
    });
    const relaxedExit = await runValidationCommand({
      command: "check",
      argv: ["--env", envPath, "--contract", contractPath, "--json", "--no-strict"],
    });

    expect(strictExit).toBe(1);
    expect(relaxedExit).toBe(0);
  });

  it("should run diff and doctor commands with JSON output", async () => {
    const dir = await createTempDir("env-typegen-validation-cmd-");
    const contractPath = await createContractFile(dir);
    const envLocal = path.join(dir, ".env");
    const envProd = path.join(dir, ".env.production");
    await writeFile(envLocal, "PORT=3000\n", "utf8");
    await writeFile(envProd, "PORT=not-a-number\n", "utf8");

    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });

    const diffExit = await runValidationCommand({
      command: "diff",
      argv: ["--contract", contractPath, "--targets", `${envLocal},${envProd}`, "--json"],
    });

    const doctorExit = await runValidationCommand({
      command: "doctor",
      argv: [
        "--env",
        envLocal,
        "--contract",
        contractPath,
        "--targets",
        `${envLocal},${envProd}`,
        "--json=pretty",
      ],
    });

    const lastJson = writes.at(-1) ?? "{}";
    const parsed = JSON.parse(lastJson) as { recommendations?: string[] };

    expect(diffExit).toBe(1);
    expect(doctorExit).toBe(1);
    expect((parsed.recommendations ?? []).length).toBeGreaterThan(0);
  });

  it("should fail in verify mode when warnings exist", async () => {
    const dir = await createTempDir("env-typegen-validation-cmd-");
    const contractPath = await createContractFile(dir);
    const envPath = path.join(dir, ".env");
    await writeFile(envPath, "PORT=3000\nEXTRA=true\n", "utf8");

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const exitCode = await runValidationCommand({
      command: "verify",
      argv: ["--env", envPath, "--contract", contractPath, "--no-strict", "--json"],
    });

    expect(exitCode).toBe(1);
  });

  it("should print help text and exit successfully", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runValidationCommand({
      command: "check",
      argv: ["--help"],
    });

    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
    expect(output).toContain("Usage: env-typegen check");
    expect(output).toContain("status: ok");
    expect(output).not.toContain("status: ok or warn");
  });

  it("should document ok/fail exit statuses for diff and doctor help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const diffExitCode = await runValidationCommand({
      command: "diff",
      argv: ["--help"],
    });
    const doctorExitCode = await runValidationCommand({
      command: "doctor",
      argv: ["--help"],
    });

    const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
    expect(diffExitCode).toBe(0);
    expect(doctorExitCode).toBe(0);
    expect(output).toContain("Usage: env-typegen diff");
    expect(output).toContain("Usage: env-typegen doctor");
    expect(output).toContain("status: ok");
    expect(output).not.toContain("status: ok or warn");
  });

  it("should validate cloud snapshots and write JSON output to a file", async () => {
    const dir = await createTempDir("env-typegen-validation-cmd-");
    const contractPath = await createContractFile(dir);
    const cloudSnapshotPath = path.join(dir, "vercel-env.json");
    const outputFile = path.join(dir, "reports", "check.json");

    await writeFile(
      cloudSnapshotPath,
      JSON.stringify([{ key: "PORT", value: "3000" }], null, 2),
      "utf8",
    );

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const exitCode = await runValidationCommand({
      command: "check",
      argv: [
        "--contract",
        contractPath,
        "--cloud-provider",
        "vercel",
        "--cloud-file",
        cloudSnapshotPath,
        "--json=pretty",
        "--output-file",
        outputFile,
      ],
    });

    const persisted = JSON.parse(await readFile(outputFile, "utf8")) as {
      meta: { env: string };
      status: string;
    };

    expect(exitCode).toBe(0);
    expect(persisted.meta.env).toBe("cloud:vercel");
    expect(persisted.status).toBe("ok");
  });

  it("should use config diff targets and schema file when targets are not passed", async () => {
    const dir = await createTempDir("env-typegen-validation-cmd-");
    const contractPath = path.join(dir, "env.contract.js");
    const configPath = path.join(dir, "env-typegen.config.mjs");
    const envA = path.join(dir, ".env.staging");
    const envB = path.join(dir, ".env.production");

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
      "utf8",
    );
    await writeFile(
      configPath,
      [
        "export default {",
        '  schemaFile: "./env.contract.js",',
        '  diffTargets: ["./.env.staging", "./.env.production"],',
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(envA, "PORT=3000\n", "utf8");
    await writeFile(envB, "PORT=3000\n", "utf8");

    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });

    const exitCode = await runValidationCommand({
      command: "diff",
      argv: ["--config", configPath, "--json=compact"],
    });

    expect(exitCode).toBe(0);
    const output = writes.at(-1) ?? "{}";
    expect(JSON.parse(output)).toMatchObject({
      status: "ok",
      summary: { errors: 0 },
    });
  });

  it("should fail fast for unsupported cloud providers", async () => {
    await expect(
      runValidationCommand({
        command: "check",
        argv: ["--cloud-provider", "invalid-provider"],
      }),
    ).rejects.toThrow("Unknown cloud provider");
  });

  it("should load relative plugins from config files and apply report transforms", async () => {
    const dir = await createTempDir("env-typegen-validation-cmd-");
    const contractPath = path.join(dir, "env.contract.js");
    const pluginPath = path.join(dir, "report-plugin.mjs");
    const configPath = path.join(dir, "env-typegen.config.mjs");
    const envA = path.join(dir, ".env.a");
    const envB = path.join(dir, ".env.b");

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
      "utf8",
    );
    await writeFile(
      pluginPath,
      [
        "export default {",
        '  name: "report-plugin",',
        "  transformReport: (report) => ({",
        "    ...report,",
        '    recommendations: [...(report.recommendations ?? []), "plugin-applied"],',
        "  }),",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      configPath,
      [
        "export default {",
        '  input: ["./.env.a", "./.env.b"],',
        '  schemaFile: "./env.contract.js",',
        '  diffTargets: ["./.env.a", "./.env.b"],',
        '  plugins: ["./report-plugin.mjs"],',
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(envA, "PORT=3000\n", "utf8");
    await writeFile(envB, "PORT=3000\n", "utf8");

    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });

    const exitCode = await runValidationCommand({
      command: "diff",
      argv: ["--config", configPath, "--json"],
    });

    const report = JSON.parse(writes.at(-1) ?? "{}") as {
      recommendations?: string[];
      status: string;
    };

    expect(exitCode).toBe(0);
    expect(report.status).toBe("ok");
    expect(report.recommendations).toContain("plugin-applied");
  });

  it("should include cloud sources in diff and doctor command executions", async () => {
    const dir = await createTempDir("env-typegen-validation-cmd-");
    const contractPath = path.join(dir, "env.contract.js");
    const cloudSnapshot = path.join(dir, "aws-env.json");
    const envPath = path.join(dir, ".env");
    const targetPath = path.join(dir, ".env.production");
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
      "utf8",
    );
    await writeFile(envPath, "PORT=3000\n", "utf8");
    await writeFile(targetPath, "PORT=3000\n", "utf8");
    await writeFile(
      cloudSnapshot,
      JSON.stringify({ Parameters: [{ Name: "/prod/PORT", Value: "3000" }] }, null, 2),
      "utf8",
    );

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const diffExit = await runValidationCommand({
      command: "diff",
      argv: [
        "--contract",
        contractPath,
        "--targets",
        `${envPath},${targetPath}`,
        "--cloud-provider",
        "aws",
        "--cloud-file",
        cloudSnapshot,
        "--json",
      ],
    });
    const doctorExit = await runValidationCommand({
      command: "doctor",
      argv: [
        "--env",
        envPath,
        "--contract",
        contractPath,
        "--targets",
        `${envPath},${targetPath}`,
        "--cloud-provider",
        "aws",
        "--cloud-file",
        cloudSnapshot,
        "--json",
      ],
    });

    expect(diffExit).toBe(0);
    expect(doctorExit).toBe(0);
  });

  it("should fallback to default diff targets when none are configured", async () => {
    const dir = await createTempDir("env-typegen-validation-cmd-");
    const contractPath = path.join(dir, "env.contract.js");
    await writeFile(contractPath, "export default { schemaVersion: 1, variables: {} };\n", "utf8");

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const exitCode = await runValidationCommand({
      command: "diff",
      argv: ["--contract", contractPath, "--no-strict", "--json"],
    });

    expect(exitCode).toBe(0);
  });

  it("should not include .env.example in default diff targets", async () => {
    const dir = await createTempDir("env-typegen-validation-cmd-");
    const contractPath = path.join(dir, "env.contract.js");
    const envPath = path.join(dir, ".env");
    const productionPath = path.join(dir, ".env.production");
    const examplePath = path.join(dir, ".env.example");
    const originalCwd = process.cwd();

    await writeFile(
      contractPath,
      [
        "export default {",
        "  schemaVersion: 1,",
        "  variables: {",
        '    DATABASE_READONLY_URL: { expected: { type: "url" }, required: false, clientSide: false },',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(envPath, "", "utf8");
    await writeFile(productionPath, "", "utf8");
    await writeFile(examplePath, "DATABASE_READONLY_URL=\n", "utf8");

    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      process.chdir(dir);
      const exitCode = await runValidationCommand({
        command: "diff",
        argv: ["--contract", contractPath, "--json"],
      });

      expect(exitCode).toBe(0);
      const report = JSON.parse(writes.at(-1) ?? "{}") as {
        issues: { environment: string }[];
      };
      expect(report.issues.map((issue) => issue.environment)).not.toContain(".env.example");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should summarize missing target files in doctor output", async () => {
    const dir = await createTempDir("env-typegen-validation-cmd-");
    const contractPath = path.join(dir, "env.contract.js");
    const envPath = path.join(dir, ".env");
    const originalCwd = process.cwd();

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
      "utf8",
    );
    await writeFile(envPath, "PORT=3000\n", "utf8");

    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      process.chdir(dir);
      const exitCode = await runValidationCommand({
        command: "doctor",
        argv: ["--env", envPath, "--contract", contractPath, "--json"],
      });

      expect(exitCode).toBe(1);
      const report = JSON.parse(writes.at(-1) ?? "{}") as {
        summary: { errors: number };
        issues: { environment: string; key: string; message: string }[];
      };
      const missingTargetIssue = report.issues.find(
        (issue) => issue.environment === ".env.production" && issue.key === "*",
      );
      expect(report.summary.errors).toBe(1);
      expect(missingTargetIssue?.message).toContain("was not found; treating as empty");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should not duplicate missing .env warning in doctor output", async () => {
    const dir = await createTempDir("env-typegen-validation-cmd-");
    const contractPath = path.join(dir, "env.contract.js");
    const originalCwd = process.cwd();

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
      "utf8",
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      process.chdir(dir);
      const exitCode = await runValidationCommand({
        command: "doctor",
        argv: ["--contract", contractPath, "--json"],
      });

      expect(exitCode).toBe(1);
      const warningMessages = warnSpy.mock.calls
        .map(([message]) => String(message))
        .filter((message) => message.includes("Target file not found"));
      const envWarnings = warningMessages.filter((message) =>
        message.includes("Target file not found: .env — treating as empty"),
      );

      expect(envWarnings).toHaveLength(1);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
