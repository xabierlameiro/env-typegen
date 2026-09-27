import { parseArgs } from "node:util";

import {
  APPLY_CONFIRMATION_DEFAULT_TTL_SECONDS,
  APPLY_CONFIRMATION_MAX_TTL_SECONDS,
  buildSyncApplyCorrelationId,
  createApplyConfirmationToken,
} from "../sync/apply-confirmation-token.js";
import { resolveSyncApplyChangeSet } from "../sync/sync-apply-change-set.js";
import { loadSyncApplyConfig } from "./sync-apply-command.js";

type ConfirmationTokenArgValues = {
  provider?: string;
  env?: string;
  "env-file"?: string;
  config?: string;
  ttl?: string;
  json?: boolean;
  help?: boolean;
};

const CONFIRMATION_TOKEN_HELP_TEXT = [
  "Usage: env-typegen confirmation-token <provider> [options]",
  "",
  "Creates the signed one-time token that `sync-apply --apply` requires.",
  "The signing key is read from ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY.",
  "Use the same provider, --env, --env-file and --config as the apply run.",
  "",
  "Options:",
  "  --provider <name>    Provider name (fallback if positional omitted)",
  "  --env <name>         Logical environment (default: development)",
  "  --env-file <path>    Local env file to sync (default: .env)",
  `  --ttl <seconds>      Token lifetime, 1 to ${APPLY_CONFIRMATION_MAX_TTL_SECONDS} (default: ${APPLY_CONFIRMATION_DEFAULT_TTL_SECONDS})`,
  "  -c, --config <path>  Config file path",
  "  --json               Emit the token with its binding as JSON",
  "  -h, --help           Show this help",
  "",
  "Exit codes:",
  "  0  Token created",
  "  1  Missing signing key, invalid option or provider failure",
].join("\n");

function resolveProviderName(values: ConfirmationTokenArgValues, positionals: string[]): string {
  const providerName = values.provider ?? positionals[0];
  if (providerName === undefined || providerName.trim().length === 0) {
    throw new Error("Provider is required. Use `env-typegen confirmation-token <provider>`.");
  }
  return providerName;
}

function resolveTtlSeconds(values: ConfirmationTokenArgValues): number {
  if (values.ttl === undefined) {
    return APPLY_CONFIRMATION_DEFAULT_TTL_SECONDS;
  }

  // `Number()` also accepts "0x10", "1e2" and padded values. Only plain digits are valid.
  const ttlSeconds = /^\d+$/u.test(values.ttl) ? Number(values.ttl) : Number.NaN;
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > APPLY_CONFIRMATION_MAX_TTL_SECONDS
  ) {
    throw new Error(
      `Invalid --ttl. Expected an integer between 1 and ${APPLY_CONFIRMATION_MAX_TTL_SECONDS} seconds.`,
    );
  }

  return ttlSeconds;
}

async function createConfirmationToken(
  values: ConfirmationTokenArgValues,
  positionals: string[],
): Promise<number> {
  const providerName = resolveProviderName(values, positionals);
  const environment = values.env ?? "development";
  const ttlSeconds = resolveTtlSeconds(values);

  const config = await loadSyncApplyConfig(values.config);
  const { changeSetHash } = await resolveSyncApplyChangeSet({
    config,
    providerName,
    environment,
    envFile: values["env-file"] ?? ".env",
  });
  const correlationId = buildSyncApplyCorrelationId({
    provider: providerName,
    environment,
    mode: "apply",
    changeSetHash,
  });

  const issuedAt = new Date();
  const token = createApplyConfirmationToken({
    provider: providerName,
    environment,
    changeSetHash,
    correlationId,
    ttlSeconds,
    now: issuedAt,
  });

  if (values.json !== true) {
    process.stdout.write(`${token}\n`);
    return 0;
  }

  process.stdout.write(
    `${JSON.stringify({
      command: "confirmation-token",
      provider: providerName,
      environment,
      changeSetHash,
      correlationId,
      expiresAt: new Date(issuedAt.getTime() + ttlSeconds * 1000).toISOString(),
      token,
    })}\n`,
  );
  return 0;
}

export async function runConfirmationTokenCommand(argv: string[]): Promise<number> {
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        provider: { type: "string" },
        env: { type: "string" },
        "env-file": { type: "string" },
        config: { type: "string", short: "c" },
        ttl: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      } as const,
      allowPositionals: true,
    });

    const values = parsed.values as ConfirmationTokenArgValues;
    if (values.help === true) {
      console.log(CONFIRMATION_TOKEN_HELP_TEXT);
      return 0;
    }

    return await createConfirmationToken(values, parsed.positionals);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`env-typegen confirmation-token: ${message}\n`);
    return 1;
  }
}
