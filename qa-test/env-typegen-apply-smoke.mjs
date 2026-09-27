import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const reportsDirectory = path.join(scriptDirectory, "reports");
const reportFilePath = path.join(
  reportsDirectory,
  "env-governance-apply-smoke.json",
);
const cliEntrypoint = path.join(
  repositoryRoot,
  "packages/env-typegen/dist/cli.js",
);
const smokeConfirmationSigningKey =
  process.env.ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY ??
  "env-typegen-smoke-confirmation-signing-key";
process.env.ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY = smokeConfirmationSigningKey;
const smokeEvidenceSigningKey =
  process.env.ENV_TYPEGEN_EVIDENCE_SIGNING_KEY ??
  "env-typegen-smoke-evidence-signing-key";

function getModeFromArgs(argv) {
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  if (modeArg === undefined) {
    return "all";
  }

  const value = modeArg.slice("--mode=".length);
  if (value === "dry-run" || value === "apply" || value === "all") {
    return value;
  }

  throw new Error(`Unsupported mode: ${value}`);
}

function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY: smokeConfirmationSigningKey,
        ENV_TYPEGEN_EVIDENCE_SIGNING_KEY: smokeEvidenceSigningKey,
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr, args });
    });
  });
}

function buildApplyCorrelationId({ provider, environment, changeSetHash }) {
  return `${provider}:${environment}:apply:${changeSetHash.slice(0, 16)}`;
}

