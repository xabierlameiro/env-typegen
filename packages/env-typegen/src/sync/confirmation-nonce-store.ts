import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CONFIRMATION_NONCE_STORE_PATH = ".env-typegen/confirmation-nonces";

type ConfirmationNonceClaim = { isClaimed: true } | { isClaimed: false; reason: string };

// The nonce is hashed so its content never reaches the filesystem as a path segment.
function buildNonceRecordPath(storePath: string, nonce: string): string {
  const nonceDigest = createHash("sha256").update(nonce, "utf8").digest("hex");
  return path.join(storePath, `${nonceDigest}.json`);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readRecordExpiry(recordPath: string): Promise<number | undefined> {
  try {
    const record: unknown = JSON.parse(await readFile(recordPath, "utf8"));
    if (typeof record !== "object" || record === null || !("expiresAt" in record)) {
      return undefined;
    }

    if (typeof record.expiresAt !== "string") {
      return undefined;
    }

    const expiresAtMs = Date.parse(record.expiresAt);
    return Number.isNaN(expiresAtMs) ? undefined : expiresAtMs;
  } catch {
    return undefined;
  }
}

// Records that cannot be read are kept: dropping them would reopen the replay window.
async function pruneExpiredNonceRecords(storePath: string, now: Date): Promise<void> {
  const entries = await readdir(storePath);
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const recordPath = path.join(storePath, entry);
        const expiresAtMs = await readRecordExpiry(recordPath);
        if (expiresAtMs !== undefined && expiresAtMs <= now.getTime()) {
          await rm(recordPath, { force: true });
        }
      }),
  );
}

/**
 * Records a confirmation token nonce as used. The record is created with an exclusive
 * write, so only the first of several concurrent processes claims a given nonce.
 * Filesystem errors other than an existing record are thrown so the apply fails closed.
 */
export async function claimConfirmationNonce(params: {
  storePath: string;
  nonce: string;
  expiresAt: string;
  now?: Date;
}): Promise<ConfirmationNonceClaim> {
  const storePath = path.resolve(params.storePath);
  await mkdir(storePath, { recursive: true });
  await pruneExpiredNonceRecords(storePath, params.now ?? new Date());

  try {
    await writeFile(
      buildNonceRecordPath(storePath, params.nonce),
      `${JSON.stringify({ expiresAt: params.expiresAt })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      return {
        isClaimed: false,
        reason: "Confirmation token replay detected: this token has already been used.",
      };
    }

    throw error;
  }

  return { isClaimed: true };
}
