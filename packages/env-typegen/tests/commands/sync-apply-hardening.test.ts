import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runSyncApplyCommand } from "../../src/commands/sync-apply-command.js";
import {
  buildSyncApplyCorrelationId,
  createApplyConfirmationToken,
} from "../../src/sync/apply-confirmation-token.js";
import { buildChangeSetFromMaps, calculateChangeSetHash } from "../../src/sync/change-set.js";
import { createPreflightAttestation } from "../../src/trust/preflight-attestation.js";

describe("runSyncApplyCommand hardening", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-sync-apply-hardening-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function writeAdapter(filename: string, content: string): Promise<string> {
    const adapterPath = path.join(dir, filename);
    await writeFile(adapterPath, content, "utf8");
    return adapterPath;
  }

  async function writeConfig(content: string): Promise<string> {
    const configPath = path.join(dir, "env-typegen.config.mjs");
    await writeFile(configPath, content, "utf8");
    return configPath;
  }

  function createContextBoundToken(params: {
    provider: string;
    environment: string;
    changeSetHash: string;
    now?: Date;
    ttlSeconds?: number;
  }): { token: string; correlationId: string } {
    const correlationId = buildSyncApplyCorrelationId({
      provider: params.provider,
      environment: params.environment,
      mode: "apply",
      changeSetHash: params.changeSetHash,
    });
    const token = createApplyConfirmationToken({
      provider: params.provider,
      environment: params.environment,
      changeSetHash: params.changeSetHash,
      correlationId,
      ...(params.now === undefined ? {} : { now: params.now }),
      ...(params.ttlSeconds === undefined ? {} : { ttlSeconds: params.ttlSeconds }),
    });
    return { token, correlationId };
  }

  it("should block apply without confirmation token", async () => {
    const adapterPath = await writeAdapter(
      "apply-adapter.mjs",
      [
        "export default {",
        '  name: "apply-adapter",',
        '  pull: async () => ({ values: { PORT: "3000" } }),',
        "  push: async () => undefined,",
        "};",
        "",
      ].join("\n"),
    );

    const configPath = await writeConfig(
      [
        "export default {",
        '  input: ".env.example",',
        "  providers: {",
        `    demo: { adapter: ${JSON.stringify(adapterPath)} },`,
        "  },",
        "  writePolicy: {",
        "    enableApply: true,",
        "    requirePreflight: false,",
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const envPath = path.join(dir, ".env");
    await writeFile(envPath, "PORT=3000\n", "utf8");

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await runSyncApplyCommand([
      "demo",
      "--config",
      configPath,
      "--env-file",
      envPath,
      "--apply",
      "--json",
    ]);

    expect(code).toBe(1);
    const raw = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("")
      .trim();
    const parsed = JSON.parse(raw) as { guardResult: { reasons: string[] } };
    expect(parsed.guardResult.reasons.join(" ")).toContain("one-time confirmation token");
  });

  it("should allow apply when attestation and confirmation token are valid", async () => {
    const adapterPath = await writeAdapter(
      "apply-adapter.mjs",
      [
        "export default {",
        '  name: "apply-adapter",',
        '  pull: async () => ({ values: { PORT: "3000" } }),',
        "  push: async () => undefined,",
        "};",
        "",
      ].join("\n"),
    );

    const configPath = await writeConfig(
      [
        "export default {",
        '  input: ".env.example",',
        "  providers: {",
        `    demo: { adapter: ${JSON.stringify(adapterPath)} },`,
        "  },",
        "  writePolicy: {",
        "    enableApply: true,",
        "    requirePreflight: true,",
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const envPath = path.join(dir, ".env");
    await writeFile(envPath, "PORT=3000\n", "utf8");

    const proofFilePath = path.join(dir, "preflight.json");
    const changeSetHash = calculateChangeSetHash(
      buildChangeSetFromMaps({
        localValues: { PORT: "3000" },
        remoteValues: { PORT: "3000" },
      }),
    );
    const { token } = createContextBoundToken({
      provider: "demo",
      environment: "development",
      changeSetHash,
    });
    const attestation = createPreflightAttestation({
      command: "sync-preview",
      provider: "demo",
      environment: "development",
      policyDecision: "allow",
      changeSetHash,
      correlationId: "demo:development:apply:fixed-correlation",
      now: new Date(),
      ttlSeconds: 300,
    });
    await writeFile(
      proofFilePath,
      JSON.stringify({ preflightAttestation: attestation }, null, 2),
      "utf8",
    );

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await runSyncApplyCommand([
      "demo",
      "--config",
      configPath,
      "--env-file",
      envPath,
      "--apply",
      "--preflight-file",
      proofFilePath,
      "--confirmation-token",
      token,
      "--protected-branch",
      "--json",
    ]);

    expect(code).toBe(0);
    const raw = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("")
      .trim();
    const parsed = JSON.parse(raw) as { apply: { summary: { failed: number } } };
    expect(parsed.apply.summary.failed).toBe(0);
  });

  it("should allow reusing the same attestation across separate command executions", async () => {
    const adapterPath = await writeAdapter(
      "apply-adapter.mjs",
      [
        "export default {",
        '  name: "apply-adapter",',
        '  pull: async () => ({ values: { PORT: "3000" } }),',
        "  push: async () => undefined,",
        "};",
        "",
      ].join("\n"),
    );

    const configPath = await writeConfig(
      [
        "export default {",
        '  input: ".env.example",',
        "  providers: {",
        `    demo: { adapter: ${JSON.stringify(adapterPath)} },`,
        "  },",
        "  writePolicy: {",
        "    enableApply: true,",
        "    requirePreflight: true,",
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const envPath = path.join(dir, ".env");
    await writeFile(envPath, "PORT=3000\n", "utf8");

    const proofFilePath = path.join(dir, "preflight-reused.json");
    const changeSetHash = calculateChangeSetHash(
      buildChangeSetFromMaps({
        localValues: { PORT: "3000" },
        remoteValues: { PORT: "3000" },
      }),
    );
    const { token } = createContextBoundToken({
      provider: "demo",
      environment: "development",
      changeSetHash,
    });
    const attestation = createPreflightAttestation({
      command: "sync-preview",
      provider: "demo",
      environment: "development",
      policyDecision: "allow",
      changeSetHash,
      correlationId: "demo:development:apply:reuse-proof",
      now: new Date(),
      ttlSeconds: 300,
    });
    await writeFile(
      proofFilePath,
      JSON.stringify({ preflightAttestation: attestation }, null, 2),
      "utf8",
    );

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const baseArgs = [
      "demo",
      "--config",
      configPath,
      "--env-file",
      envPath,
      "--apply",
      "--preflight-file",
      proofFilePath,
      "--confirmation-token",
      token,
      "--protected-branch",
      "--json",
    ];

    const firstCode = await runSyncApplyCommand(baseArgs);
    expect(firstCode).toBe(0);

    stdoutSpy.mockClear();

    const secondCode = await runSyncApplyCommand(baseArgs);
    expect(secondCode).toBe(0);

    const raw = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("")
      .trim();
    const parsed = JSON.parse(raw) as { apply: { summary: { failed: number } } };
    expect(parsed.apply.summary.failed).toBe(0);
  });

  it("should block apply when attestation context mismatches execution context", async () => {
    const adapterPath = await writeAdapter(
      "apply-adapter.mjs",
      [
        "export default {",
        '  name: "apply-adapter",',
        '  pull: async () => ({ values: { PORT: "3000" } }),',
        "  push: async () => undefined,",
        "};",
        "",
      ].join("\n"),
    );

    const configPath = await writeConfig(
      [
        "export default {",
        '  input: ".env.example",',
        "  providers: {",
        `    demo: { adapter: ${JSON.stringify(adapterPath)} },`,
        "  },",
        "  writePolicy: {",
        "    enableApply: true,",
        "    requirePreflight: true,",
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const envPath = path.join(dir, ".env");
    await writeFile(envPath, "PORT=3000\n", "utf8");

    const proofFilePath = path.join(dir, "preflight.json");
    const changeSetHash = calculateChangeSetHash(
      buildChangeSetFromMaps({
        localValues: { PORT: "3000" },
        remoteValues: { PORT: "3000" },
      }),
    );
    const { token } = createContextBoundToken({
      provider: "demo",
      environment: "development",
      changeSetHash,
    });
    const attestation = createPreflightAttestation({
      command: "sync-preview",
      provider: "demo",
      environment: "production",
      policyDecision: "allow",
      changeSetHash,
      correlationId: "mismatch-correlation",
    });
    await writeFile(
      proofFilePath,
      JSON.stringify({ preflightAttestation: attestation }, null, 2),
      "utf8",
    );

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await runSyncApplyCommand([
      "demo",
      "--config",
      configPath,
      "--env-file",
      envPath,
      "--apply",
      "--preflight-file",
      proofFilePath,
      "--confirmation-token",
      token,
      "--json",
    ]);

    expect(code).toBe(1);
    const raw = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("")
      .trim();
    const parsed = JSON.parse(raw) as { guardResult: { reasons: string[] } };
    expect(parsed.guardResult.reasons.join(" ")).toContain("environment");
  });

  it("should block apply when confirmation token signature is invalid", async () => {
    const adapterPath = await writeAdapter(
      "apply-adapter.mjs",
      [
        "export default {",
        '  name: "apply-adapter",',
        '  pull: async () => ({ values: { PORT: "3000" } }),',
        "  push: async () => undefined,",
        "};",
        "",
      ].join("\n"),
    );

    const configPath = await writeConfig(
      [
        "export default {",
        '  input: ".env.example",',
        "  providers: {",
        `    demo: { adapter: ${JSON.stringify(adapterPath)} },`,
        "  },",
        "  writePolicy: {",
        "    enableApply: true,",
        "    requirePreflight: false,",
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const envPath = path.join(dir, ".env");
    await writeFile(envPath, "PORT=3000\n", "utf8");

    const changeSetHash = calculateChangeSetHash(
      buildChangeSetFromMaps({
        localValues: { PORT: "3000" },
        remoteValues: { PORT: "3000" },
      }),
    );
    const { token } = createContextBoundToken({
      provider: "demo",
      environment: "development",
      changeSetHash,
    });
    const tamperedToken = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await runSyncApplyCommand([
      "demo",
      "--config",
      configPath,
      "--env-file",
      envPath,
      "--apply",
      "--confirmation-token",
      tamperedToken,
      "--json",
    ]);

    expect(code).toBe(1);
    const raw = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("")
      .trim();
    const parsed = JSON.parse(raw) as { guardResult: { reasons: string[] } };
    expect(parsed.guardResult.reasons.join(" ")).toContain("signature verification failed");
  });

  it("should block apply when confirmation token has expired", async () => {
    const adapterPath = await writeAdapter(
      "apply-adapter.mjs",
      [
        "export default {",
        '  name: "apply-adapter",',
        '  pull: async () => ({ values: { PORT: "3000" } }),',
        "  push: async () => undefined,",
        "};",
        "",
      ].join("\n"),
    );

    const configPath = await writeConfig(
      [
        "export default {",
        '  input: ".env.example",',
        "  providers: {",
        `    demo: { adapter: ${JSON.stringify(adapterPath)} },`,
        "  },",
        "  writePolicy: {",
        "    enableApply: true,",
        "    requirePreflight: false,",
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const envPath = path.join(dir, ".env");
    await writeFile(envPath, "PORT=3000\n", "utf8");

    const changeSetHash = calculateChangeSetHash(
      buildChangeSetFromMaps({
        localValues: { PORT: "3000" },
        remoteValues: { PORT: "3000" },
      }),
    );
    const { token } = createContextBoundToken({
      provider: "demo",
      environment: "development",
      changeSetHash,
      now: new Date("2026-03-18T10:00:00.000Z"),
      ttlSeconds: 5,
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await runSyncApplyCommand([
      "demo",
      "--config",
      configPath,
      "--env-file",
      envPath,
      "--apply",
      "--confirmation-token",
      token,
      "--json",
    ]);

    expect(code).toBe(1);
    const raw = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("")
      .trim();
    const parsed = JSON.parse(raw) as { guardResult: { reasons: string[] } };
    expect(parsed.guardResult.reasons.join(" ")).toContain("expired");
  });
});
