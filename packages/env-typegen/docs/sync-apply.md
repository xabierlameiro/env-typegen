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
