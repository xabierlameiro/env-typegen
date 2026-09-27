import { loadAdapter } from "../adapters/loader.js";
import type { EnvMap } from "../adapters/types.js";
import type { EnvTypegenConfig } from "../config.js";
import { loadEnvSource } from "../validation/env-source.js";
import { buildChangeSetFromMaps, calculateChangeSetHash } from "./change-set.js";

export type SyncApplyChangeSetResolution = {
  adapter: Awaited<ReturnType<typeof loadAdapter>>;
  providerConfig: NonNullable<EnvTypegenConfig["providers"]>[string];
  localValues: EnvMap;
  remoteValues: EnvMap;
  changeSet: ReturnType<typeof buildChangeSetFromMaps>;
  changeSetHash: string;
};

// A confirmation token is bound to the change-set hash. `confirmation-token` and
// `sync-apply` resolve it here so both always hash the same inputs.
export async function resolveSyncApplyChangeSet(params: {
  config: EnvTypegenConfig | undefined;
  providerName: string;
  environment: string;
  envFile: string;
}): Promise<SyncApplyChangeSetResolution> {
  const providerConfig = params.config?.providers?.[params.providerName];
  if (providerConfig === undefined) {
    throw new Error(`Provider "${params.providerName}" is not configured in env-typegen config.`);
  }

  const adapter = await loadAdapter(providerConfig.adapter, { cwd: process.cwd() });
  const remote = await adapter.pull({
    environment: params.environment,
    ...(providerConfig.projectId !== undefined && { projectId: providerConfig.projectId }),
    ...(providerConfig.token !== undefined && { token: providerConfig.token }),
    ...(providerConfig.options !== undefined && { providerConfig: providerConfig.options }),
    redactValues: true,
  });

  const localValues = await loadEnvSource({ filePath: params.envFile, allowMissing: true });
  const changeSet = buildChangeSetFromMaps({ localValues, remoteValues: remote.values });

  return {
    adapter,
    providerConfig,
    localValues,
    remoteValues: remote.values,
    changeSet,
    changeSetHash: calculateChangeSetHash(changeSet),
  };
}
