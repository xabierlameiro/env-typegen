import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runSyncApplyCommand } from "../../src/commands/sync-apply-command.js";

describe("runSyncApplyCommand", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "env-typegen-sync-apply-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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

  it("should print help and return 0 when --help is passed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await runSyncApplyCommand(["--help"]);

    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Usage: env-typegen sync-apply");
  });

  it("should run in dry-run mode by default and return 0", async () => {
    vi.stubEnv("ENV_TYPEGEN_EVIDENCE_SIGNING_KEY", "sync-apply-test-evidence-signing-key");
    const adapterPath = await writeAdapter(
      "sync-adapter.mjs",
      [
        "export default {",
        '  name: "sync-adapter",',
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
        "    enableApply: false,",
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
      "--json",
    ]);

    expect(code).toBe(0);
    const payload = JSON.parse(
      stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("")
        .trim(),
    ) as {
      mode: string;
      apply: { summary: { mode: string } };
      evidenceBundle: {
        schemaVersion: number;
        bundleHash: string;
        signature: { signature: string; signatureId: string };
        forensicsIndex: { indexId: string; indexHash: string };
      };
      governanceSummary: {
        outcome: string;
        stage: string;
        rollout: {
          cohort: string;
          action: string;
          canProceed: boolean;
        };
      };
    };

    expect(payload.mode).toBe("dry-run");
    expect(payload.apply.summary.mode).toBe("dry-run");
    expect(payload.evidenceBundle.schemaVersion).toBe(1);
    expect(payload.evidenceBundle.bundleHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(payload.evidenceBundle.signature.signature).toMatch(/^[a-f0-9]{64}$/u);
    expect(payload.evidenceBundle.forensicsIndex.indexHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(payload.governanceSummary.outcome).toBe("pass");
    expect(payload.governanceSummary.stage).toBe("enforce");
    expect(payload.governanceSummary.rollout.cohort).toBe("ramp");
    expect(payload.governanceSummary.rollout.action).toBe("advance");
    expect(payload.governanceSummary.rollout.canProceed).toBe(true);
  });

  it("should mark dry-run evidence as unsigned when no evidence signing key is set", async () => {
    vi.stubEnv("ENV_TYPEGEN_EVIDENCE_SIGNING_KEY", "");
    const adapterPath = await writeAdapter(
      "sync-adapter.mjs",
      [
        "export default {",
        '  name: "sync-adapter",',
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
        `  providers: { demo: { adapter: ${JSON.stringify(adapterPath)} } },`,
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
      "--json",
    ]);

    expect(code).toBe(0);
    const payload = JSON.parse(
      stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("")
        .trim(),
    ) as { evidenceBundle: { signature: { algorithm: string; keyId: string; signature: string } } };

    expect(payload.evidenceBundle.signature).toMatchObject({
      algorithm: "none",
      keyId: "unsigned",
      signature: "",
    });
  });

  it("should block apply mode when writePolicy.enableApply is false", async () => {
    const adapterPath = await writeAdapter(
      "blocked-adapter.mjs",
      [
        "export default {",
        '  name: "blocked-adapter",',
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
        "    enableApply: false,",
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
    const payload = JSON.parse(
      stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("")
        .trim(),
    ) as {
      allowed: boolean;
      evidenceBundle: {
        schemaVersion: number;
        bundleHash: string;
        signature: { signatureId: string };
        forensicsIndex: { signatureId: string };
      };
      guardResult: { reasons: string[] };
      governanceSummary: {
        outcome: string;
        stage: string;
        rollout: {
          action: string;
          canProceed: boolean;
        };
      };
    };

    expect(payload.allowed).toBe(false);
    expect(payload.evidenceBundle.schemaVersion).toBe(1);
    expect(payload.evidenceBundle.bundleHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(payload.evidenceBundle.forensicsIndex.signatureId).toBe(
      payload.evidenceBundle.signature.signatureId,
    );
    expect(payload.guardResult.reasons.join(" ")).toContain("disabled");
    expect(payload.governanceSummary.outcome).toBe("fail");
    expect(payload.governanceSummary.stage).toBe("advisory");
    expect(payload.governanceSummary.rollout.action).toBe("rollback");
    expect(payload.governanceSummary.rollout.canProceed).toBe(false);
  });
});
