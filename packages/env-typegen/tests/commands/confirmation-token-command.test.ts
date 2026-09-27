import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runConfirmationTokenCommand } from "../../src/commands/confirmation-token-command.js";
import {
  buildSyncApplyCorrelationId,
  validateApplyConfirmationToken,
} from "../../src/sync/apply-confirmation-token.js";
import { buildChangeSetFromMaps, calculateChangeSetHash } from "../../src/sync/change-set.js";

const SIGNING_KEY = "confirmation-token-command-signing-key";

describe("runConfirmationTokenCommand", () => {
  let dir: string;
  let configPath: string;
  let envPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-confirmation-token-"));
    vi.stubEnv("ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY", SIGNING_KEY);

    const adapterPath = path.join(dir, "token-adapter.mjs");
    await writeFile(
      adapterPath,
      [
        "export default {",
        '  name: "token-adapter",',
        '  pull: async () => ({ values: { PORT: "3000" } }),',
        "  push: async () => undefined,",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    configPath = path.join(dir, "env-typegen.config.mjs");
    await writeFile(
      configPath,
      [
        "export default {",
        '  input: ".env.example",',
        `  providers: { demo: { adapter: ${JSON.stringify(adapterPath)} } },`,
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    envPath = path.join(dir, ".env");
    await writeFile(envPath, "PORT=4000\n", "utf8");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function captureStdout(): () => string {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    return () => stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
  }

  function captureStderr(): () => string {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    return () => stderrSpy.mock.calls.map((call) => String(call[0])).join("");
  }

  function expectedBinding(environment: string): {
    changeSetHash: string;
    expectedCorrelationId: string;
  } {
    const changeSetHash = calculateChangeSetHash(
      buildChangeSetFromMaps({
        localValues: { PORT: "4000" },
        remoteValues: { PORT: "3000" },
      }),
    );
    return {
      changeSetHash,
      expectedCorrelationId: buildSyncApplyCorrelationId({
        provider: "demo",
        environment,
        mode: "apply",
        changeSetHash,
      }),
    };
  }

  it("should print help and return 0 when --help is passed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await runConfirmationTokenCommand(["--help"]);

    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Usage: env-typegen confirmation-token");
  });

  it("should print only a token that validates against the same change set", async () => {
    const readStdout = captureStdout();

    const code = await runConfirmationTokenCommand([
      "demo",
      "--config",
      configPath,
      "--env-file",
      envPath,
    ]);

    expect(code).toBe(0);
    const output = readStdout();
    expect(output).toMatch(/^etgac\.v1\.[\w-]+\.[a-f0-9]{64}\n$/u);

    const validation = validateApplyConfirmationToken({
      token: output.trim(),
      provider: "demo",
      environment: "development",
      ...expectedBinding("development"),
    });
    expect(validation.reasons).toEqual([]);
    expect(validation.isValid).toBe(true);
  });

  it("should bind the token to --env and report the binding with --json", async () => {
    const readStdout = captureStdout();

    const code = await runConfirmationTokenCommand([
      "--provider",
      "demo",
      "--env",
      "production",
      "--config",
      configPath,
      "--env-file",
      envPath,
      "--ttl",
      "60",
      "--json",
    ]);

    expect(code).toBe(0);
    const report = JSON.parse(readStdout()) as {
      command: string;
      environment: string;
      changeSetHash: string;
      correlationId: string;
      expiresAt: string;
      token: string;
    };
    const binding = expectedBinding("production");
    expect(report.command).toBe("confirmation-token");
    expect(report.environment).toBe("production");
    expect(report.changeSetHash).toBe(binding.changeSetHash);
    expect(report.correlationId).toBe(binding.expectedCorrelationId);

    const validation = validateApplyConfirmationToken({
      token: report.token,
      provider: "demo",
      environment: "production",
      ...binding,
    });
    expect(validation.isValid).toBe(true);
    expect(validation.payload?.expiresAt).toBe(report.expiresAt);
    expect(Date.parse(report.expiresAt) - Date.parse(validation.payload?.issuedAt ?? "")).toBe(
      60_000,
    );
  });

  it("should fail without printing a token when the signing key is missing", async () => {
    vi.stubEnv("ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY", "");
    const readStdout = captureStdout();
    const readStderr = captureStderr();

    const code = await runConfirmationTokenCommand([
      "demo",
      "--config",
      configPath,
      "--env-file",
      envPath,
    ]);

    expect(code).toBe(1);
    expect(readStdout()).toBe("");
    expect(readStderr()).toContain("ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY is required");
  });

  it.each(["0", "901", "1.5", "abc", "", "0x10", "1e2", " 5"])(
    "should reject --ttl %j",
    async (ttl) => {
      const readStdout = captureStdout();
      const readStderr = captureStderr();

      const code = await runConfirmationTokenCommand([
        "demo",
        "--config",
        configPath,
        "--env-file",
        envPath,
        "--ttl",
        ttl,
      ]);

      expect(code).toBe(1);
      expect(readStdout()).toBe("");
      expect(readStderr()).toContain("Invalid --ttl");
    },
  );

  it("should fail when the provider is not configured", async () => {
    const readStderr = captureStderr();

    const code = await runConfirmationTokenCommand(["unknown", "--config", configPath]);

    expect(code).toBe(1);
    expect(readStderr()).toContain('Provider "unknown" is not configured');
  });

  it("should fail when no provider is given", async () => {
    const readStderr = captureStderr();

    const code = await runConfirmationTokenCommand(["--config", configPath]);

    expect(code).toBe(1);
    expect(readStderr()).toContain("Provider is required");
  });

  it("should fail on an unknown option instead of throwing", async () => {
    const readStderr = captureStderr();

    const code = await runConfirmationTokenCommand(["demo", "--apply"]);

    expect(code).toBe(1);
    expect(readStderr()).toContain("env-typegen confirmation-token:");
  });
});
