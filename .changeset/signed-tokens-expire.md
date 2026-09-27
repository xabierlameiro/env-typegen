---
"@xlameiro/env-typegen": minor
---

`sync-apply --apply` now requires a signed confirmation token instead of a free-form string.

- The token is an HMAC-SHA256 signed value bound to the provider, the environment and the change-set hash, with an expiry of 15 minutes at most.
- `ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY` is required wherever a token is created or validated. It must be at least 32 characters long.
- A token is single use. Used tokens are recorded in `.env-typegen/confirmation-nonces`, or in the directory set with `writePolicy.confirmationNonceStorePath`.
- New exports: `createApplyConfirmationToken`, `validateApplyConfirmationToken` and `buildSyncApplyCorrelationId`.
- New command: `env-typegen confirmation-token <provider>` creates the token for the current change set. It takes the same `--env`, `--env-file` and `--config` as `sync-apply`, plus `--ttl` and `--json`.
- Evidence signatures are compared in constant time.

Evidence is no longer signed with a key generated at runtime.

- `sync-apply --apply` now requires `ENV_TYPEGEN_EVIDENCE_SIGNING_KEY`. Without it the apply is blocked before any write, and the confirmation token is not spent.
- Outside production, evidence produced without the key is marked `algorithm: "none"` and `keyId: "unsigned"`, with an empty signature. Production still fails without the key.
- `verifyEvidenceSignature` returns `false` for unsigned evidence and when the verifier has no key.
- The `algorithm` field of an evidence signature is now `"hmac-sha256" | "none"`.
