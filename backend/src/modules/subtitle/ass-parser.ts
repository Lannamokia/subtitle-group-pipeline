/**
 * ASS (Advanced SubStation Alpha) subtitle parser
 * Handles common ASS format features including Dialogue lines, basic tags, and time conversion.
 */

export interface ASSLine {
  id: string;
  layer: number;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  style: string;
  name: string;
  marginL: number;
  marginR: number;
  marginV: number;
  effect: string;
  text: string;
}

export interface ASSScriptInfo {
  title?: string;
  originalScript?: string;
  originalTranslation?: string;
  originalEditing?: string;
  originalTiming?: string;
  scriptType?: string;
  playResX?: number;
  playResY?: number;
  playDepth?: number;
  timer?: number;
  wrapStyle?: number;
  scaledBorderAndShadow?: string;
  ycbcrMatrix?: string;
  [key: string]: string | number | undefined;
}

export interface ASSStyle {
  name: string;
  fontName: string;
  fontSize: number;
  primaryColour: string;
  secondaryColour: string;
  outlineColour: string;
  backColour: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeOut: boolean;
  scaleX: number;
  scaleY: number;
  spacing: number;
  angle: number;
  borderStyle: number;
  outline: number;
  shadow: number;
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
  encoding: number;
}

export interface ASSParseResult {
  scriptInfo: ASSScriptInfo;
  styles: ASSStyle[];
  lines: ASSLine[];
}

/**
 * Convert ASS time format (H:MM:SS.cc) to seconds
 */
export function assTimeToSeconds(timeStr: string): number {
  const trimmed = timeStr.trim();
  const parts = trimmed.split(/[:.]/);
  if (parts.length !== 4) {
    throw new Error(`Invalid ASS time format: "${timeStr}"`);
  }
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);
  const centiseconds = parseInt(parts[3], 10);
  return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
}

/**
 * Convert seconds to ASS time format (H:MM:SS.cc)
 */
export function secondsToAssTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/**
 * Process ASS text: handle \N (hard newline), \n (soft newline), and strip common override tags
 */
export function processAssText(text: string): string {
  let processed = text;

  // Hard newline
  processed = processed.replace(/\\N/g, "\n");
  // Soft newline
  processed = processed.replace(/\\n/g, " ");

  // Strip common override tags: {\...}
  // This is a best-effort strip for common tags like {\fad(...)}, {\pos(...)}, {\an#}, etc.
  processed = processed.replace(/\{[^}]*\}/g, "");

  return processed;
}

/**
 * Escape text for ASS output (reverse of processAssText for newlines)
 */
export function escapeAssText(text: string): string {
  return text.replace(/\n/g, "\\N");
}

/**
 * Parse a single Dialogue line from the Events section
 * Format: Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
 */
function parseDialogueLine(line: string, index: number): ASSLine | null {
  const prefix = "Dialogue:";
  const prefixIdx = line.indexOf(prefix);
  if (prefixIdx === -1) return null;

  const afterPrefix = line.substring(prefixIdx + prefix.length);
  // Split by comma, but the last field (Text) may contain commas
  const parts = afterPrefix.split(",");
  if (parts.length < 10) return null;

  // First 9 fields are fixed; everything after the 9th comma is the text
  const fixedFields = parts.slice(0, 9);
  const text = parts.slice(9).join(",").trim();

  const layer = parseInt(fixedFields[0].trim(), 10) || 0;
  const startTime = assTimeToSeconds(fixedFields[1].trim());
  const endTime = assTimeToSeconds(fixedFields[2].trim());
  const style = fixedFields[3].trim();
  const name = fixedFields[4].trim();
  const marginL = parseInt(fixedFields[5].trim(), 10) || 0;
  const marginR = parseInt(fixedFields[6].trim(), 10) || 0;
  const marginV = parseInt(fixedFields[7].trim(), 10) || 0;
  const effect = fixedFields[8].trim();

  return {
    id: `line_${index}`,
    layer,
    startTime,
    endTime,
    style,
    name,
    marginL,
    marginR,
    marginV,
    effect,
    text: processAssText(text),
  };
}

/**
 * Parse a single Style line from the Styles section
 * Format: Style: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
 */
function parseStyleLine(line: string): ASSStyle | null {
  const prefix = "Style:";
  const prefixIdx = line.indexOf(prefix);
  if (prefixIdx === -1) return null;

  const afterPrefix = line.substring(prefixIdx + prefix.length);
  const parts = afterPrefix.split(",").map((p) => p.trim());
  if (parts.length < 22) return null;

  return {
    name: parts[0],
    fontName: parts[1],
    fontSize: parseFloat(parts[2]) || 0,
    primaryColour: parts[3],
    secondaryColour: parts[4],
    outlineColour: parts[5],
    backColour: parts[6],
    bold: parts[7] === "-1" || parts[7].toLowerCase() === "true",
    italic: parts[8] === "-1" || parts[8].toLowerCase() === "true",
    underline: parts[9] === "-1" || parts[9].toLowerCase() === "true",
    strikeOut: parts[10] === "-1" || parts[10].toLowerCase() === "true",
    scaleX: parseFloat(parts[11]) || 100,
    scaleY: parseFloat(parts[12]) || 100,
    spacing: parseFloat(parts[13]) || 0,
    angle: parseFloat(parts[14]) || 0,
    borderStyle: parseInt(parts[15], 10) || 1,
    outline: parseFloat(parts[16]) || 0,
    shadow: parseFloat(parts[17]) || 0,
    alignment: parseInt(parts[18], 10) || 2,
    marginL: parseInt(parts[19], 10) || 0,
    marginR: parseInt(parts[20], 10) || 0,
    marginV: parseInt(parts[21], 10) || 0,
    encoding: parseInt(parts[22], 10) || 1,
  };
}

