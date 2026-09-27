import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const reportsDirectory = path.join(scriptDirectory, "reports");
const reportFilePath = path.join(
  reportsDirectory,
  "env-governance-promotion-smoke.json",
);
const smokeConfirmationSigningKey =
  process.env.ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY ??
  "env-typegen-smoke-confirmation-signing-key";
process.env.ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY = smokeConfirmationSigningKey;

function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY: smokeConfirmationSigningKey,
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
      resolve({
        name: args.join(" "),
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function readJsonReport(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function toStepResult(params) {
  const status = params.commandResult.exitCode === 0 ? "pass" : "fail";

  return {
    step: params.label,
    status,
    exitCode: params.commandResult.exitCode,
    ...(params.report === undefined
      ? {}
      : {
          report: {
            total: params.report.total,
            passed: params.report.passed,
            failed: params.report.failed,
            ...(params.report.promotionStage === undefined
              ? {}
              : { promotionStage: params.report.promotionStage }),
          },
        }),
    details:
      status === "pass"
        ? `exitCode=${params.commandResult.exitCode}`
        : `exitCode=${params.commandResult.exitCode}; stderr=${params.commandResult.stderr.trim()}`,
  };
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
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

async function runEvidenceProbe() {
  const cliEntrypoint = path.join(
    repositoryRoot,
    "packages/env-typegen/dist/cli.js",
  );
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), "env-evidence-smoke-"),
  );

  try {
    const envPath = path.join(workingDirectory, ".env");
    const adapterPath = path.join(workingDirectory, "evidence-adapter.mjs");
    const configPath = path.join(workingDirectory, "env-typegen.config.mjs");

    await writeFile(
      envPath,
      "API_URL=https://example.com\nPORT=3000\n",
      "utf8",
    );
    await writeFile(
      adapterPath,
      [
        "export default {",
        '  name: "evidence-adapter",',
        '  pull: async () => ({ values: { API_URL: "https://example.com", PORT: "3000" } }),',
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      configPath,
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

    const probe = await runCommand(
      "node",
      [
        cliEntrypoint,
        "sync-apply",
        "smoke",
        "--config",
        configPath,
        "--env-file",
        envPath,
        "--json",
      ],
      repositoryRoot,
    );

    if (probe.exitCode !== 0) {
      return {
        step: "evidence probe",
        status: "fail",
        details: `sync-apply probe failed with exitCode=${probe.exitCode}`,
      };
    }

    const payload = JSON.parse(probe.stdout.trim());
    const evidence = payload.evidenceBundle;
    const governanceEvidence = payload.governanceSummary?.evidence;

    const schemaPass = evidence?.schemaVersion === 1;
    const hashPass =
      isSha256(evidence?.bundleHash) &&
      isSha256(evidence?.audit?.lifecycleHash);
    const correlationPass =
      governanceEvidence?.bundleHash === evidence?.bundleHash &&
      governanceEvidence?.lifecycleHash === evidence?.audit?.lifecycleHash;

    const passed = schemaPass && hashPass && correlationPass;

    return {
      step: "evidence probe",
      status: passed ? "pass" : "fail",
      details: passed
        ? "evidence schema/hash correlation validated"
        : "evidence schema/hash correlation validation failed",
      report: {
        schemaVersion: evidence?.schemaVersion,
        hashPass,
        correlationPass,
      },
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

async function runCohortRolloutProbe() {
  const cliEntrypoint = path.join(
    repositoryRoot,
    "packages/env-typegen/dist/cli.js",
  );
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), "env-cohort-smoke-"),
  );

  try {
    const envPath = path.join(workingDirectory, ".env");
    const contractPath = path.join(workingDirectory, "env.contract.mjs");
    const adapterPath = path.join(workingDirectory, "cohort-adapter.mjs");
    const configPath = path.join(workingDirectory, "env-typegen.config.mjs");

    await writeFile(
      envPath,
      "API_URL=https://example.com\nPORT=3000\n",
      "utf8",
    );
    await writeFile(
      contractPath,
      [
        "export default {",
        "  schemaVersion: 1,",
        "  variables: {",
        '    API_URL: { expected: { type: "url" }, required: true, clientSide: false },',
        '    PORT: { expected: { type: "number" }, required: true, clientSide: false },',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      adapterPath,
      [
        "export default {",
        '  name: "cohort-adapter",',
        '  pull: async () => ({ values: { API_URL: "https://example.com", PORT: "3000" } }),',
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
        "  input: '.env.example',",
        "  providers: {",
        `    smoke: { adapter: ${JSON.stringify(adapterPath)} },`,
        "  },",
        "  writePolicy: {",
        "    enableApply: true,",
        "    requirePreflight: false,",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    const plan = await runCommand(
      "node",
      [
        cliEntrypoint,
        "plan",
        "--env",
        envPath,
        "--targets",
        envPath,
        "--contract",
        contractPath,
        "--json",
      ],
      repositoryRoot,
    );
    const preview = await runCommand(
      "node",
      [
        cliEntrypoint,
        "sync-preview",
        "smoke",
        "--config",
        configPath,
        "--env-file",
        envPath,
        "--json",
      ],
      repositoryRoot,
    );
    let confirmationToken = "";
    if (preview.exitCode === 0) {
      try {
        const previewPayload = JSON.parse(preview.stdout.trim());
        if (typeof previewPayload.changeSetHash === "string") {
          confirmationToken = createSmokeConfirmationToken({
            provider: "smoke",
            environment: "development",
            changeSetHash: previewPayload.changeSetHash,
          });
        }
      } catch {
        confirmationToken = "";
      }
    }
    const apply = await runCommand(
      "node",
      [
        cliEntrypoint,
        "sync-apply",
        "smoke",
        "--config",
        configPath,
        "--env-file",
        envPath,
        "--apply",
        "--confirmation-token",
        confirmationToken,
        "--json",
      ],
      repositoryRoot,
    );

    if (plan.exitCode !== 0 || preview.exitCode !== 0 || apply.exitCode !== 0) {
      return {
        step: "cohort rollout probe",
        status: "fail",
        details:
          "plan/preview/apply command failed during cohort rollout probe",
      };
    }

    const planPayload = JSON.parse(plan.stdout.trim());
    const previewPayload = JSON.parse(preview.stdout.trim());
    const applyPayload = JSON.parse(apply.stdout.trim());

    const planRollout = planPayload.rollout;
    const previewRollout = previewPayload.rollout;
    const applyRollout = applyPayload.governanceSummary?.rollout;

    const planPass =
      planRollout?.cohort === "ramp" &&
      planRollout?.action === "advance" &&
      planRollout?.canProceed === true;
    const previewPass =
      previewRollout?.cohort === "ramp" &&
      previewRollout?.action === "advance" &&
      previewRollout?.canProceed === true;
    const applyPass =
      applyRollout?.cohort === "global" &&
      applyRollout?.action === "advance" &&
      applyRollout?.canProceed === true;

    const passed = planPass && previewPass && applyPass;

    return {
      step: "cohort rollout probe",
      status: passed ? "pass" : "fail",
      details: passed
        ? "cohort rollout assertions passed for plan/preview/apply"
        : "cohort rollout assertions failed",
      report: {
        planRollout,
        previewRollout,
        applyRollout,
      },
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const governanceSmokePath = path.join(
    scriptDirectory,
    "env-typegen-governance-smoke.mjs",
  );
  const conformanceSmokePath = path.join(
    scriptDirectory,
    "env-typegen-conformance-smoke.mjs",
  );
  const applySmokePath = path.join(
    scriptDirectory,
    "env-typegen-apply-smoke.mjs",
  );

  const conformanceResult = await runCommand(
    "node",
    [conformanceSmokePath],
    repositoryRoot,
  );
  const conformanceReportPath = path.join(
    reportsDirectory,
    "env-governance-conformance-smoke.json",
  );
  const conformanceReport = await readJsonReport(conformanceReportPath);

  const governanceResult = await runCommand(
    "node",
    [governanceSmokePath],
    repositoryRoot,
  );
  const governanceReportPath = path.join(
    reportsDirectory,
    "env-governance-smoke.json",
  );
  const governanceReport = await readJsonReport(governanceReportPath);

  const dryRunResult = await runCommand(
    "node",
    [applySmokePath, "--mode=dry-run"],
    repositoryRoot,
  );
  const applyReportPath = path.join(
    reportsDirectory,
    "env-governance-apply-smoke.json",
  );
  const dryRunReport = await readJsonReport(applyReportPath);

  const results = [
    toStepResult({
      label: "conformance smoke",
      commandResult: conformanceResult,
      report: conformanceReport,
    }),
    toStepResult({
      label: "advisory-enforce smoke",
      commandResult: governanceResult,
      report: governanceReport,
    }),
    toStepResult({
      label: "enforce dry-run smoke",
      commandResult: dryRunResult,
      report: dryRunReport,
    }),
    await runEvidenceProbe(),
    await runCohortRolloutProbe(),
  ];

  const failed = results.filter((result) => result.status === "fail").length;
  const passed = results.length - failed;

  await mkdir(reportsDirectory, { recursive: true });
  await writeFile(
    reportFilePath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        promotionStages: ["advisory", "enforce", "apply"],
        total: results.length,
        passed,
        failed,
        evidenceSchemaVersion:
          results.find((result) => result.step === "evidence probe")?.report
            ?.schemaVersion ?? null,
        evidenceIntegrityPassed:
          results.find((result) => result.step === "evidence probe")?.status ===
          "pass",
        cohortRolloutPassed:
          results.find((result) => result.step === "cohort rollout probe")
            ?.status === "pass",
        conformancePassed:
          results.find((result) => result.step === "conformance smoke")
            ?.status === "pass",
        results,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (failed > 0) {
    console.error(`GOVERNANCE_PROMOTION_SMOKE_FAILED:${failed}`);
    process.exit(1);
  }

  console.log(`GOVERNANCE_PROMOTION_SMOKE_OK:${passed}/${results.length}`);
}

await main();
