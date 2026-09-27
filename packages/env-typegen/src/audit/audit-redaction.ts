import type { AuditEvent } from "./audit-event.js";

const REDACTION_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\b(token|secret|api[_-]?key|password)=([^\s]+)/giu,
    replacement: "$1=[REDACTED]",
  },
  {
    pattern: /\bauthorization:\s*bearer\s+[^\s]+/giu,
    replacement: "authorization: bearer [REDACTED]",
  },
];

export function redactSensitiveText(input: string): string {
  return REDACTION_PATTERNS.reduce(
    (accumulator, rule) => accumulator.replaceAll(rule.pattern, rule.replacement),
    input,
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function redactUnknownValue(value: string): string;
function redactUnknownValue(value: readonly unknown[]): unknown[];
function redactUnknownValue(value: Record<string, unknown>): Record<string, unknown>;
function redactUnknownValue(value: unknown): unknown;
function redactUnknownValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknownValue(entry));
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, redactUnknownValue(nestedValue)]),
    );
  }

  return value;
}

export function redactAuditEvent(event: AuditEvent): AuditEvent {
  return {
    ...event,
    ...(event.reasons === undefined
      ? {}
      : { reasons: event.reasons.map((reason) => redactSensitiveText(reason)) }),
    ...(event.metadata === undefined ? {} : { metadata: redactUnknownValue(event.metadata) }),
    message: redactSensitiveText(event.message),
  };
}
