import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { AuditEvent } from "./audit-event.js";
import { redactAuditEvent } from "./audit-redaction.js";

export function serializeAuditEvent(event: AuditEvent): string {
  const redacted = redactAuditEvent(event);
  const normalized: AuditEvent = {
    timestamp: redacted.timestamp,
    event: redacted.event,
    level: redacted.level,
    command: redacted.command,
    provider: redacted.provider,
    environment: redacted.environment,
    mode: redacted.mode,
    policyDecision: redacted.policyDecision,
    ...(redacted.correlationId === undefined ? {} : { correlationId: redacted.correlationId }),
    ...(redacted.changeSetHash === undefined ? {} : { changeSetHash: redacted.changeSetHash }),
    ...(redacted.evidenceBundleId === undefined
      ? {}
      : { evidenceBundleId: redacted.evidenceBundleId }),
    ...(redacted.evidenceHash === undefined ? {} : { evidenceHash: redacted.evidenceHash }),
    ...(redacted.evidenceSignatureId === undefined
      ? {}
      : { evidenceSignatureId: redacted.evidenceSignatureId }),
    ...(redacted.forensicsIndexId === undefined
      ? {}
      : { forensicsIndexId: redacted.forensicsIndexId }),
    ...(redacted.forensicsIndexHash === undefined
      ? {}
      : { forensicsIndexHash: redacted.forensicsIndexHash }),
    ...(redacted.operationStatuses === undefined
      ? {}
      : { operationStatuses: redacted.operationStatuses }),
    ...(redacted.summary === undefined ? {} : { summary: redacted.summary }),
    ...(redacted.reasons === undefined ? {} : { reasons: redacted.reasons }),
    ...(redacted.metadata === undefined ? {} : { metadata: redacted.metadata }),
    message: redacted.message,
  };

  return JSON.stringify(normalized);
}

export async function writeAuditEvents(params: {
  events: AuditEvent[];
  filePath?: string;
}): Promise<string[]> {
  const lines = params.events.map((event) => `${serializeAuditEvent(event)}\n`);

  if (params.filePath !== undefined && lines.length > 0) {
    const resolvedPath = path.resolve(params.filePath);
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await appendFile(resolvedPath, lines.join(""), "utf8");
  }

  return lines;
}

export async function writeAuditEvent(params: {
  event: AuditEvent;
  filePath?: string;
}): Promise<string> {
  const [line = ""] = await writeAuditEvents({
    events: [params.event],
    ...(params.filePath === undefined ? {} : { filePath: params.filePath }),
  });
  return line;
}
