## Sync Apply

`sync-apply` is the controlled write command for provider adapters.

### Modes

- `dry-run` (default): no writes, only planned operations.
- `apply`: writes enabled only when guardrails pass.

### Guardrails

- policy decision must not be `block`
- write mode must be enabled in config
- preflight artifact is required when configured
- apply mode requires a signed one-time confirmation token (nonce + ttl + context-bound signature)
- protected environments require protected branch execution
- apply mode requires `ENV_TYPEGEN_EVIDENCE_SIGNING_KEY`, so the evidence of a write is signed

The confirmation token needs `ENV_TYPEGEN_CONFIRMATION_SIGNING_KEY` (32 characters or more),
with the same value where the token is created and where `sync-apply` runs. A token is
spent when every guard allows the apply. Used tokens are recorded in
`.env-typegen/confirmation-nonces`, or in `writePolicy.confirmationNonceStorePath` when set.

The record is a local directory. On a CI runner with a clean workspace, create the token in
the job that applies it, use a short `--ttl`, run apply jobs one at a time and keep the
directory for at least the token lifetime (15 minutes at most).

Dry-run works without `ENV_TYPEGEN_EVIDENCE_SIGNING_KEY`. Its evidence is then marked
`algorithm: "none"` and `keyId: "unsigned"`, and it never verifies.

### Config example

```typescript
export default {
  writePolicy: {
    enableApply: true,
    requirePreflight: true,
    protectedEnvironments: ["production"],
    auditLogPath: "reports/env-sync-audit.jsonl",
  },
};
```

### Command examples

```bash
# dry-run
env-typegen sync-apply smoke --env-file .env --config env-typegen.config.mjs --json

# create the confirmation token with the same provider, --env, --env-file and --config
SYNC_APPLY_CONFIRMATION_TOKEN="$(env-typegen confirmation-token smoke \
  --env production \
  --env-file .env \
  --config env-typegen.config.mjs)"

# apply
env-typegen sync-apply smoke \
  --env production \
  --env-file .env \
  --config env-typegen.config.mjs \
  --apply \
  --preflight-file reports/preflight.json \
  --confirmation-token "$SYNC_APPLY_CONFIRMATION_TOKEN" \
  --protected-branch \
  --json
```

### Exit codes

- `0`: completed successfully
- `1`: blocked or failed
