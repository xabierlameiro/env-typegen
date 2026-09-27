import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { claimConfirmationNonce } from "../../src/sync/confirmation-nonce-store.js";

describe("confirmation nonce store", () => {
  let storePath: string;

  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "env-typegen-nonce-store-"));
    storePath = path.join(dir, "nested", "confirmation-nonces");
  });

  afterEach(async () => {
    await rm(path.dirname(path.dirname(storePath)), { recursive: true, force: true });
  });

  it("should claim a nonce once and reject the second claim", async () => {
    const claimParams = {
      storePath,
      nonce: "nonce-1",
      expiresAt: "2026-03-18T10:05:00.000Z",
      now: new Date("2026-03-18T10:00:00.000Z"),
    };

    const firstClaim = await claimConfirmationNonce(claimParams);
    const secondClaim = await claimConfirmationNonce(claimParams);

    expect(firstClaim).toEqual({ isClaimed: true });
    expect(secondClaim.isClaimed).toBe(false);
    expect(secondClaim).toMatchObject({ reason: expect.stringContaining("replay") });
  });

  it("should let only one of several concurrent claims succeed", async () => {
    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        claimConfirmationNonce({
          storePath,
          nonce: "nonce-concurrent",
          expiresAt: "2026-03-18T10:05:00.000Z",
          now: new Date("2026-03-18T10:00:00.000Z"),
        }),
      ),
    );

    expect(claims.filter((claim) => claim.isClaimed)).toHaveLength(1);
  });

  it("should not store the nonce itself on disk", async () => {
    await claimConfirmationNonce({
      storePath,
      nonce: "../escape-attempt",
      expiresAt: "2026-03-18T10:05:00.000Z",
      now: new Date("2026-03-18T10:00:00.000Z"),
    });

    const entries = await readdir(storePath);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^[a-f0-9]{64}\.json$/u);
  });

  it("should prune expired records and keep unreadable ones", async () => {
    await claimConfirmationNonce({
      storePath,
      nonce: "nonce-expired",
      expiresAt: "2026-03-18T10:01:00.000Z",
      now: new Date("2026-03-18T10:00:00.000Z"),
    });
    await writeFile(path.join(storePath, "corrupt.json"), "{not-json", "utf8");
    await writeFile(path.join(storePath, "no-expiry.json"), JSON.stringify({}), "utf8");
    await writeFile(
      path.join(storePath, "bad-type.json"),
      JSON.stringify({ expiresAt: 1 }),
      "utf8",
    );
    await writeFile(
      path.join(storePath, "bad-date.json"),
      JSON.stringify({ expiresAt: "never" }),
      "utf8",
    );

    await claimConfirmationNonce({
      storePath,
      nonce: "nonce-fresh",
      expiresAt: "2026-03-18T10:15:00.000Z",
      now: new Date("2026-03-18T10:10:00.000Z"),
    });

    const entries = await readdir(storePath);
    expect(entries).toHaveLength(5);
    expect(entries).toEqual(
      expect.arrayContaining(["corrupt.json", "no-expiry.json", "bad-type.json", "bad-date.json"]),
    );
  });

  it("should throw when the store path cannot be used as a directory", async () => {
    const filePath = path.join(path.dirname(path.dirname(storePath)), "not-a-directory");
    await writeFile(filePath, "", "utf8");

    await expect(
      claimConfirmationNonce({
        storePath: filePath,
        nonce: "nonce-1",
        expiresAt: "2026-03-18T10:05:00.000Z",
      }),
    ).rejects.toThrow();
  });
});
