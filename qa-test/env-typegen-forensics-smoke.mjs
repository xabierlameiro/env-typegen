import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const reportsDirectory = path.join(scriptDirectory, "reports");
const reportFilePath = path.join(
  reportsDirectory,
  "env-governance-forensics-smoke.json",
);
// The probe asserts a signed evidence bundle. Without a key the bundle is unsigned.
const smokeEvidenceSigningKey =
  process.env.ENV_TYPEGEN_EVIDENCE_SIGNING_KEY ??
  "env-typegen-smoke-evidence-signing-key";

function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
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
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

async function runForensicsProbe() {
  const cliEntrypoint = path.join(
    repositoryRoot,
    "packages/env-typegen/dist/cli.js",
  );
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), "env-forensics-smoke-"),
  );

  try {
    const envPath = path.join(workingDirectory, ".env");
    const adapterPath = path.join(workingDirectory, "forensics-adapter.mjs");
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
        '  name: "forensics-adapter",',
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
        status: "fail",
        details: `sync-apply forensics probe failed with exitCode=${probe.exitCode}`,
      };
    }

    const payload = JSON.parse(probe.stdout.trim());
    const evidence = payload.evidenceBundle;
    const summaryEvidence = payload.governanceSummary?.evidence;

    const signedEvidencePass =
      evidence?.schemaVersion === 1 &&
      isSha256(evidence?.bundleHash) &&
      isSha256(evidence?.signature?.signature);

    const forensicsChainPass =
      isSha256(evidence?.forensicsIndex?.indexHash) &&
      evidence?.forensicsIndex?.signatureId ===
        evidence?.signature?.signatureId &&
      evidence?.forensicsIndex?.lifecycleHash ===
        evidence?.audit?.lifecycleHash &&
      evidence?.forensicsIndex?.evidenceBundleHash === evidence?.bundleHash;

    const governanceCorrelationPass =
      summaryEvidence?.schemaVersion === 1 &&
      summaryEvidence?.bundleHash === evidence?.bundleHash &&
      summaryEvidence?.lifecycleHash === evidence?.audit?.lifecycleHash;

    const passed = Boolean(
      signedEvidencePass && forensicsChainPass && governanceCorrelationPass,
    );

    return {
      status: passed ? "pass" : "fail",
      details: passed
        ? "signed evidence and forensics chain correlation validated"
        : "invalid signed evidence or forensics chain correlation",
      report: {
        signedEvidencePass,
        forensicsChainPass,
        governanceCorrelationPass,
      },
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const testsResult = await runCommand(
    "pnpm",
    [
      "--filter",
      "@xlameiro/env-typegen",
      "test",
      "--",
      "tests/reporting/evidence-bundle.test.ts",
      "tests/reporting/evidence-signature.test.ts",
      "tests/reporting/forensics-index.test.ts",
      "tests/commands/sync-apply-command.test.ts",
      "tests/trust/crypto-verifier.test.ts",
      "tests/trust/policy-pack-signature.test.ts",
      "tests/ops/slo-policy.test.ts",
      "tests/chaos/governance-chaos.test.ts",
    ],
    repositoryRoot,
  );

  const probe = await runForensicsProbe();

  const steps = [
    {
      step: "forensics-trust-slo-chaos-tests",
      status: testsResult.exitCode === 0 ? "pass" : "fail",
      exitCode: testsResult.exitCode,
      details:
        testsResult.exitCode === 0
          ? "forensics, trust, slo, and chaos suites passed"
          : `exitCode=${testsResult.exitCode}; stderr=${testsResult.stderr.trim()}`,
    },
    {
      step: "sync-apply-forensics-probe",
      status: probe.status,
      details: probe.details,
      ...(probe.report === undefined ? {} : { report: probe.report }),
    },
  ];

  const failed = steps.filter((step) => step.status === "fail").length;
  const passed = steps.length - failed;

  const probeReport = probe.report ?? {
    signedEvidencePass: false,
    forensicsChainPass: false,
    governanceCorrelationPass: false,
  };

  await mkdir(reportsDirectory, { recursive: true });
  await writeFile(
    reportFilePath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: steps.length,
        passed,
        failed,
        signedEvidence:
          steps[0]?.status === "pass" &&
          probeReport.signedEvidencePass === true,
        forensicsChainIntegrity:
          probeReport.forensicsChainPass === true &&
          probeReport.governanceCorrelationPass === true,
        trustAndSloCoverage: steps[0]?.status === "pass",
        chaosCoverage: steps[0]?.status === "pass",
        results: steps,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (failed > 0) {
    console.error(`GOVERNANCE_FORENSICS_SMOKE_FAILED:${failed}`);
    process.exit(1);
  }

  console.log(`GOVERNANCE_FORENSICS_SMOKE_OK:${passed}/${steps.length}`);
}

await main();