/**
 * Parse Script Info section key-value pairs
 */
function parseScriptInfoLine(line: string): [string, string | number] | null {
  const idx = line.indexOf(":");
  if (idx === -1) return null;
  const key = line.substring(0, idx).trim();
  const value = line.substring(idx + 1).trim();

  // Try numeric for known numeric fields
  const numericKeys = ["PlayResX", "PlayResY", "PlayDepth", "WrapStyle"];
  if (numericKeys.includes(key)) {
    const num = parseInt(value, 10);
    if (!isNaN(num)) return [key, num];
  }
  if (key === "Timer") {
    const num = parseFloat(value);
    if (!isNaN(num)) return [key, num];
  }

  return [key, value];
}

/**
 * Parse full ASS file content into structured data
 */
export function parseASS(content: string): ASSParseResult {
  const lines = content.split(/\r?\n/);
  const result: ASSParseResult = {
    scriptInfo: {},
    styles: [],
    lines: [],
  };

  let section: "none" | "scriptInfo" | "styles" | "events" = "none";
  let lineIndex = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === "" || line.startsWith(";")) {
      continue;
    }

    if (line.startsWith("[")) {
      const sectionName = line.toLowerCase();
      if (sectionName === "[script info]") {
        section = "scriptInfo";
      } else if (sectionName === "[v4+ styles]" || sectionName === "[v4 styles]") {
        section = "styles";
      } else if (sectionName === "[events]") {
        section = "events";
      } else {
        section = "none";
      }
      continue;
    }

    if (section === "scriptInfo") {
      const parsed = parseScriptInfoLine(line);
      if (parsed) {
        const [key, value] = parsed;
        result.scriptInfo[key] = value;
      }
    } else if (section === "styles") {
      if (line.startsWith("Style:")) {
        const style = parseStyleLine(line);
        if (style) {
          result.styles.push(style);
        }
      }
    } else if (section === "events") {
      if (line.startsWith("Dialogue:")) {
        const dialogue = parseDialogueLine(line, lineIndex++);
        if (dialogue) {
          result.lines.push(dialogue);
        }
      }
    }
  }

  // Sort lines by start time
  result.lines.sort((a, b) => a.startTime - b.startTime);

  return result;
}

/**
 * Generate ASS file content from structured data
 */
export function generateASS(
  scriptInfo: ASSScriptInfo,
  styles: ASSStyle[],
  lines: ASSLine[]
): string {
  const output: string[] = [];

  // Script Info
  output.push("[Script Info]");
  for (const [key, value] of Object.entries(scriptInfo)) {
    if (value !== undefined) {
      output.push(`${key}: ${value}`);
    }
  }
  output.push("");

  // V4+ Styles
  output.push("[V4+ Styles]");
  output.push("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding");
  for (const s of styles) {
    const bold = s.bold ? "-1" : "0";
    const italic = s.italic ? "-1" : "0";
    const underline = s.underline ? "-1" : "0";
    const strikeOut = s.strikeOut ? "-1" : "0";
    output.push(
      `Style: ${s.name},${s.fontName},${s.fontSize},${s.primaryColour},${s.secondaryColour},${s.outlineColour},${s.backColour},${bold},${italic},${underline},${strikeOut},${s.scaleX},${s.scaleY},${s.spacing},${s.angle},${s.borderStyle},${s.outline},${s.shadow},${s.alignment},${s.marginL},${s.marginR},${s.marginV},${s.encoding}`
    );
  }
  output.push("");

  // Events
  output.push("[Events]");
  output.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");
  for (const line of lines) {
    const text = escapeAssText(line.text);
    output.push(
      `Dialogue: ${line.layer},${secondsToAssTime(line.startTime)},${secondsToAssTime(line.endTime)},${line.style},${line.name},${line.marginL},${line.marginR},${line.marginV},${line.effect},${text}`
    );
  }

  return output.join("\n");
}

/**
 * Check if two time ranges overlap
 */
export function timeRangesOverlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): boolean {
  return start1 < end2 && start2 < end1;
}

/**
 * Check if two ASS lines are exact duplicates (same start, end, text)
 */
export function isExactDuplicate(a: ASSLine, b: ASSLine): boolean {
  return (
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    a.text === b.text
  );
}

/**
 * Check if two ASS lines have a text conflict (same start/end, different text)
 */
export function hasTextConflict(a: ASSLine, b: ASSLine): boolean {
  return (
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    a.text !== b.text
  );
}

/**
 * Check if two ASS lines have an overlap conflict (overlapping times, different text)
 */
export function hasOverlapConflict(a: ASSLine, b: ASSLine): boolean {
  return (
    timeRangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime) &&
    a.text !== b.text &&
    !hasTextConflict(a, b)
  );
}
