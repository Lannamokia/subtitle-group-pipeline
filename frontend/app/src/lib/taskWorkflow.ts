import type { FileType, TaskRole, UploadPolicy, UploadPolicyRule } from "@/types";

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

type UploadPolicyProfile = {
  fileTypes: FileType[];
  accept: string;
  formats: string[];
  constrained: boolean;
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

const ALL_FILE_TYPES: FileType[] = ["video", "subtitle", "font", "project_package", "other"];
const ALL_TASK_ROLES: TaskRole[] = [
  "source",
  "timing",
  "translation",
  "post_production",
  "encoding",
  "release",
  "supervisor",
];

const FILE_TYPE_ACCEPT: Record<FileType, string[]> = {
  video: VIDEO_ACCEPT,
  subtitle: SUBTITLE_ACCEPT,
  font: FONT_ACCEPT,
  project_package: PACKAGE_ACCEPT,
  other: RELEASE_ACCEPT,
};

export function getFileTypeAccept(type: FileType): string {
  return accept(FILE_TYPE_ACCEPT[type] ?? RELEASE_ACCEPT);
}

export function getFileTypesAccept(types: FileType[]): string {
  return accept(...types.map((type) => FILE_TYPE_ACCEPT[type] ?? RELEASE_ACCEPT));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function normalizeFileTypes(value: unknown): FileType[] {
  return normalizeStringList(value).filter((item): item is FileType =>
    ALL_FILE_TYPES.includes(item as FileType)
  );
}

function isAcceptValue(value: string) {
  return value === "*" || value === "*/*" || value.startsWith(".") || value.includes("/");
}

function formatPolicyValues(values: string[]) {
  const visible = values.filter((value) => value !== "*" && value !== "*/*");
  return visible.length > 0 ? visible : ["全部格式"];
}

function normalizePolicyRule(rule: unknown): { fileTypes: FileType[]; acceptValues: string[] } {
  if (Array.isArray(rule)) {
    const values = normalizeStringList(rule);
    return {
      fileTypes: values.filter((item): item is FileType => ALL_FILE_TYPES.includes(item as FileType)),
      acceptValues: values.filter(isAcceptValue),
    };
  }

  if (!isRecord(rule)) {
    return { fileTypes: [], acceptValues: [] };
  }

  const allowedValues = [
    ...normalizeStringList(rule.allowed_types),
    ...normalizeStringList(rule.allowedTypes),
  ];
  const mimeValues = [
    ...normalizeStringList(rule.mime_types),
    ...normalizeStringList(rule.mimeTypes),
  ];
  const extensionValues = normalizeStringList(rule.extensions);
  const fileTypes = [
    ...normalizeFileTypes(rule.file_types),
    ...normalizeFileTypes(rule.fileTypes),
    ...normalizeFileTypes(rule.allowed_types),
    ...normalizeFileTypes(rule.allowedTypes),
  ];

  return {
    fileTypes: unique(fileTypes) as FileType[],
    acceptValues: unique([
      ...allowedValues.filter(isAcceptValue),
      ...mimeValues,
      ...extensionValues,
    ]),
  };
}

function isRoleMatrix(value: unknown): value is Record<TaskRole, unknown> {
  return isRecord(value) && Object.keys(value).some((key) => ALL_TASK_ROLES.includes(key as TaskRole));
}

function resolvePolicyMatrix(policy: UploadPolicy): Record<TaskRole, unknown> | null {
  if (isRoleMatrix(policy.roles)) return policy.roles;
  if (isRoleMatrix(policy.byRole)) return policy.byRole;
  if (isRoleMatrix(policy.allowedTypes)) return policy.allowedTypes as Record<TaskRole, unknown>;
  if (isRoleMatrix(policy.allowed_types)) return policy.allowed_types as unknown as Record<TaskRole, unknown>;
  if (isRoleMatrix(policy)) return policy as Record<TaskRole, unknown>;
  return null;
}

function mergePolicyRules(rules: unknown[]) {
  const normalized = rules.map(normalizePolicyRule);
  return {
    fileTypes: unique(normalized.flatMap((rule) => rule.fileTypes)) as FileType[],
    acceptValues: unique(normalized.flatMap((rule) => rule.acceptValues)),
  };
}

function resolvePolicyRule(policy: UploadPolicy | null | undefined, role?: TaskRole) {
  if (!policy || !isRecord(policy)) {
    return null;
  }

  const matrix = resolvePolicyMatrix(policy);
  if (matrix) {
    if (role && matrix[role] !== undefined) {
      return normalizePolicyRule(matrix[role]);
    }
    if (!role) {
      return mergePolicyRules(Object.values(matrix));
    }
    return null;
  }

  const directRuleKeys: Array<keyof UploadPolicyRule> = [
    "allowed_types",
    "allowedTypes",
    "mime_types",
    "mimeTypes",
    "file_types",
    "fileTypes",
    "extensions",
  ];
  if (directRuleKeys.some((key) => policy[key] !== undefined)) {
    return normalizePolicyRule(policy);
  }

  return null;
}

export function getPolicyUploadProfile(
  policy: UploadPolicy | null | undefined,
  role?: TaskRole,
  fallbackTypes: FileType[] = ALL_FILE_TYPES
): UploadPolicyProfile {
  const fallback = fallbackTypes.length > 0 ? fallbackTypes : ALL_FILE_TYPES;
  const rule = resolvePolicyRule(policy, role);
  if (!rule || (rule.fileTypes.length === 0 && rule.acceptValues.length === 0)) {
    return {
      fileTypes: fallback,
      accept: getFileTypesAccept(fallback),
      formats: [],
      constrained: false,
    };
  }

  const fileTypes = rule.fileTypes.length > 0 ? rule.fileTypes : fallback;
  const acceptValues = unique(rule.acceptValues);
  return {
    fileTypes,
    accept: acceptValues.includes("*") || acceptValues.includes("*/*")
      ? ""
      : acceptValues.length > 0
        ? accept(acceptValues)
        : getFileTypesAccept(fileTypes),
    formats: formatPolicyValues(acceptValues),
    constrained: true,
  };
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

export function getPolicyAwareTaskDeliveryRule(
  role: TaskRole,
  policy: UploadPolicy | null | undefined
): TaskDeliveryRule {
  const base = getTaskDeliveryRule(role);
  const profile = getPolicyUploadProfile(policy, role, base.fileTypes);
  return {
    ...base,
    fileTypes: profile.fileTypes,
    accept: profile.accept,
    formats: profile.constrained && profile.formats.length > 0 ? profile.formats : base.formats,
  };
}

export function getDefaultTaskFileType(role: TaskRole): FileType {
  return getTaskDeliveryRule(role).fileTypes[0] ?? "other";
}
