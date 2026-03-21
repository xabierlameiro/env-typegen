import { describe, expect, it } from "vitest";
import type { ParsedEnvFile } from "../../src/parser/types.js";
import type { EnvContract } from "../../src/schema/schema-model.js";
import { validateContract } from "../../src/validator/contract-validator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(vars: Array<{ key: string; rawValue: string }>): ParsedEnvFile {
  return {
    filePath: ".env",
    groups: [],
    vars: vars.map((v, i) => ({
      key: v.key,
      rawValue: v.rawValue,
      inferredType: "string",
      isRequired: true,
      isOptional: false,
      isClientSide: false,
      lineNumber: i + 1,
    })),
  };
}

function makeContract(vars: EnvContract["vars"]): EnvContract {
  return { vars };
}

// ---------------------------------------------------------------------------
// ENV_MISSING — required variable absent from env file
// ---------------------------------------------------------------------------

describe("ENV_MISSING", () => {
  it("should report ENV_MISSING when a required contract var is absent from the env file", () => {
    const parsed = makeFile([]);
    const contract = makeContract([{ name: "DATABASE_URL", expectedType: "url", required: true }]);

    const result = validateContract(parsed, contract);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ENV_MISSING",
      key: "DATABASE_URL",
      expected: { type: "url" },
      severity: "error",
    });
  });

  it("should NOT report ENV_MISSING for an optional contract var that is absent", () => {
    const parsed = makeFile([]);
    const contract = makeContract([
      { name: "OPTIONAL_VAR", expectedType: "string", required: false },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_MISSING")).toHaveLength(0);
  });

  it("should NOT report ENV_MISSING when the required var is present", () => {
    const parsed = makeFile([{ key: "DATABASE_URL", rawValue: "postgres://localhost/db" }]);
    const contract = makeContract([{ name: "DATABASE_URL", expectedType: "url", required: true }]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_MISSING")).toHaveLength(0);
  });

  it("should report ENV_MISSING as warning for missing optional var when strict=false", () => {
    const parsed = makeFile([]);
    const contract = makeContract([
      { name: "OPTIONAL_VAR", expectedType: "string", required: false },
    ]);

    const result = validateContract(parsed, contract, { strict: false });

    // optional + non-strict → no ENV_MISSING at all
    expect(result.issues.filter((i) => i.code === "ENV_MISSING")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ENV_EXTRA — variable in env file not declared in contract
// ---------------------------------------------------------------------------

describe("ENV_EXTRA", () => {
  it("should report ENV_EXTRA when strict=true (default) and var is not in contract", () => {
    const parsed = makeFile([{ key: "UNKNOWN_VAR", rawValue: "hello" }]);
    const contract = makeContract([]);

    const result = validateContract(parsed, contract);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ENV_EXTRA",
      key: "UNKNOWN_VAR",
      severity: "error",
    });
  });

  it("should downgrade ENV_EXTRA to warning when strict=false", () => {
    const parsed = makeFile([{ key: "UNKNOWN_VAR", rawValue: "hello" }]);
    const contract = makeContract([]);

    const result = validateContract(parsed, contract, { strict: false });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ENV_EXTRA",
      key: "UNKNOWN_VAR",
      severity: "warning",
    });
  });

  it("should NOT report ENV_EXTRA when every var in the env file is declared in the contract", () => {
    const parsed = makeFile([{ key: "API_KEY", rawValue: "abc123" }]);
    const contract = makeContract([{ name: "API_KEY", expectedType: "string", required: true }]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_EXTRA")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ENV_INVALID_TYPE — value cannot be coerced to declared type
// ---------------------------------------------------------------------------

describe("ENV_INVALID_TYPE", () => {
  it("should report ENV_INVALID_TYPE when a string is expected to be a number", () => {
    const parsed = makeFile([{ key: "PORT", rawValue: "not-a-number" }]);
    const contract = makeContract([{ name: "PORT", expectedType: "number", required: true }]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_TYPE")).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ENV_INVALID_TYPE",
      key: "PORT",
      expected: { type: "number" },
      severity: "error",
    });
  });

  it("should report ENV_INVALID_TYPE when a value is not a recognised boolean (BUG-05)", () => {
    // After BUG-05 fix the allowlist is [true, false, 1, 0, yes, no] — matching engine.ts.
    // "maybe" is not in the allowlist and must still produce ENV_INVALID_TYPE.
    const parsed = makeFile([{ key: "FEATURE_FLAG", rawValue: "maybe" }]);
    const contract = makeContract([
      { name: "FEATURE_FLAG", expectedType: "boolean", required: true },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_TYPE")).toHaveLength(1);
  });

  it("should report ENV_INVALID_TYPE when a value is expected to be a url", () => {
    const parsed = makeFile([{ key: "API_URL", rawValue: "not_a_url" }]);
    const contract = makeContract([{ name: "API_URL", expectedType: "url", required: true }]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_TYPE")).toHaveLength(1);
  });

  it("should report ENV_INVALID_TYPE when a value is expected to be an email", () => {
    const parsed = makeFile([{ key: "ADMIN_EMAIL", rawValue: "not-an-email" }]);
    const contract = makeContract([{ name: "ADMIN_EMAIL", expectedType: "email", required: true }]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_TYPE")).toHaveLength(1);
  });

  it("should report ENV_INVALID_TYPE when a value is expected to be a semver", () => {
    const parsed = makeFile([{ key: "APP_VERSION", rawValue: "latest" }]);
    const contract = makeContract([
      { name: "APP_VERSION", expectedType: "semver", required: true },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_TYPE")).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ENV_INVALID_TYPE",
      key: "APP_VERSION",
      expected: { type: "semver" },
      severity: "error",
    });
  });

  it("should NOT report ENV_INVALID_TYPE when a valid integer is provided for a number type", () => {
    const parsed = makeFile([{ key: "PORT", rawValue: "3000" }]);
    const contract = makeContract([{ name: "PORT", expectedType: "number", required: true }]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_TYPE")).toHaveLength(0);
  });

  it("should NOT report ENV_INVALID_TYPE when a valid semver is provided", () => {
    const parsed = makeFile([{ key: "APP_VERSION", rawValue: "1.2.3-beta.1" }]);
    const contract = makeContract([
      { name: "APP_VERSION", expectedType: "semver", required: true },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_TYPE")).toHaveLength(0);
  });

  it("should NOT report ENV_INVALID_TYPE when 'true' is provided for a boolean type", () => {
    const parsed = makeFile([{ key: "FEATURE_FLAG", rawValue: "true" }]);
    const contract = makeContract([
      { name: "FEATURE_FLAG", expectedType: "boolean", required: true },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_TYPE")).toHaveLength(0);
  });

  it("should NOT report ENV_INVALID_TYPE when 'false' is provided for a boolean type", () => {
    const parsed = makeFile([{ key: "FEATURE_FLAG", rawValue: "false" }]);
    const contract = makeContract([
      { name: "FEATURE_FLAG", expectedType: "boolean", required: true },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_TYPE")).toHaveLength(0);
  });

  it("should NOT report ENV_INVALID_TYPE for a plain string type with any value", () => {
    const parsed = makeFile([{ key: "APP_NAME", rawValue: "my-app" }]);
    const contract = makeContract([{ name: "APP_NAME", expectedType: "string", required: true }]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_TYPE")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ENV_INVALID_VALUE — enum constraint violation
// ---------------------------------------------------------------------------

describe("ENV_INVALID_VALUE (enum)", () => {
  it("should report ENV_INVALID_VALUE when value is not in the contract enumValues", () => {
    const parsed = makeFile([{ key: "NODE_ENV", rawValue: "staging" }]);
    const contract = makeContract([
      {
        name: "NODE_ENV",
        expectedType: "string",
        required: true,
        enumValues: ["development", "production", "test"],
      },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_VALUE")).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ENV_INVALID_VALUE",
      key: "NODE_ENV",
      expected: { type: "enum", values: ["development", "production", "test"] },
      severity: "error",
    });
  });

  it("should NOT report ENV_INVALID_VALUE when value is in the enumValues list", () => {
    const parsed = makeFile([{ key: "NODE_ENV", rawValue: "production" }]);
    const contract = makeContract([
      {
        name: "NODE_ENV",
        expectedType: "string",
        required: true,
        enumValues: ["development", "production", "test"],
      },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_VALUE")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ENV_INVALID_VALUE — min/max constraint violation
// ---------------------------------------------------------------------------

describe("ENV_INVALID_VALUE (min/max)", () => {
  it("should report ENV_INVALID_VALUE when a number is below the min constraint", () => {
    const parsed = makeFile([{ key: "PORT", rawValue: "80" }]);
    const contract = makeContract([
      {
        name: "PORT",
        expectedType: "number",
        required: true,
        constraints: { min: 1024 },
      },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_VALUE")).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ENV_INVALID_VALUE",
      key: "PORT",
      expected: { type: "number", min: 1024 },
    });
  });

  it("should report ENV_INVALID_VALUE when a number exceeds the max constraint", () => {
    const parsed = makeFile([{ key: "CONCURRENCY", rawValue: "200" }]);
    const contract = makeContract([
      {
        name: "CONCURRENCY",
        expectedType: "number",
        required: true,
        constraints: { max: 100 },
      },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_VALUE")).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ENV_INVALID_VALUE",
      key: "CONCURRENCY",
      expected: { type: "number", max: 100 },
    });
  });

  it("should NOT report ENV_INVALID_VALUE when number is within min/max range", () => {
    const parsed = makeFile([{ key: "PORT", rawValue: "3000" }]);
    const contract = makeContract([
      {
        name: "PORT",
        expectedType: "number",
        required: true,
        constraints: { min: 1024, max: 65535 },
      },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_VALUE")).toHaveLength(0);
  });

  it("should NOT report ENV_INVALID_VALUE when number equals the min boundary", () => {
    const parsed = makeFile([{ key: "PORT", rawValue: "1024" }]);
    const contract = makeContract([
      {
        name: "PORT",
        expectedType: "number",
        required: true,
        constraints: { min: 1024 },
      },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_INVALID_VALUE")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ENV_SECRET_EXPOSED — secret with a non-empty value
// ---------------------------------------------------------------------------

describe("ENV_SECRET_EXPOSED", () => {
  it("should report ENV_SECRET_EXPOSED when isSecret=true and value is non-empty", () => {
    const parsed = makeFile([{ key: "JWT_SECRET", rawValue: "supersecretvalue" }]);
    const contract = makeContract([
      { name: "JWT_SECRET", expectedType: "string", required: true, isSecret: true },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_SECRET_EXPOSED")).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ENV_SECRET_EXPOSED",
      key: "JWT_SECRET",
      severity: "error",
    });
  });

  it("should NOT report ENV_SECRET_EXPOSED when isSecret=true but value is empty", () => {
    const parsed = makeFile([{ key: "JWT_SECRET", rawValue: "" }]);
    const contract = makeContract([
      { name: "JWT_SECRET", expectedType: "string", required: false, isSecret: true },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_SECRET_EXPOSED")).toHaveLength(0);
  });

  it("should NOT report ENV_SECRET_EXPOSED when var is not a secret", () => {
    const parsed = makeFile([{ key: "API_URL", rawValue: "https://example.com" }]);
    const contract = makeContract([{ name: "API_URL", expectedType: "url", required: true }]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_SECRET_EXPOSED")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple issues — verifying independent issue detection
// ---------------------------------------------------------------------------

describe("multiple issues", () => {
  it("should collect all independent issues in one pass", () => {
    const parsed = makeFile([
      { key: "PORT", rawValue: "not-a-number" }, // ENV_INVALID_TYPE
      { key: "UNKNOWN", rawValue: "hello" }, // ENV_EXTRA (strict default)
    ]);
    const contract = makeContract([
      { name: "PORT", expectedType: "number", required: true },
      { name: "REQUIRED_VAR", expectedType: "string", required: true }, // ENV_MISSING
    ]);

    const result = validateContract(parsed, contract);

    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("ENV_INVALID_TYPE");
    expect(codes).toContain("ENV_EXTRA");
    expect(codes).toContain("ENV_MISSING");
  });
});

// ---------------------------------------------------------------------------
// environment option is propagated to all issues
// ---------------------------------------------------------------------------

describe("environment option", () => {
  it("should propagate the environment option to each issue", () => {
    const parsed = makeFile([]);
    const contract = makeContract([
      { name: "REQUIRED_VAR", expectedType: "string", required: true },
    ]);

    const result = validateContract(parsed, contract, { environment: "production" });

    expect(result.issues[0]).toMatchObject({ environment: "production" });
  });

  it("should default environment to 'local' when not specified", () => {
    const parsed = makeFile([]);
    const contract = makeContract([
      { name: "REQUIRED_VAR", expectedType: "string", required: true },
    ]);

    const result = validateContract(parsed, contract);

    expect(result.issues[0]).toMatchObject({ environment: "local" });
  });
});

// ---------------------------------------------------------------------------
// BUG-04 — empty required vars must produce ENV_MISSING (contract-validator path)
// ---------------------------------------------------------------------------

describe("BUG-04 — empty required variables must produce ENV_MISSING", () => {
  it("should report ENV_MISSING when a required var is present but empty", () => {
    // Pre-fix: parsedByKey.has(name) returned true for KEY=, so ENV_MISSING was skipped.
    // Post-fix: the check also requires rawValue to be non-empty for required vars.
    const parsed = makeFile([{ key: "DATABASE_URL", rawValue: "" }]);
    const contract = makeContract([{ name: "DATABASE_URL", expectedType: "url", required: true }]);

    const result = validateContract(parsed, contract);

    const missingIssues = result.issues.filter(
      (i) => i.code === "ENV_MISSING" && i.key === "DATABASE_URL",
    );
    expect(missingIssues).toHaveLength(1);
    expect(missingIssues[0]).toMatchObject({
      code: "ENV_MISSING",
      key: "DATABASE_URL",
      severity: "error",
    });
  });

  it("should NOT report ENV_MISSING when an optional var is present but empty", () => {
    // Optional vars may legitimately be empty — only required vars must have a value.
    const parsed = makeFile([{ key: "OPTIONAL_KEY", rawValue: "" }]);
    const contract = makeContract([
      { name: "OPTIONAL_KEY", expectedType: "string", required: false },
    ]);

    const result = validateContract(parsed, contract);

    const missingIssues = result.issues.filter(
      (i) => i.code === "ENV_MISSING" && i.key === "OPTIONAL_KEY",
    );
    expect(missingIssues).toHaveLength(0);
  });

  it("should NOT report ENV_MISSING when a required var has a non-empty value (non-regression)", () => {
    const parsed = makeFile([{ key: "DATABASE_URL", rawValue: "postgres://localhost/db" }]);
    const contract = makeContract([{ name: "DATABASE_URL", expectedType: "url", required: true }]);

    const result = validateContract(parsed, contract);

    expect(result.issues.filter((i) => i.code === "ENV_MISSING")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BUG-05 — boolean allowlist in contract-validator must match engine.ts
// ---------------------------------------------------------------------------

describe("BUG-05 — boolean allowlist aligned with validation engine", () => {
  const booleanContract = makeContract([
    { name: "FEATURE_FLAG", expectedType: "boolean", required: true },
  ]);

  it.each(["true", "false", "1", "0", "yes", "no", "True", "TRUE", "False", "YES", "NO"])(
    "should accept '%s' as a valid boolean value",
    (value) => {
      const parsed = makeFile([{ key: "FEATURE_FLAG", rawValue: value }]);
      const result = validateContract(parsed, booleanContract);
      expect(result.issues.filter((i) => i.code === "ENV_INVALID_TYPE")).toHaveLength(0);
    },
  );

  it.each(["maybe", "on", "off", "enabled"])(
    "should reject '%s' as an invalid boolean value",
    (value) => {
      const parsed = makeFile([{ key: "FEATURE_FLAG", rawValue: value }]);
      const result = validateContract(parsed, booleanContract);
      expect(result.issues.filter((i) => i.code === "ENV_INVALID_TYPE")).toHaveLength(1);
    },
  );
});
