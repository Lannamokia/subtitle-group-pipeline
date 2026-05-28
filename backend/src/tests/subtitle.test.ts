import { createApp } from "../app";
import {
  prisma,
  createTestUser,
  createTestProject,
  createTestUnit,
  createTestTask,
  createTestFile,
  cleanDatabase,
} from "./setup";
import { post, get, expectSuccess, expectError } from "./helpers";
import {
  parseASS,
  generateASS,
  isExactDuplicate,
  hasTextConflict,
  hasOverlapConflict,
  secondsToAssTime,
  assTimeToSeconds,
} from "../modules/subtitle/ass-parser";
import * as subtitleService from "../modules/subtitle/subtitle.service";
import type { Application } from "express";

describe("Subtitle Processing Tests", () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  describe("ASS Parsing", () => {
    it("should parse basic ASS file structure", () => {
      const assContent = `[Script Info]
Title: Test Subtitle
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Hello world
Dialogue: 0,0:00:06.00,0:00:10.00,Default,,0,0,0,,Second line`;

      const result = parseASS(assContent);

      expect(result.scriptInfo.Title).toBe("Test Subtitle");
      expect(result.scriptInfo.ScriptType).toBe("v4.00+");
      expect(result.scriptInfo.PlayResX).toBe(1920);
      expect(result.scriptInfo.PlayResY).toBe(1080);

      expect(result.styles.length).toBe(1);
      expect(result.styles[0].name).toBe("Default");
      expect(result.styles[0].fontName).toBe("Arial");
      expect(result.styles[0].fontSize).toBe(20);

      expect(result.lines.length).toBe(2);
      expect(result.lines[0].text).toBe("Hello world");
      expect(result.lines[0].startTime).toBe(1);
      expect(result.lines[0].endTime).toBe(5);
      expect(result.lines[1].text).toBe("Second line");
      expect(result.lines[1].startTime).toBe(6);
      expect(result.lines[1].endTime).toBe(10);
    });

    it("should parse ASS with override tags in text", () => {
      const assContent = `[Script Info]
Title: Tagged Subtitle
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,{\\fad(200,200)}Hello with fade
Dialogue: 0,0:00:06.00,0:00:10.00,Default,,0,0,0,,{\\pos(100,200)}Positioned text`;

      const result = parseASS(assContent);

      expect(result.lines[0].text).toBe("Hello with fade");
      expect(result.lines[1].text).toBe("Positioned text");
    });

    it("should handle ASS with hard and soft newlines", () => {
      const assContent = `[Script Info]
Title: Newline Test
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Line one\\NLine two\\nSoft break`;

      const result = parseASS(assContent);

      expect(result.lines[0].text).toBe("Line one\nLine two Soft break");
    });

    it("should sort lines by start time", () => {
      const assContent = `[Script Info]
Title: Unsorted
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:10.00,0:00:15.00,Default,,0,0,0,,Third
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,First
Dialogue: 0,0:00:06.00,0:00:09.00,Default,,0,0,0,,Second`;

      const result = parseASS(assContent);

      expect(result.lines[0].text).toBe("First");
      expect(result.lines[1].text).toBe("Second");
      expect(result.lines[2].text).toBe("Third");
    });

    it("should convert ASS time to seconds correctly", () => {
      expect(assTimeToSeconds("0:00:01.00")).toBe(1);
      expect(assTimeToSeconds("0:01:30.50")).toBe(90.5);
      expect(assTimeToSeconds("1:00:00.00")).toBe(3600);
      expect(assTimeToSeconds("0:00:00.01")).toBe(0.01);
    });

    it("should convert seconds to ASS time correctly", () => {
      expect(secondsToAssTime(1)).toBe("0:00:01.00");
      expect(secondsToAssTime(90.5)).toBe("0:01:30.50");
      expect(secondsToAssTime(3600)).toBe("1:00:00.00");
    });

    it("should generate valid ASS content", () => {
      const scriptInfo = { Title: "Generated", ScriptType: "v4.00+" };
      const styles = [{
        name: "Default",
        fontName: "Arial",
        fontSize: 20,
        primaryColour: "&H00FFFFFF",
        secondaryColour: "&H000000FF",
        outlineColour: "&H00000000",
        backColour: "&H00000000",
        bold: false,
        italic: false,
        underline: false,
        strikeOut: false,
        scaleX: 100,
        scaleY: 100,
        spacing: 0,
        angle: 0,
        borderStyle: 1,
        outline: 2,
        shadow: 2,
        alignment: 2,
        marginL: 10,
        marginR: 10,
        marginV: 10,
        encoding: 1,
      }];
      const lines = [{
        id: "line_1",
        layer: 0,
        startTime: 1,
        endTime: 5,
        style: "Default",
        name: "",
        marginL: 0,
        marginR: 0,
        marginV: 0,
        effect: "",
        text: "Test line",
      }];

      const generated = generateASS(scriptInfo, styles, lines);

      expect(generated).toContain("[Script Info]");
      expect(generated).toContain("Title: Generated");
      expect(generated).toContain("[V4+ Styles]");
      expect(generated).toContain("[Events]");
      expect(generated).toContain("Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Test line");
    });
  });

  describe("Merge Jobs Create Independent Merge Entities", () => {
    it("should create merge job as independent entity", async () => {
      const { user } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const unit = await createTestUnit({ project_id: project.id });

      const job = await prisma.mergeJob.create({
        data: {
          project_id: project.id,
          unit_id: unit.id,
          input_files: JSON.stringify(["file1", "file2"]),
          status: "pending",
        },
      });

      expect(job).toBeDefined();
      expect(job.project_id).toBe(project.id);
      expect(job.unit_id).toBe(unit.id);
      expect(job.status).toBe("pending");
      expect(job.input_files).toBe(JSON.stringify(["file1", "file2"]));
    });

    it("should create multiple independent merge jobs for same unit", async () => {
      const { user } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const unit = await createTestUnit({ project_id: project.id });

      const job1 = await prisma.mergeJob.create({
        data: {
          project_id: project.id,
          unit_id: unit.id,
          input_files: JSON.stringify(["file1"]),
          status: "completed",
        },
      });

      const job2 = await prisma.mergeJob.create({
        data: {
          project_id: project.id,
          unit_id: unit.id,
          input_files: JSON.stringify(["file2", "file3"]),
          status: "pending",
        },
      });

      expect(job1.id).not.toBe(job2.id);

      const jobs = await prisma.mergeJob.findMany({
        where: { project_id: project.id, unit_id: unit.id },
      });

      expect(jobs.length).toBe(2);
    });
  });

  describe("Duplicate Elimination", () => {
    it("should detect exact duplicate lines", () => {
      const lineA = {
        id: "a", layer: 0, startTime: 1, endTime: 5, style: "Default",
        name: "", marginL: 0, marginR: 0, marginV: 0, effect: "", text: "Same text",
      };
      const lineB = {
        id: "b", layer: 0, startTime: 1, endTime: 5, style: "Default",
        name: "", marginL: 0, marginR: 0, marginV: 0, effect: "", text: "Same text",
      };

      expect(isExactDuplicate(lineA, lineB)).toBe(true);
    });

    it("should not flag different text as duplicate", () => {
      const lineA = {
        id: "a", layer: 0, startTime: 1, endTime: 5, style: "Default",
        name: "", marginL: 0, marginR: 0, marginV: 0, effect: "", text: "Text A",
      };
      const lineB = {
        id: "b", layer: 0, startTime: 1, endTime: 5, style: "Default",
        name: "", marginL: 0, marginR: 0, marginV: 0, effect: "", text: "Text B",
      };

      expect(isExactDuplicate(lineA, lineB)).toBe(false);
    });

    it("should not flag different timing as duplicate", () => {
      const lineA = {
        id: "a", layer: 0, startTime: 1, endTime: 5, style: "Default",
        name: "", marginL: 0, marginR: 0, marginV: 0, effect: "", text: "Same text",
      };
      const lineB = {
        id: "b", layer: 0, startTime: 2, endTime: 6, style: "Default",
        name: "", marginL: 0, marginR: 0, marginV: 0, effect: "", text: "Same text",
      };

      expect(isExactDuplicate(lineA, lineB)).toBe(false);
    });
  });

  describe("Version Comparison Generation", () => {
    it("should compare two ASS versions and find differences", async () => {
      const { user } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const unit = await createTestUnit({ project_id: project.id });
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        creator_id: user.id,
        role: "translation",
      });

      const assV1 = `[Script Info]
Title: Version 1
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Original line
Dialogue: 0,0:00:06.00,0:00:10.00,Default,,0,0,0,,Kept line`;

      const assV2 = `[Script Info]
Title: Version 2
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Modified line
Dialogue: 0,0:00:06.00,0:00:10.00,Default,,0,0,0,,Kept line
Dialogue: 0,0:00:11.00,0:00:15.00,Default,,0,0,0,,New line`;

      // Create file versions with submissions
      const { file: file1 } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
        name: "v1.ass",
      });
      const { file: file2 } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
        name: "v2.ass",
      });

      const versions1 = await prisma.fileVersion.findMany({ where: { file_id: file1.id } });
      const versions2 = await prisma.fileVersion.findMany({ where: { file_id: file2.id } });

      await prisma.translationSubmission.create({
        data: {
          task_id: task.id,
          user_id: user.id,
          file_version_id: versions1[0].id,
          content: assV1,
        },
      });

      await prisma.translationSubmission.create({
        data: {
          task_id: task.id,
          user_id: user.id,
          file_version_id: versions2[0].id,
          content: assV2,
        },
      });

      const comparison = await subtitleService.compareVersions(
        versions1[0].id,
        versions2[0].id
      );

      expect(comparison.added.length).toBe(1); // New line
      expect(comparison.removed.length).toBe(1); // Original line
      expect(comparison.modified.length).toBe(0); // Same timing but different text
      expect(comparison.unchanged.length).toBe(1); // Kept line
    });
  });

  describe("Conflict Generation", () => {
    it("should detect text conflicts (same time, different text)", () => {
      const lineA = {
        id: "a", layer: 0, startTime: 1, endTime: 5, style: "Default",
        name: "", marginL: 0, marginR: 0, marginV: 0, effect: "", text: "Version A",
      };
      const lineB = {
        id: "b", layer: 0, startTime: 1, endTime: 5, style: "Default",
        name: "", marginL: 0, marginR: 0, marginV: 0, effect: "", text: "Version B",
      };

      expect(hasTextConflict(lineA, lineB)).toBe(true);
    });

    it("should detect overlap conflicts (overlapping times, different text)", () => {
      const lineA = {
        id: "a", layer: 0, startTime: 1, endTime: 5, style: "Default",
        name: "", marginL: 0, marginR: 0, marginV: 0, effect: "", text: "Text A",
      };
      const lineB = {
        id: "b", layer: 0, startTime: 3, endTime: 7, style: "Default",
        name: "", marginL: 0, marginR: 0, marginV: 0, effect: "", text: "Text B",
      };

      expect(hasOverlapConflict(lineA, lineB)).toBe(true);
    });

    it("should not flag exact duplicates as conflicts", () => {
      const lineA = {
        id: "a", layer: 0, startTime: 1, endTime: 5, style: "Default",
        name: "", marginL: 0, marginR: 0, marginV: 0, effect: "", text: "Same",
      };
      const lineB = {
        id: "b", layer: 0, startTime: 1, endTime: 5, style: "Default",
        name: "", marginL: 0, marginR: 0, marginV: 0, effect: "", text: "Same",
      };

      expect(hasTextConflict(lineA, lineB)).toBe(false);
      expect(hasOverlapConflict(lineA, lineB)).toBe(false);
    });

    it("should create conflict records in database", async () => {
      const { user } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const { file: fileA } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
        name: "conflict_a.ass",
      });
      const { file: fileB } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
        name: "conflict_b.ass",
      });

      const conflict = await prisma.subtitleConflict.create({
        data: {
          project_id: project.id,
          conflict_type: "content_mismatch",
          description: "Different translations for same line",
          affected_lines: JSON.stringify([1, 5]),
          file_a_id: fileA.id,
          file_b_id: fileB.id,
          resolution: "unresolved",
        },
      });

      expect(conflict).toBeDefined();
      expect(conflict.conflict_type).toBe("content_mismatch");
      expect(conflict.resolution).toBe("unresolved");
      expect(conflict.file_a_id).toBe(fileA.id);
      expect(conflict.file_b_id).toBe(fileB.id);
    });
  });

  describe("Online Dedup Write-Back Restricted to Supervisors", () => {
    it("should allow supervisors to resolve conflicts", async () => {
      const { user: supervisor } = await createTestUser({ role: "supervisor" });
      const { user: regular } = await createTestUser({ role: "member" });
      const project = await createTestProject({ owner_id: supervisor.id });
      const { file: fileA } = await createTestFile({
        project_id: project.id,
        uploader_id: regular.id,
      });
      const { file: fileB } = await createTestFile({
        project_id: project.id,
        uploader_id: regular.id,
      });

      const conflict = await prisma.subtitleConflict.create({
        data: {
          project_id: project.id,
          conflict_type: "content_mismatch",
          description: "Conflict",
          file_a_id: fileA.id,
          file_b_id: fileB.id,
          resolution: "unresolved",
        },
      });

      const resolved = await subtitleService.resolveConflict(
        conflict.id,
        supervisor.id,
        "supervisor",
        { resolution: "resolved_auto", resolution_note: "Fixed automatically" }
      );

      expect(resolved.resolution).toBe("resolved_auto");
      expect(resolved.resolved_by).toBe(supervisor.id);
      expect(resolved.resolved_at).not.toBeNull();
    });

    it("should reject non-supervisors from resolving conflicts", async () => {
      const { user: regular } = await createTestUser({ role: "member" });
      const project = await createTestProject({ owner_id: regular.id });
      const { file: fileA } = await createTestFile({
        project_id: project.id,
        uploader_id: regular.id,
      });
      const { file: fileB } = await createTestFile({
        project_id: project.id,
        uploader_id: regular.id,
      });

      const conflict = await prisma.subtitleConflict.create({
        data: {
          project_id: project.id,
          conflict_type: "content_mismatch",
          description: "Conflict",
          file_a_id: fileA.id,
          file_b_id: fileB.id,
          resolution: "unresolved",
        },
      });

      await expect(
        subtitleService.resolveConflict(
          conflict.id,
          regular.id,
          "member",
          { resolution: "resolved_manual" }
        )
      ).rejects.toThrow("Only supervisors and designated reviewers can resolve conflicts");
    });

    it("should reject resolving already-resolved conflicts", async () => {
      const { user: supervisor } = await createTestUser({ role: "supervisor" });
      const project = await createTestProject({ owner_id: supervisor.id });
      const { file: fileA } = await createTestFile({
        project_id: project.id,
        uploader_id: supervisor.id,
      });
      const { file: fileB } = await createTestFile({
        project_id: project.id,
        uploader_id: supervisor.id,
      });

      const conflict = await prisma.subtitleConflict.create({
        data: {
          project_id: project.id,
          conflict_type: "content_mismatch",
          description: "Conflict",
          file_a_id: fileA.id,
          file_b_id: fileB.id,
          resolution: "resolved_auto",
          resolved_by: supervisor.id,
          resolved_at: new Date(),
        },
      });

      await expect(
        subtitleService.resolveConflict(
          conflict.id,
          supervisor.id,
          "supervisor",
          { resolution: "resolved_manual" }
        )
      ).rejects.toThrow("Conflict is already resolved");
    });
  });

  describe("File Version Reference in Task Comments", () => {
    it("should reference file version in task comments", async () => {
      const { user } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const unit = await createTestUnit({ project_id: project.id });
      const task = await createTestTask({
        project_id: project.id,
        unit_id: unit.id,
        creator_id: user.id,
        role: "translation",
      });
      const { file, version } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
      });

      const comment = await prisma.comment.create({
        data: {
          user_id: user.id,
          content: `Reviewing version ${version.version_number} of ${file.name}`,
          file_version_id: file.id,
        },
      });

      expect(comment).toBeDefined();
      expect(comment.file_version_id).toBe(file.id);
      expect(comment.content).toContain(String(version.version_number));
    });

    it("should retrieve comments with file version info", async () => {
      const { user } = await createTestUser();
      const project = await createTestProject({ owner_id: user.id });
      const { file } = await createTestFile({
        project_id: project.id,
        uploader_id: user.id,
      });

      await prisma.comment.create({
        data: {
          user_id: user.id,
          content: "Great work on this version!",
          file_version_id: file.id,
          line_number: 5,
        },
      });

      const comments = await prisma.comment.findMany({
        where: { file_version_id: file.id },
        include: { user: { select: { id: true, username: true } } },
      });

      expect(comments.length).toBe(1);
      expect(comments[0].line_number).toBe(5);
      expect(comments[0].user.username).toBe(user.username);
    });
  });
});
