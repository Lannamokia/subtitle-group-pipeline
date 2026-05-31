export const VIDEO_EXTENSIONS = [
  ".mkv", ".mp4", ".mov", ".avi", ".wmv", ".flv", ".webm", ".m4v",
  ".ts", ".m2ts", ".mts", ".mpeg", ".mpg", ".ogv", ".rm", ".rmvb",
  ".3gp", ".asf", ".vob", ".mxf", ".divx", ".h264", ".h265", ".hevc",
];

export const SUBTITLE_EXTENSIONS = [
  ".ass", ".ssa", ".srt", ".vtt", ".sbv", ".sub", ".idx", ".sup",
  ".smi", ".sami", ".ttml", ".dfxp", ".stl", ".txt", ".lrc", ".xml",
];

export const FONT_EXTENSIONS = [".ttf", ".otf", ".ttc", ".woff", ".woff2", ".pfb", ".pfm"];

export const PACKAGE_EXTENSIONS = [
  ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz",
  ".psd", ".aep", ".prproj", ".veg", ".blend", ".kra", ".clip", ".aup3",
];

export const RELEASE_EXTENSIONS = [".torrent", ".nfo", ".md", ".txt", ".json", ".csv"];

export const VIDEO_MIME_TYPES = ["video/*", "application/x-matroska", "application/mp4", "application/ogg"];

export const SUBTITLE_MIME_TYPES = [
  "text/plain",
  "text/vtt",
  "application/x-ass",
  "application/ass",
  "application/ssa",
  "application/srt",
  "application/ttml+xml",
  "application/xml",
  "text/xml",
  "application/octet-stream",
];

export const FONT_MIME_TYPES = [
  "font/*",
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "application/font-sfnt",
  "application/vnd.ms-fontobject",
  "application/octet-stream",
];

export const PACKAGE_MIME_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/x-rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-bzip2",
  "application/x-xz",
  "application/octet-stream",
];

export const DEFAULT_ROLE_UPLOAD_POLICY = {
  roles: {
    source: {
      file_types: ["video", "project_package"],
      mime_types: [...VIDEO_MIME_TYPES, ...PACKAGE_MIME_TYPES],
      extensions: [...VIDEO_EXTENSIONS, ...PACKAGE_EXTENSIONS],
    },
    timing: {
      file_types: ["subtitle"],
      mime_types: SUBTITLE_MIME_TYPES,
      extensions: SUBTITLE_EXTENSIONS,
    },
    translation: {
      file_types: ["subtitle"],
      mime_types: SUBTITLE_MIME_TYPES,
      extensions: SUBTITLE_EXTENSIONS,
    },
    post_production: {
      file_types: ["subtitle", "font", "project_package"],
      mime_types: [...SUBTITLE_MIME_TYPES, ...FONT_MIME_TYPES, ...PACKAGE_MIME_TYPES],
      extensions: [...SUBTITLE_EXTENSIONS, ...FONT_EXTENSIONS, ...PACKAGE_EXTENSIONS],
    },
    encoding: {
      file_types: ["video", "project_package"],
      mime_types: [...VIDEO_MIME_TYPES, ...PACKAGE_MIME_TYPES],
      extensions: [...VIDEO_EXTENSIONS, ...PACKAGE_EXTENSIONS],
    },
    release: {
      file_types: ["video", "subtitle", "project_package", "other"],
      mime_types: [
        ...VIDEO_MIME_TYPES,
        ...SUBTITLE_MIME_TYPES,
        ...PACKAGE_MIME_TYPES,
        "application/json",
        "text/markdown",
        "application/x-bittorrent",
      ],
      extensions: [...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS, ...PACKAGE_EXTENSIONS, ...RELEASE_EXTENSIONS],
    },
    supervisor: {
      file_types: ["video", "subtitle", "font", "project_package", "other"],
      mime_types: [
        ...VIDEO_MIME_TYPES,
        ...SUBTITLE_MIME_TYPES,
        ...FONT_MIME_TYPES,
        ...PACKAGE_MIME_TYPES,
        "application/json",
        "text/markdown",
        "application/x-bittorrent",
      ],
      extensions: [...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS, ...FONT_EXTENSIONS, ...PACKAGE_EXTENSIONS, ...RELEASE_EXTENSIONS],
    },
  },
  maxSize: 536870912000,
  requireApproval: false,
  extensionWhitelist: Array.from(new Set([
    ...VIDEO_EXTENSIONS,
    ...SUBTITLE_EXTENSIONS,
    ...FONT_EXTENSIONS,
    ...PACKAGE_EXTENSIONS,
    ...RELEASE_EXTENSIONS,
  ])),
};
