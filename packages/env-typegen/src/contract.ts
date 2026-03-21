import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseEnvFile } from "./parser/env-parser.js";
import type { EnvVarType } from "./parser/types.js";
import type { EnvContractEntry, EnvContract as LegacyEnvContract } from "./schema/schema-model.js";
import type { EnvContract, EnvContractVariable, Expected } from "./validation/types.js";

type LoadValidationContractOptions = {
  fallbackExamplePath: string;
  contractPath?: string;
  cwd?: string;
};

type ContractModule = {
  default?: unknown;
  contract?: unknown;
};

const SECRET_KEY_RE = /(SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|ACCESS_KEY|CLIENT_SECRET)/i;
// BUG-01: search .mjs / .js before .ts — TypeScript files cannot be dynamically
// imported by Node.js at runtime without a loader (tsx / ts-node).
const CONTRACT_FILE_NAMES = ["env.contract.mjs", "env.contract.js", "env.contract.ts"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpected(value: unknown): value is Expected {
  if (!isRecord(value)) return false;
  const typeValue = value.type;
  if (typeof typeValue !== "string") return false;
  const validTypes = new Set([
    "string",
    "number",
    "boolean",
    "enum",
    "url",
    "email",
    "json",
    "semver",
    "unknown",
  ]);
  if (!validTypes.has(typeValue)) return false;
  if (typeValue === "enum") {
    return Array.isArray(value.values) && value.values.every((item) => typeof item === "string");
  }
  return true;
}

function isEnvContractVariable(value: unknown): value is EnvContractVariable {
  if (!isRecord(value)) return false;
  if (!isExpected(value.expected)) return false;
  if (typeof value.required !== "boolean") return false;
  if (typeof value.clientSide !== "boolean") return false;
  if (value.description !== undefined && typeof value.description !== "string") return false;
  if (value.secret !== undefined && typeof value.secret !== "boolean") return false;
  return true;
}

function isEnvContract(value: unknown): value is EnvContract {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (!isRecord(value.variables)) return false;
  return Object.values(value.variables).every((item) => isEnvContractVariable(item));
}

function isLegacyContract(value: unknown): value is LegacyEnvContract {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.vars)) return false;
  return value.vars.every((entry) => isRecord(entry) && typeof entry.name === "string");
}

function mapEnvVarTypeToExpected(type: EnvVarType): Expected {
  if (type === "number") return { type: "number" };
  if (type === "boolean") return { type: "boolean" };
  if (type === "url") return { type: "url" };
  if (type === "email") return { type: "email" };
  if (type === "json") return { type: "json" };
  if (type === "semver") return { type: "semver" };
  if (type === "unknown") return { type: "unknown" };
  return { type: "string" };
}

function shouldTreatAsSecret(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

function toExpectedFromLegacyEntry(entry: EnvContractEntry): Expected {
  if (entry.enumValues !== undefined && entry.enumValues.length > 0) {
    return { type: "enum", values: entry.enumValues };
  }
  if (entry.expectedType === "number") {
    return {
      type: "number",
      ...(entry.constraints?.min !== undefined && { min: entry.constraints.min }),
      ...(entry.constraints?.max !== undefined && { max: entry.constraints.max }),
    };
  }
  if (entry.expectedType === "boolean") return { type: "boolean" };
  if (entry.expectedType === "url") return { type: "url" };
  if (entry.expectedType === "email") return { type: "email" };
  if (entry.expectedType === "json") return { type: "json" };
  if (entry.expectedType === "semver") return { type: "semver" };
  if (entry.expectedType === "unknown") return { type: "unknown" };
  return { type: "string" };
}

function convertLegacyContract(contract: LegacyEnvContract): EnvContract {
  const variables: Record<string, EnvContractVariable> = {};
  for (const entry of contract.vars) {
    const clientSide = entry.runtime === "client" || entry.name.startsWith("NEXT_PUBLIC_");
    variables[entry.name] = {
      expected: toExpectedFromLegacyEntry(entry),
      required: entry.required,
      clientSide,
      ...(entry.description !== undefined && { description: entry.description }),
      ...((entry.isSecret ?? shouldTreatAsSecret(entry.name)) && { secret: true }),
    };
  }
  return {
    schemaVersion: 1,
    variables,
  };
}

function buildContractFromExample(examplePath: string): EnvContract {
  const parsed = parseEnvFile(examplePath);
  const variables: Record<string, EnvContractVariable> = {};

  for (const variable of parsed.vars) {
    const effectiveType = variable.annotatedType ?? variable.inferredType;
    variables[variable.key] = {
      expected: mapEnvVarTypeToExpected(effectiveType),
      required: variable.isRequired,
      clientSide: variable.isClientSide,
      ...(variable.description !== undefined && { description: variable.description }),
      ...(shouldTreatAsSecret(variable.key) && { secret: true }),
    };
  }

  return {
    schemaVersion: 1,
    variables,
  };
}

function findDefaultContractPath(cwd: string): string | undefined {
  for (const fileName of CONTRACT_FILE_NAMES) {
    const candidatePath = path.resolve(cwd, fileName);
    if (existsSync(candidatePath)) return candidatePath;
  }
  return undefined;
}

export async function loadValidationContract(
  options: LoadValidationContractOptions,
): Promise<EnvContract> {
  const { fallbackExamplePath, contractPath, cwd = process.cwd() } = options;
  const discoveredContractPath = findDefaultContractPath(cwd);
  const resolvedContractPath =
    contractPath === undefined ? discoveredContractPath : path.resolve(cwd, contractPath);

  if (resolvedContractPath !== undefined && existsSync(resolvedContractPath)) {
    // BUG-01: .ts files cannot be dynamically imported by Node.js without a loader.
    // Detect early and emit an actionable message pointing to the .mjs alternative.
    if (resolvedContractPath.endsWith(".ts")) {
      throw new Error(
        `Contract file ${resolvedContractPath} is a TypeScript file and cannot be loaded at runtime by Node.js.\n` +
          `Rename it to ${resolvedContractPath.replace(/\.ts$/, ".mjs")} and use ESM syntax (export default ...), ` +
          `or run via \`tsx\` / \`ts-node\` as a loader.`,
      );
    }
    const moduleUrl = pathToFileURL(resolvedContractPath).href;
    const moduleValue = (await import(moduleUrl)) as ContractModule;
    const candidate = moduleValue.default ?? moduleValue.contract;
    if (isEnvContract(candidate)) {
      return candidate;
    }
    if (isLegacyContract(candidate)) {
      return convertLegacyContract(candidate);
    }
    throw new Error(
      `Invalid contract at ${resolvedContractPath}. Export default must match EnvContract.`,
    );
  }

  return buildContractFromExample(path.resolve(cwd, fallbackExamplePath));
}
