import { assTimeToSeconds } from "./ass-parser";

export interface AssEventRecord {
  lineIndex: number;
  eventType: string;
  formatFields: string[];
  fields: string[];
  orderIndex: number;
  startTime: number;
  endTime: number;
  identityKey: string;
  text: string;
  rawLine: string;
}

export interface AssSectionRecord {
  name: string;
  headerLineIndex: number;
  startLineIndex: number;
  endLineIndex: number;
  isAegisubSection: boolean;
}

export interface AssDocument {
  content: string;
  newline: string;
  lines: string[];
  sections: AssSectionRecord[];
  aegisubSections: AssSectionRecord[];
  events: AssEventRecord[];
}

export interface AssPatchConflict {
  type: "text_conflict" | "structure_conflict" | "missing_event";
  eventKey: string;
  startTime: number;
  endTime: number;
  baseText: string;
  currentText: string;
  theirsText: string;
  message: string;
}

function detectNewline(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function normalizedField(field: string): string {
  return field.trim().toLowerCase();
}

function fieldIndex(fields: string[], name: string): number {
  return fields.findIndex((field) => normalizedField(field) === name.toLowerCase());
}

function splitEventFields(body: string, fieldCount: number): string[] {
  if (fieldCount <= 1) return [body];

  const result: string[] = [];
  let start = 0;
  for (let i = 0; i < fieldCount - 1; i++) {
    const comma = body.indexOf(",", start);
    if (comma === -1) {
      result.push(body.slice(start));
      start = body.length;
      break;
    }
    result.push(body.slice(start, comma));
    start = comma + 1;
  }
  result.push(body.slice(start));

  while (result.length < fieldCount) {
    result.push("");
  }

  return result;
}

function buildIdentityKey(
  formatFields: string[],
  fields: string[],
  eventType: string,
  occurrence: number
): string {
  const start = fields[fieldIndex(formatFields, "start")]?.trim() ?? "";
  const end = fields[fieldIndex(formatFields, "end")]?.trim() ?? "";
  const layer = fields[fieldIndex(formatFields, "layer")]?.trim() ?? "";
  const style = fields[fieldIndex(formatFields, "style")]?.trim() ?? "";
  const name = fields[fieldIndex(formatFields, "name")]?.trim() ?? "";
  const effect = fields[fieldIndex(formatFields, "effect")]?.trim() ?? "";
  return [eventType, start, end, layer, style, name, effect, occurrence].join("|");
}

function structureSignature(event: AssEventRecord): string {
  const textIdx = fieldIndex(event.formatFields, "text");
  return JSON.stringify({
    eventType: event.eventType,
    formatFields: event.formatFields.map((field) => normalizedField(field)),
    fields: event.fields.map((field, index) => index === textIdx ? "<text>" : field.trim()),
  });
}

function isEventLine(line: string): boolean {
  return /^Dialogue\s*:/i.test(line) || /^Comment\s*:/i.test(line);
}

export function parseAssDocument(content: string): AssDocument {
  const newline = detectNewline(content);
  const lines = content.split(/\r?\n/);
  const events: AssEventRecord[] = [];
  const sections: AssSectionRecord[] = [];
  const occurrence = new Map<string, number>();

  let inEvents = false;
  let formatFields: string[] = [];
  let currentSectionIndex: number | null = null;

  lines.forEach((rawLine, lineIndex) => {
    const trimmed = rawLine.trim();
    const sectionMatch = trimmed.match(/^\[(.+)]$/);
    if (sectionMatch) {
      if (currentSectionIndex !== null) {
        sections[currentSectionIndex].endLineIndex = lineIndex - 1;
      }
      const name = sectionMatch[1].trim();
      sections.push({
        name,
        headerLineIndex: lineIndex,
        startLineIndex: lineIndex + 1,
        endLineIndex: lines.length - 1,
        isAegisubSection: /^aegisub\s+/i.test(name),
      });
      currentSectionIndex = sections.length - 1;
      inEvents = /^events$/i.test(name);
      return;
    }
    if (!inEvents) return;

    const formatMatch = rawLine.match(/^Format\s*:\s*(.*)$/i);
    if (formatMatch) {
      formatFields = formatMatch[1].split(",").map((field) => field.trim());
      return;
    }

    if (!formatFields.length || !isEventLine(rawLine)) return;

    const colon = rawLine.indexOf(":");
    const eventType = rawLine.slice(0, colon).trim();
    const body = rawLine.slice(colon + 1).trimStart();
    const fields = splitEventFields(body, formatFields.length);
    const startIdx = fieldIndex(formatFields, "start");
    const endIdx = fieldIndex(formatFields, "end");
    const textIdx = fieldIndex(formatFields, "text");
    if (startIdx === -1 || endIdx === -1 || textIdx === -1) return;

    let startTime: number;
    let endTime: number;
    try {
      startTime = assTimeToSeconds(fields[startIdx]);
      endTime = assTimeToSeconds(fields[endIdx]);
    } catch {
      return;
    }

    const occurrenceBase = buildIdentityKey(formatFields, fields, eventType, 0);
    const nextOccurrence = occurrence.get(occurrenceBase) ?? 0;
    occurrence.set(occurrenceBase, nextOccurrence + 1);

    events.push({
      lineIndex,
      eventType,
      formatFields: [...formatFields],
      fields,
      orderIndex: events.length,
      startTime,
      endTime,
      identityKey: buildIdentityKey(formatFields, fields, eventType, nextOccurrence),
      text: fields[textIdx],
      rawLine,
    });
  });

  return {
    content,
    newline,
    lines,
    sections,
    aegisubSections: sections.filter((section) => section.isAegisubSection),
    events,
  };
}

function rewriteEventLine(event: AssEventRecord, text: string): string {
  const textIdx = fieldIndex(event.formatFields, "text");
  const fields = [...event.fields];
  fields[textIdx] = text;
  return `${event.eventType}: ${fields.join(",")}`;
}

function eventInRange(event: AssEventRecord, startTime: number, endTime: number): boolean {
  return event.startTime >= startTime && event.startTime < endTime;
}

function mapEventsByIdentity(doc: AssDocument): Map<string, AssEventRecord> {
  return new Map(doc.events.map((event) => [event.identityKey, event]));
}

export function applyAssTextPatch(
  baseContent: string,
  currentContent: string,
  theirsContent: string,
  range: { startTime: number; endTime: number }
): { content: string; conflicts: AssPatchConflict[]; changedCount: number } {
  const base = parseAssDocument(baseContent);
  const current = parseAssDocument(currentContent);
  const theirs = parseAssDocument(theirsContent);
  const currentByKey = mapEventsByIdentity(current);
  const theirsByKey = mapEventsByIdentity(theirs);
  const outputLines = [...current.lines];
  const conflicts: AssPatchConflict[] = [];
  let changedCount = 0;

  for (const baseEvent of base.events) {
    if (!eventInRange(baseEvent, range.startTime, range.endTime)) continue;

    const currentEvent = currentByKey.get(baseEvent.identityKey);
    const theirsEvent = theirsByKey.get(baseEvent.identityKey);

    if (!currentEvent || !theirsEvent) {
      conflicts.push({
        type: "missing_event",
        eventKey: baseEvent.identityKey,
        startTime: baseEvent.startTime,
        endTime: baseEvent.endTime,
        baseText: baseEvent.text,
        currentText: currentEvent?.text ?? "",
        theirsText: theirsEvent?.text ?? "",
        message: "ASS event is missing from current or submitted version",
      });
      continue;
    }

    if (structureSignature(baseEvent) !== structureSignature(theirsEvent)) {
      conflicts.push({
        type: "structure_conflict",
        eventKey: baseEvent.identityKey,
        startTime: baseEvent.startTime,
        endTime: baseEvent.endTime,
        baseText: baseEvent.text,
        currentText: currentEvent.text,
        theirsText: theirsEvent.text,
        message: "Translator submission changed non-text ASS fields",
      });
      continue;
    }

    if (theirsEvent.text === baseEvent.text) continue;

    if (currentEvent.text !== baseEvent.text && currentEvent.text !== theirsEvent.text) {
      conflicts.push({
        type: "text_conflict",
        eventKey: baseEvent.identityKey,
        startTime: baseEvent.startTime,
        endTime: baseEvent.endTime,
        baseText: baseEvent.text,
        currentText: currentEvent.text,
        theirsText: theirsEvent.text,
        message: "Current translation and submitted patch changed the same ASS event",
      });
      continue;
    }

    outputLines[currentEvent.lineIndex] = rewriteEventLine(currentEvent, theirsEvent.text);
    changedCount += 1;
  }

  return {
    content: outputLines.join(current.newline),
    conflicts,
    changedCount,
  };
}
