import type { FileType, TaskRole } from "@/types";

export type TaskTemplatePreset = {
  title: string;
  description: string;
};

export type TaskDeliveryRule = {
  fileTypes: FileType[];
  accept: string;
  formats: string[];
  guidance: string;
  deliverables: string[];
};

export type TaskWorkflowStep = {
  role: Exclude<TaskRole, "supervisor">;
  templates: TaskTemplatePreset[];
} & TaskDeliveryRule;

const VIDEO_ACCEPT = [
  "video/*",
  ".mkv",
  ".mp4",
  ".mov",
  ".avi",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".ts",
  ".m2ts",
  ".mts",
  ".mpeg",
  ".mpg",
  ".ogv",
  ".rm",
  ".rmvb",
  ".3gp",
  ".asf",
  ".vob",
  ".mxf",
  ".divx",
  ".h264",
  ".h265",
  ".hevc",
];

const SUBTITLE_ACCEPT = [
  ".ass",
  ".ssa",
  ".srt",
  ".vtt",
  ".sbv",
  ".sub",
  ".idx",
  ".sup",
  ".smi",
  ".sami",
  ".ttml",
  ".dfxp",
  ".stl",
  ".txt",
  ".lrc",
  ".xml",
];

const FONT_ACCEPT = [".ttf", ".otf", ".ttc", ".woff", ".woff2", ".pfb", ".pfm"];

const PACKAGE_ACCEPT = [
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".psd",
  ".aep",
  ".prproj",
  ".veg",
  ".blend",
  ".kra",
  ".clip",
  ".aup3",
];

const RELEASE_ACCEPT = [".torrent", ".nfo", ".md", ".txt", ".json", ".csv"];

function accept(...groups: string[][]) {
  return Array.from(new Set(groups.flat())).join(",");
}

export const TASK_PIPELINE_ROLES: Exclude<TaskRole, "supervisor">[] = [
  "source",
  "timing",
  "translation",
  "post_production",
  "encoding",
  "release",
];

export const TASK_WORKFLOW_STEPS: TaskWorkflowStep[] = [
  {
    role: "source",
    fileTypes: ["video", "project_package"],
    accept: accept(VIDEO_ACCEPT, PACKAGE_ACCEPT),
    formats: ["常见视频容器", "原盘/压缩包", "素材工程包"],
    guidance: "提交片源、原始素材或片源整理包，系统会按视频/工程包大类校验。",
    deliverables: ["原始视频或分流片源", "片源校验说明", "可选素材包"],
    templates: [
      { title: "片源整理", description: "整理并提交本集可用于时轴和后续制作的片源文件。" },
      { title: "片源校验", description: "检查片源完整性、分辨率、音轨和时长，并记录异常。" },
    ],
  },
  {
    role: "timing",
    fileTypes: ["subtitle"],
    accept: accept(SUBTITLE_ACCEPT),
    formats: ["ASS/SSA", "SRT/VTT", "TTML/DFXP", "SUP/IDX/SUB"],
    guidance: "提交时轴字幕文件，字幕大类内尽量兼容常见字幕格式。",
    deliverables: ["已完成时轴的字幕文件", "关键时间轴说明"],
    templates: [
      { title: "时轴制作", description: "基于片源完成本集对白、OP/ED 和必要轴点。" },
      { title: "时轴校对", description: "检查轴点、断句、重叠和场景切换贴合度。" },
    ],
  },
  {
    role: "translation",
    fileTypes: ["subtitle"],
    accept: accept(SUBTITLE_ACCEPT),
    formats: ["ASS/SSA", "SRT/VTT", "TTML/DFXP", "纯文本翻译稿"],
    guidance: "提交翻译字幕或翻译稿，支持常见字幕格式和纯文本稿件。",
    deliverables: ["翻译字幕文件", "翻译疑问或注释"],
    templates: [
      { title: "正片翻译", description: "完成本集主体对白和屏幕字翻译。" },
      { title: "翻译校对", description: "校对术语、语气、断句和漏翻错翻。" },
    ],
  },
  {
    role: "post_production",
    fileTypes: ["subtitle", "font", "project_package"],
    accept: accept(SUBTITLE_ACCEPT, FONT_ACCEPT, PACKAGE_ACCEPT),
    formats: ["特效字幕", "字体文件", "后期工程包"],
    guidance: "提交特效/样式字幕、字体包或后期工程包。",
    deliverables: ["特效和样式处理后的字幕", "字体包", "必要工程文件"],
    templates: [
      { title: "后期特效", description: "完成样式、特效、屏幕字和排版处理。" },
      { title: "字体与样式打包", description: "整理本集所需字体和样式资源。" },
    ],
  },
  {
    role: "encoding",
    fileTypes: ["video", "project_package"],
    accept: accept(VIDEO_ACCEPT, PACKAGE_ACCEPT),
    formats: ["常见视频容器", "压制工程包", "日志/配置包"],
    guidance: "提交压制成品、压制工程或相关配置包；视频大类内放开常见容器。",
    deliverables: ["内封/内嵌成品视频", "压制日志或参数", "可选工程包"],
    templates: [
      { title: "成品压制", description: "按项目成品配置压制本集内封或内嵌成品。" },
      { title: "压制质检", description: "检查码率、音轨、字幕封装、黑边和播放兼容性。" },
    ],
  },
  {
    role: "release",
    fileTypes: ["video", "subtitle", "project_package", "other"],
    accept: accept(VIDEO_ACCEPT, SUBTITLE_ACCEPT, PACKAGE_ACCEPT, RELEASE_ACCEPT),
    formats: ["成品视频", "外挂字幕", "发布包", "种子/说明文件"],
    guidance: "提交最终发布资产，允许视频、字幕、发布包和说明文件。",
    deliverables: ["最终发布文件", "网盘/种子说明", "发布文案或校验信息"],
    templates: [
      { title: "发布打包", description: "整理最终发布资产、命名和校验信息。" },
      { title: "发布投递", description: "发布到指定渠道并记录下载/分流信息。" },
    ],
  },
];

export const TASK_DELIVERY_RULES: Record<TaskRole, TaskDeliveryRule> = {
  ...Object.fromEntries(TASK_WORKFLOW_STEPS.map((step) => [step.role, step])),
  supervisor: {
    fileTypes: ["video", "subtitle", "font", "project_package", "other"],
    accept: accept(VIDEO_ACCEPT, SUBTITLE_ACCEPT, FONT_ACCEPT, PACKAGE_ACCEPT, RELEASE_ACCEPT),
    formats: ["全部制作资产类型"],
    guidance: "监制可补交或替换任意制作相关资产。",
    deliverables: ["审核说明", "补充材料", "替换资产"],
  },
} as Record<TaskRole, TaskDeliveryRule>;

export function getTaskWorkflowStep(role: TaskRole) {
  return TASK_WORKFLOW_STEPS.find((step) => step.role === role);
}

export function getTaskDeliveryRule(role: TaskRole): TaskDeliveryRule {
  return TASK_DELIVERY_RULES[role];
}

export function getDefaultTaskFileType(role: TaskRole): FileType {
  return getTaskDeliveryRule(role).fileTypes[0] ?? "other";
}
