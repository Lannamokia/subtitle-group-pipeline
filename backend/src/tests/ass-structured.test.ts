import { applyAssTextPatch, parseAssDocument } from "../modules/subtitle/ass-structured";

function buildAegisubAss(options: {
  text: string;
  videoFile?: string;
  extradataValue?: string;
  effect?: string;
}) {
  return `[Script Info]
Title: Aegisub Compatibility
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Actor, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,NTP,0,0,0,${options.effect ?? "eid0"},${options.text}

[Aegisub Project Garbage]
Video File: ${options.videoFile ?? "current.mkv"}
Audio File: ${options.videoFile ?? "current.mkv"}
Scroll Position: 12
Active Line: 1

[Aegisub Extradata]
Data: 0,comment,e${options.extradataValue ?? "current-extra"}
Data: 1,vector,u${options.extradataValue ?? "current-extra"}`;
}

describe("Structured ASS patching", () => {
  it("parses Aegisub private sections without treating them as subtitle events", () => {
    const doc = parseAssDocument(buildAegisubAss({ text: "Original" }));

    expect(doc.events.length).toBe(1);
    expect(doc.aegisubSections.map((section) => section.aegisubKind)).toEqual([
      "project_garbage",
      "extradata",
    ]);
    expect(doc.aegisubProjectGarbage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "Video File", value: "current.mkv" }),
        expect.objectContaining({ key: "Active Line", value: "1" }),
      ])
    );
    expect(doc.aegisubExtradata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 0,
          key: "comment",
          encoding: "inline",
          value: "current-extra",
        }),
        expect.objectContaining({
          id: 1,
          key: "vector",
          encoding: "uuencode",
          value: "current-extra",
        }),
      ])
    );
  });

  it("rewrites only Events text and preserves current Aegisub sections verbatim", () => {
    const base = buildAegisubAss({
      text: "Original",
      videoFile: "base.mkv",
      extradataValue: "base-extra",
    });
    const current = buildAegisubAss({
      text: "Original",
      videoFile: "current.mkv",
      extradataValue: "current-extra",
    });
    const theirs = buildAegisubAss({
      text: "Translated, with comma",
      videoFile: "translator-edited.mkv",
      extradataValue: "translator-extra",
    });

    const result = applyAssTextPatch(base, current, theirs, {
      startTime: 1,
      endTime: 5,
    });

    expect(result.conflicts).toEqual([]);
    expect(result.changedCount).toBe(1);
    expect(result.content).toContain("Translated, with comma");
    expect(result.content).toContain("Video File: current.mkv");
    expect(result.content).toContain("Data: 0,comment,ecurrent-extra");
    expect(result.content).not.toContain("translator-edited.mkv");
    expect(result.content).not.toContain("translator-extra");
  });

  it("keeps Aegisub extradata references protected as non-text structure", () => {
    const base = buildAegisubAss({ text: "Original", effect: "eid0" });
    const current = buildAegisubAss({ text: "Original", effect: "eid0" });
    const theirs = buildAegisubAss({ text: "Translated", effect: "eid1" });

    const result = applyAssTextPatch(base, current, theirs, {
      startTime: 1,
      endTime: 5,
    });

    expect(result.changedCount).toBe(0);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        type: "structure_conflict",
        message: "Translator submission changed non-text ASS fields",
      }),
    ]);
    expect(result.content).toContain("eid0,Original");
  });
});
