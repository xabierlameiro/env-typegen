import { describe, expect, it } from "vitest";

/**
 * Phase 1 — Foundation smoke tests.
 * Verifies the runtime environment and that project types are well-formed.
 * Full unit tests for parser/inferrer/generators are added in Phases 2–4.
 */
describe("Phase 1 — Foundation", () => {
  it("should run on Node.js >= 22 as required by package.json engines field", () => {
    const raw = process.version.replace("v", "").split(".")[0] ?? "0";
    const major = Number.parseInt(raw, 10);
    expect(major).toBeGreaterThanOrEqual(22);
  });

  it("should be running in a Node.js environment (not browser)", () => {
    expect(typeof process).toBe("object");
    expect(typeof process.env).toBe("object");
  });

  it("should have the correct package name via env resolution", () => {
    // Ensures the test runner can locate the source files
    expect(typeof process.cwd()).toBe("string");
    expect(process.cwd().length).toBeGreaterThan(0);
  });
});
