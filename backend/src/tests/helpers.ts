import request from "supertest";
import { Application } from "express";
import { prisma } from "./setup";

// ==================== HTTP Request Helpers ====================

export function get(app: Application, path: string, token?: string) {
  const req = request(app).get(path);
  if (token) {
    req.set("Authorization", `Bearer ${token}`);
  }
  return req;
}

export function post(app: Application, path: string, body: unknown, token?: string) {
  const req = request(app).post(path).send(body);
  if (token) {
    req.set("Authorization", `Bearer ${token}`);
  }
  return req;
}

export function put(app: Application, path: string, body: unknown, token?: string) {
  const req = request(app).put(path).send(body);
  if (token) {
    req.set("Authorization", `Bearer ${token}`);
  }
  return req;
}

export function patch(app: Application, path: string, body: unknown, token?: string) {
  const req = request(app).patch(path).send(body);
  if (token) {
    req.set("Authorization", `Bearer ${token}`);
  }
  return req;
}

export function del(app: Application, path: string, token?: string) {
  const req = request(app).delete(path);
  if (token) {
    req.set("Authorization", `Bearer ${token}`);
  }
  return req;
}

// ==================== Mock Data Generators ====================

export function generateUsername(): string {
  return `user_${Math.random().toString(36).substring(2, 10)}`;
}

export function generateEmail(): string {
  return `test_${Math.random().toString(36).substring(2, 10)}@example.com`;
}

export function generatePassword(): string {
  return `Pass_${Math.random().toString(36).substring(2, 12)}!`;
}

export function generateProjectName(): string {
  return `Project ${Math.random().toString(36).substring(2, 8)}`;
}

export function generateFileName(ext = ".ass"): string {
  return `file_${Math.random().toString(36).substring(2, 8)}${ext}`;
}

// ==================== ASS Content Generators ====================

export function generateASSContent(lines: Array<{ start: string; end: string; text: string }> = []): string {
  const defaultLines = lines.length > 0 ? lines : [
    { start: "0:00:01.00", end: "0:00:05.00", text: "Hello world" },
    { start: "0:00:06.00", end: "0:00:10.00", text: "Second line" },
  ];

  const dialogueLines = defaultLines.map((line, i) =>
    `Dialogue: 0,${line.start},${line.end},Default,,0,0,0,,${line.text}`
  );

  return `[Script Info]
Title: Test Subtitle
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogueLines.join("\n")}`;
}

export function generateASSWithDuplicate(): string {
  return `[Script Info]
Title: Test Duplicate
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Duplicate line
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Duplicate line
Dialogue: 0,0:00:06.00,0:00:10.00,Default,,0,0,0,,Unique line`;
}

export function generateASSWithConflict(): string {
  return `[Script Info]
Title: Test Conflict
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Version A text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Version B text
Dialogue: 0,0:00:06.00,0:00:10.00,Default,,0,0,0,,Same text`;
}

// ==================== Database Assertion Helpers ====================

export async function countRecords(tableName: string, where: Record<string, unknown> = {}): Promise<number> {
  // @ts-ignore
  return prisma[tableName].count({ where });
}

export async function findFirstRecord(tableName: string, where: Record<string, unknown> = {}) {
  // @ts-ignore
  return prisma[tableName].findFirst({ where });
}

export async function findUniqueRecord(tableName: string, id: string) {
  // @ts-ignore
  return prisma[tableName].findUnique({ where: { id } });
}

// ==================== Response Assertion Helpers ====================

export function expectSuccess(response: request.Response, statusCode = 200) {
  expect(response.status).toBe(statusCode);
  expect(response.body.success).toBe(true);
}

export function expectError(response: request.Response, statusCode: number, errorCode?: string) {
  expect(response.status).toBe(statusCode);
  expect(response.body.success).toBe(false);
  if (errorCode) {
    expect(response.body.error?.code).toBe(errorCode);
  }
}

// ==================== XSS Payloads ====================

export const xssPayloads = {
  scriptTag: '<script>alert("xss")</script>',
  imgOnError: '<img src="x" onerror="alert(\'xss\')">',
  javascriptProtocol: 'javascript:alert("xss")',
  svgOnload: '<svg onload="alert(\'xss\')"></svg>',
  eventHandler: '<div onmouseover="alert(\'xss\')">hover me</div>',
  encodedScript: '&lt;script&gt;alert("xss")&lt;/script&gt;',
  templateInjection: '{{constructor.constructor("alert(\'xss\')")()}}',
};

// ==================== SQL Injection Payloads ====================

export const sqlInjectionPayloads = [
  "' OR '1'='1",
  "'; DROP TABLE users; --",
  "' UNION SELECT * FROM users --",
  "1 OR 1=1",
  "1; DELETE FROM users WHERE '1'='1",
  "' OR '1'='1' --",
  "' OR 1=1#",
  "1' AND 1=1--",
];

// ==================== Path Traversal Payloads ====================

export const pathTraversalPayloads = [
  "../../../etc/passwd",
  "..\\..\\..\\windows\\system32\\config\\sam",
  "....//....//....//etc/passwd",
  "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
  "..%252f..%252f..%252fetc/passwd",
];