function createSmokeConfirmationToken({ provider, environment, changeSetHash }) {
  const now = new Date();
  const payload = {
    version: 1,
    purpose: "sync-apply",
    nonce: randomUUID(),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    provider,
    environment,
    changeSetHash,
    correlationId: buildApplyCorrelationId({
      provider,
      environment,
      changeSetHash,
    }),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", smokeConfirmationSigningKey)
    .update(`etgac.v1.${encodedPayload}`, "utf8")
    .digest("hex");
  return `etgac.v1.${encodedPayload}.${signature}`;
}

async function main() {
  const mode = getModeFromArgs(process.argv.slice(2));
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), "env-apply-smoke-"),
  );
  const results = [];

  try {
    const envPath = path.join(workingDirectory, ".env");
    const preflightPath = path.join(workingDirectory, "preflight.json");
    const adapterPath = path.join(workingDirectory, "apply-smoke-adapter.mjs");
    const dryRunConfigPath = path.join(
      workingDirectory,
      "env-typegen.dry-run.config.mjs",
    );
    const applyConfigPath = path.join(
      workingDirectory,
      "env-typegen.apply.config.mjs",
    );
    const blockedConfigPath = path.join(
      workingDirectory,
      "env-typegen.blocked.config.mjs",
    );

    await writeFile(
      envPath,
      "API_URL=https://example.com\nPORT=3000\n",
      "utf8",
    );
    await writeFile(
      preflightPath,
      JSON.stringify({ preflightAttestation: { invalid: true } }, null, 2),
      "utf8",
    );

    await writeFile(
      adapterPath,
      [
        "export default {",
        '  name: "apply-smoke",',
        '  pull: async () => ({ values: { API_URL: "https://example.com", PORT: "3000" } }),',
        "  push: async () => undefined,",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      dryRunConfigPath,
      [
        "export default {",
        "  input: '.env.example',",
        "  providers: {",
        `    smoke: { adapter: ${JSON.stringify(adapterPath)} },`,
        "  },",
        "  writePolicy: {",
        "    enableApply: false,",
        "    requirePreflight: true,",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      applyConfigPath,
      [
        "export default {",
        "  input: '.env.example',",
        "  providers: {",
        `    smoke: { adapter: ${JSON.stringify(adapterPath)} },`,
        "  },",
        "  writePolicy: {",
        "    enableApply: true,",
        "    requirePreflight: true,",
        "    protectedEnvironments: ['production'],",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      blockedConfigPath,
      [
        "export default {",
        "  input: '.env.example',",
        "  providers: {",
        `    smoke: { adapter: ${JSON.stringify(adapterPath)} },`,
        "  },",
        "  writePolicy: {",
        "    enableApply: false,",
        "    requirePreflight: false,",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const run = async (name, args, expectedCode, expectedSummary) => {
      const result = await runCommand(
        "node",
        [cliEntrypoint, ...args],
        repositoryRoot,
      );
      let passed =
        expectedCode === "non-zero"
          ? result.code !== 0
          : result.code === expectedCode;

      if (passed && expectedSummary !== undefined) {
        try {
          const payload = JSON.parse(result.stdout.trim());
          const summary = payload.governanceSummary;
          const matchesOutcome =
            expectedSummary.outcome === undefined ||
            summary?.outcome === expectedSummary.outcome;
          const matchesStage =
            expectedSummary.stage === undefined ||
            summary?.stage === expectedSummary.stage;
          passed = matchesOutcome && matchesStage;
        } catch {
          passed = false;
        }
      }

      results.push({
        name,
        status: passed ? "pass" : "fail",
        details: passed
          ? `exitCode=${result.code}`
          : `unexpected exitCode=${result.code}; stdout=${result.stdout.trim()} stderr=${result.stderr.trim()}`,
      });
    };

    if (mode === "dry-run" || mode === "all") {
      await run(
        "sync-apply dry-run should pass by default",
        [
          "sync-apply",
          "smoke",
          "--config",
          dryRunConfigPath,
          "--env-file",
          envPath,
          "--json",
        ],
        0,
        { outcome: "pass", stage: "enforce" },
      );
    }

    if (mode === "apply" || mode === "all") {
      const previewResult = await runCommand(
        "node",
        [
          cliEntrypoint,
          "sync-preview",
          "smoke",
          "--config",
          applyConfigPath,
          "--env",
          "production",
          "--env-file",
          envPath,
          "--json",
        ],
        repositoryRoot,
      );

      let confirmationToken = "";
      if (previewResult.code === 0) {
        try {
          const previewPayload = JSON.parse(previewResult.stdout.trim());
          if (
            typeof previewPayload.changeSetHash === "string" &&
            typeof previewPayload.preflightAttestation === "object" &&
            previewPayload.preflightAttestation !== null
          ) {
            await writeFile(
              preflightPath,
              JSON.stringify(
                { preflightAttestation: previewPayload.preflightAttestation },
                null,
                2,
              ),
              "utf8",
            );
            confirmationToken = createSmokeConfirmationToken({
              provider: "smoke",
              environment: "production",
              changeSetHash: previewPayload.changeSetHash,
            });
          }
        } catch {
          confirmationToken = "";
        }
      }

      await run(
        "sync-apply apply should fail when writes are disabled",
        [
          "sync-apply",
          "smoke",
          "--config",
          blockedConfigPath,
          "--env-file",
          envPath,
          "--apply",
          "--json",
        ],
        "non-zero",
        { outcome: "fail", stage: "advisory" },
      );

      await run(
        "sync-apply apply should fail in protected environment without protected branch",
        [
          "sync-apply",
          "smoke",
          "--config",
          applyConfigPath,
          "--env",
          "production",
          "--env-file",
          envPath,
          "--apply",
          "--preflight-file",
          preflightPath,
          "--confirmation-token",
          confirmationToken,
          "--json",
        ],
        "non-zero",
        { outcome: "fail", stage: "advisory" },
      );

      await run(
        "sync-apply apply should pass in protected environment with preflight and protected branch",
        [
          "sync-apply",
          "smoke",
          "--config",
          applyConfigPath,
          "--env",
          "production",
          "--env-file",
          envPath,
          "--apply",
          "--preflight-file",
          preflightPath,
          "--confirmation-token",
          confirmationToken,
          "--protected-branch",
          "--json",
        ],
        0,
        { outcome: "pass", stage: "apply" },
      );
    }

    await mkdir(reportsDirectory, { recursive: true });

    let promotionStage = "all";
    if (mode === "dry-run") {
      promotionStage = "enforce";
    }
    if (mode === "apply") {
      promotionStage = "apply";
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      mode,
      promotionStage,
      total: results.length,
      passed: results.filter((result) => result.status === "pass").length,
      failed: results.filter((result) => result.status === "fail").length,
      results,
    };

    await writeFile(reportFilePath, JSON.stringify(summary, null, 2), "utf8");

    if (summary.failed > 0) {
      console.error(`GOVERNANCE_APPLY_SMOKE_FAILED:${summary.failed}`);
      process.exit(1);
    }

    console.log(`GOVERNANCE_APPLY_SMOKE_OK:${summary.passed}/${summary.total}`);
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

await main();
