import { useState, useEffect, useCallback, useMemo } from "react";
import { fileApi, getErrorMessage, projectApi } from "@/lib/api";
import { cn, formatFileSize, getFileTypeLabel } from "@/lib/utils";
import { getPolicyUploadProfile } from "@/lib/taskWorkflow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileListItem } from "@/components/FileListItem";
import { LinkHistoryList } from "@/components/LinkHistoryList";
import { toast } from "sonner";
import type { FileEntity, FilePreview, FileType, FileVersion, LinkAsset, Project, TaskRole } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import {
  Search,
  FileArchive,
  FolderKanban,
  Upload,
  Loader2,
  Filter,
  Link2,
  Trash2,
  ExternalLink,
  ArrowLeft,
  Users,
} from "lucide-react";

const FILE_TYPE_OPTIONS: { value: FileType | "all"; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "video", label: "视频" },
  { value: "subtitle", label: "字幕" },
  { value: "font", label: "字体" },
  { value: "project_package", label: "工程包" },
  { value: "other", label: "其他" },
];

type ApiEnvelope<T> = { data: T };

const PROJECT_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  archived: "已归档",
  cancelled: "已取消",
  deleted: "已删除",
};

function formatShortList(items: string[], max = 8) {
  if (items.length <= max) return items.join("、");
  return `${items.slice(0, max).join("、")} 等 ${items.length} 种`;
}

const breakableTextClass = "break-words [overflow-wrap:anywhere]";

type DiffLineKind = "same" | "add" | "remove";

interface DiffLine {
  kind: DiffLineKind;
  oldLine?: number;
  newLine?: number;
  text: string;
}

function splitPreviewLines(text: string) {
  return text.split(/\r\n|\n|\r/);
}

function buildFallbackDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitPreviewLines(oldText);
  const newLines = splitPreviewLines(newText);
  const rows: DiffLine[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < max; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine) {
      rows.push({ kind: "same", oldLine: index + 1, newLine: index + 1, text: oldLine ?? "" });
      continue;
    }
    if (oldLine !== undefined) {
      rows.push({ kind: "remove", oldLine: index + 1, text: oldLine });
    }
    if (newLine !== undefined) {
      rows.push({ kind: "add", newLine: index + 1, text: newLine });
    }
  }
  return rows;
}

function buildLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = splitPreviewLines(oldText);
  const newLines = splitPreviewLines(newText);
  const cellCount = oldLines.length * newLines.length;
  if (cellCount > 250_000) {
    return buildFallbackDiff(oldText, newText);
  }

  const dp = Array.from({ length: oldLines.length + 1 }, () =>
    Array(newLines.length + 1).fill(0)
  );

  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ kind: "same", oldLine: i + 1, newLine: j + 1, text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: "remove", oldLine: i + 1, text: oldLines[i] });
      i += 1;
    } else {
      rows.push({ kind: "add", newLine: j + 1, text: newLines[j] });
      j += 1;
    }
  }
  while (i < oldLines.length) {
    rows.push({ kind: "remove", oldLine: i + 1, text: oldLines[i] });
    i += 1;
  }
  while (j < newLines.length) {
    rows.push({ kind: "add", newLine: j + 1, text: newLines[j] });
    j += 1;
  }
  return rows;
}

function versionLabel(version: FileVersion | FilePreview["version"] | null | undefined) {
  if (!version) return "当前版本";
  const parts = [`v${version.versionNumber}`];
  if (version.isCurrent) parts.push("当前");
  if (version.isLatestApproved) parts.push("已通过");
  return parts.join(" · ");
}

export function FileListPage() {
  const currentUser = useAuthStore((state) => state.user);
  const isSupervisor = useAuthStore((state) => state.isSupervisor());
  const [files, setFiles] = useState<FileEntity[]>([]);
  const [links, setLinks] = useState<LinkAsset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<FileType | "all">("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<"new" | "replace">("new");
  const [replaceTargetId, setReplaceTargetId] = useState("");
  const [uploadType, setUploadType] = useState<FileType>("other");
  const [uploadTags, setUploadTags] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [selectedFile, setSelectedFile] = useState<FileEntity | null>(null);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileEntity | null>(null);
  const [previewVersions, setPreviewVersions] = useState<FileVersion[]>([]);
  const [previewData, setPreviewData] = useState<FilePreview | null>(null);
  const [previewVersionId, setPreviewVersionId] = useState("");
  const [compareVersionId, setCompareVersionId] = useState("none");
  const [compareData, setCompareData] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkForm, setLinkForm] = useState({ name: "", url: "", extractCode: "", description: "" });
  const [addingLink, setAddingLink] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileEntity | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);

  const fetchProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await projectApi.getProjects({ include_archived: true, pageSize: 100 });
      setProjects(res.items);
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const fetchFiles = useCallback(async () => {
    if (!selectedProjectId) {
      setFiles([]);
      setLinks([]);
      return;
    }

    setFilesLoading(true);
    try {
      const res = await fileApi.getFiles({
        projectId: selectedProjectId,
        search: search || undefined,
        type: typeFilter === "all" ? undefined : typeFilter,
        tag: tagFilter || undefined,
      });
      setFiles(res.items);
      setLinks([]);
    } catch (error) {
      toast.error("获取文件列表失败: " + getErrorMessage(error));
    } finally {
      setFilesLoading(false);
    }
  }, [search, selectedProjectId, tagFilter, typeFilter]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    if (!selectedFile) {
      setVersions([]);
      return;
    }
    if (selectedFile.assetKind === "link") {
      setVersions([]);
      setVersionsLoading(false);
      return;
    }
    setVersionsLoading(true);
    fileApi.getVersions(selectedFile.id)
      .then(setVersions)
      .catch((error) => toast.error("获取版本历史失败: " + getErrorMessage(error)))
      .finally(() => setVersionsLoading(false));
  }, [selectedFile]);

  const filteredFiles = files.filter((f) => {
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (tagFilter && !f.tags.some((tag) => tag.toLowerCase().includes(tagFilter.toLowerCase()))) return false;
    if (typeFilter !== "all" && f.type !== typeFilter) return false;
    return true;
  });

  const filteredProjects = projects.filter((project) => {
    if (!projectSearch.trim()) return true;
    return project.name.toLowerCase().includes(projectSearch.trim().toLowerCase());
  });

  const selectedProject = selectedProjectId
    ? projects.find((project) => project.id === selectedProjectId)
    : null;
  const currentProjectRole = selectedProject
    ? isSupervisor
      ? "supervisor" as TaskRole
      : selectedProject.members.find((member) => member.user.id === currentUser?.id)?.role
    : undefined;
  const uploadProfile = useMemo(
    () => getPolicyUploadProfile(selectedProject?.uploadPolicy, currentProjectRole),
    [currentProjectRole, selectedProject?.uploadPolicy]
  );
  const uploadTypeOptions = useMemo(
    () => FILE_TYPE_OPTIONS.filter(
      (opt): opt is { value: FileType; label: string } =>
        opt.value !== "all" && uploadProfile.fileTypes.includes(opt.value)
    ),
    [uploadProfile.fileTypes]
  );
  const replaceTarget = files.find((file) => file.id === replaceTargetId && file.assetKind !== "link");
  const uploadAccept = uploadMode === "replace" && replaceTarget
    ? getPolicyUploadProfile(selectedProject?.uploadPolicy, currentProjectRole, [replaceTarget.type]).accept
    : uploadProfile.constrained
      ? uploadProfile.accept
      : getPolicyUploadProfile(null, undefined, [uploadType]).accept;
  const diffRows = useMemo(() => {
    if (previewData?.kind !== "text" || compareData?.kind !== "text") {
      return [];
    }
    return buildLineDiff(compareData.text ?? "", previewData.text ?? "");
  }, [compareData, previewData]);
  const previewTextLineCount = previewData?.kind === "text"
    ? splitPreviewLines(previewData.text ?? "").length
    : 0;

  const canDeleteFile = useCallback(
    (file: FileEntity) =>
      isSupervisor ||
      file.uploader.id === currentUser?.id ||
      selectedProject?.supervisorId === currentUser?.id ||
      selectedProject?.members.some(
        (member) =>
          member.user.id === currentUser?.id &&
          member.role === "supervisor"
      ) === true,
    [currentUser?.id, isSupervisor, selectedProject]
  );

  const enterProjectFiles = (projectId: string) => {
    setSelectedProjectId(projectId);
    setSearch("");
    setTagFilter("");
    setTypeFilter("all");
    setSelectedFile(null);
    setPreviewFile(null);
  };

  const leaveProjectFiles = () => {
    setSelectedProjectId(null);
    setFiles([]);
    setLinks([]);
    setSearch("");
    setTagFilter("");
    setTypeFilter("all");
    setSelectedFile(null);
    setPreviewFile(null);
  };

  useEffect(() => {
    if (uploadTypeOptions.length > 0 && !uploadTypeOptions.some((option) => option.value === uploadType)) {
      setUploadType(uploadTypeOptions[0].value);
    }
  }, [uploadType, uploadTypeOptions]);

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    if (!selectedProjectId) {
      toast.error("请先选择项目");
      return;
    }
    if (uploadMode === "replace" && !replaceTargetId) {
      toast.error("请先选择要替换的文件实体");
      return;
    }
    if (uploadMode === "new" && !uploadProfile.fileTypes.includes(uploadType)) {
      toast.error("当前项目上传策略不允许该文件类别");
      return;
    }
    setUploading(true);
    try {
      const tags = uploadTags.split(",").map((tag) => tag.trim()).filter(Boolean);
      if (uploadMode === "replace") {
        await fileApi.replaceFile(replaceTargetId, fileList[0], { changeSummary, tags });
      } else {
        await fileApi.uploadFile(fileList[0], {
          projectId: selectedProjectId,
          type: uploadType,
          tags,
          changeSummary,
        });
      }
      toast.success("文件上传成功");
      setUploadOpen(false);
      setReplaceTargetId("");
      setUploadTags("");
      setChangeSummary("");
      fetchFiles();
    } catch (error) {
      toast.error("上传失败: " + getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (file: FileEntity) => {
    try {
      if (file.assetKind === "link" && file.url) {
        window.open(file.url, "_blank");
        return;
      }
      const fileId = file.id;
      const url = await fileApi.downloadFile(fileId);
      if (url) window.open(url, "_blank");
    } catch (error) {
      toast.error("获取下载链接失败: " + getErrorMessage(error));
    }
  };

  const resetPreviewState = () => {
    setPreviewFile(null);
    setPreviewVersions([]);
    setPreviewData(null);
    setPreviewVersionId("");
    setCompareVersionId("none");
    setCompareData(null);
    setPreviewLoading(false);
    setCompareLoading(false);
  };

  const handleOpenPreview = async (file: FileEntity) => {
    if (file.assetKind === "link" && file.url) {
      window.open(file.url, "_blank");
      return;
    }

    setPreviewFile(file);
    setPreviewVersions([]);
    setPreviewData(null);
    setCompareData(null);
    setCompareVersionId("none");
    setPreviewLoading(true);
    try {
      const [versionItems, preview] = await Promise.all([
        fileApi.getVersions(file.id),
        fileApi.getPreview(file.id),
      ]);
      setPreviewVersions(versionItems);
      setPreviewData(preview);
      setPreviewVersionId(preview.version?.id || file.currentVersionId || "");
    } catch (error) {
      toast.error("加载预览失败: " + getErrorMessage(error));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePreviewVersionChange = async (versionId: string) => {
    if (!previewFile) return;
    setPreviewVersionId(versionId);
    setPreviewData(null);
    setCompareVersionId("none");
    setCompareData(null);
    setPreviewLoading(true);
    try {
      const preview = await fileApi.getPreview(previewFile.id, versionId);
      setPreviewData(preview);
      setPreviewVersionId(preview.version?.id || versionId);
    } catch (error) {
      toast.error("切换预览版本失败: " + getErrorMessage(error));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCompareVersionChange = async (versionId: string) => {
    if (!previewFile) return;
    setCompareVersionId(versionId);
    setCompareData(null);
    if (versionId === "none") return;

    setCompareLoading(true);
    try {
      const preview = await fileApi.getPreview(previewFile.id, versionId);
      if (preview.kind !== "text") {
        toast.error("选择的版本不支持文本 diff");
      }
      setCompareData(preview);
    } catch (error) {
      toast.error("加载对比版本失败: " + getErrorMessage(error));
    } finally {
      setCompareLoading(false);
    }
  };

  const handleDownloadVersion = async (fileId: string, versionId: string) => {
    try {
      const url = await fileApi.downloadVersion(fileId, versionId);
      if (url) window.open(url, "_blank");
    } catch (error) {
      toast.error("获取历史版本失败: " + getErrorMessage(error));
    }
  };

  const handleAddLink = async () => {
    if (!linkForm.name || !linkForm.url) {
      toast.error("请填写名称和链接");
      return;
    }
    if (!selectedProjectId) {
      toast.error("请先选择项目");
      return;
    }
    setAddingLink(true);
    try {
      await fileApi.createLink({ ...linkForm, projectId: selectedProjectId });
      toast.success("链接已添加");
      setLinkDialogOpen(false);
      setLinkForm({ name: "", url: "", extractCode: "", description: "" });
      fetchFiles();
    } catch (error) {
      toast.error("添加失败: " + getErrorMessage(error));
    } finally {
      setAddingLink(false);
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    try {
      await fileApi.deleteLink(linkId);
      toast.success("链接已删除");
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
    } catch (error) {
      toast.error("删除失败: " + getErrorMessage(error));
    }
  };

  const handleDeleteFile = async () => {
    if (!deleteTarget) return;
    setDeletingFile(true);
    try {
      if (deleteTarget.assetKind === "link") {
        await fileApi.deleteLink(deleteTarget.id);
        toast.success("链接已删除");
      } else {
        await fileApi.deleteFile(deleteTarget.id);
        toast.success("文件已删除");
      }
      setFiles((prev) => prev.filter((file) => file.id !== deleteTarget.id));
      if (selectedFile?.id === deleteTarget.id) {
        setSelectedFile(null);
      }
      if (previewFile?.id === deleteTarget.id) {
        resetPreviewState();
      }
      setDeleteTarget(null);
      fetchFiles();
    } catch (error) {
      toast.error("删除失败: " + getErrorMessage(error));
    } finally {
      setDeletingFile(false);
    }
  };

  const handleApproveVersion = async (versionId: string) => {
    if (!selectedFile) return;
    setVersionsLoading(true);
    try {
      await fileApi.approveVersion(selectedFile.id, versionId);
      setVersions(await fileApi.getVersions(selectedFile.id));
      toast.success("版本已审核通过");
      fetchFiles();
    } catch (error) {
      toast.error("审核失败: " + getErrorMessage(error));
    } finally {
      setVersionsLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          {selectedProject ? (
            <Button
              variant="ghost"
              size="sm"
              className="mb-2 h-8 px-0 text-gray-500 hover:text-gray-800"
              onClick={leaveProjectFiles}
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              返回项目列表
            </Button>
          ) : null}
          <h1 className="text-display text-gray-800">
            {selectedProject ? selectedProject.name : "文件"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {selectedProject
              ? `项目文件空间 · 共 ${filteredFiles.length} 个文件`
              : "选择项目后查看和管理该项目文件"}
          </p>
        </div>
        {selectedProject && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(true)}>
              <Link2 className="w-4 h-4 mr-1.5" />
              添加链接
            </Button>
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="w-4 h-4 mr-1.5" />
              上传文件
            </Button>
          </div>
        )}
      </div>

      {!selectedProject ? (
        <>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="搜索项目..."
              className="pl-9"
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
            />
          </div>

          {projectsLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
            </div>
          ) : filteredProjects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-primary-200 hover:bg-primary-50/40"
                  onClick={() => enterProjectFiles(project.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <FolderKanban className="w-4 h-4 text-primary-500 shrink-0" />
                        <h2 className="text-sm font-semibold text-gray-800 truncate">
                          {project.name}
                        </h2>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        {PROJECT_STATUS_LABEL[project.status] ?? project.status}
                      </p>
                    </div>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                      S{project.season}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {project.members.length} 成员
                    </span>
                    <span>{project.episodes} 单元</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center py-16 text-center">
                <FolderKanban className="w-10 h-10 text-gray-300" />
                <p className="text-sm text-gray-500 mt-3">暂无项目</p>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="搜索文件..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Input
              placeholder="标签过滤..."
              className="w-40"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
            />
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as FileType | "all")}>
              <SelectTrigger className="w-40">
                <Filter className="w-3.5 h-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILE_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filesLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
        </div>
          ) : (
            <>
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-h3">文件列表</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {filteredFiles.length > 0 ? (
                <div>
                  {filteredFiles.map((file) => (
                    <FileListItem
                      key={file.id}
                      file={file}
                      onPreview={() => handleOpenPreview(file)}
                      onDownload={() => handleDownload(file)}
                      onViewHistory={() => setSelectedFile(file)}
                      onDelete={canDeleteFile(file) ? () => setDeleteTarget(file) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center py-16 text-center">
                  <FileArchive className="w-10 h-10 text-gray-300" />
                  <p className="text-sm text-gray-500 mt-3">暂无文件</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Link Assets */}
          {links.length > 0 && (
            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-h3">网盘链接</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100">
                  {links.map((link) => (
                    <div
                      key={link.id}
                      className="flex items-center justify-between px-6 py-4 hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <Link2 className="w-4 h-4 text-blue-500" />
                        <div>
                          <p className="text-sm font-medium text-gray-800">{link.name}</p>
                          <p className="text-xs text-gray-500">{link.description}</p>
                          {link.extractCode && (
                            <p className="text-xs text-gray-400">提取码: {link.extractCode}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => window.open(link.url, "_blank")}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500"
                          onClick={() => handleDeleteLink(link.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
            </>
          )}
        </>
      )}

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上传文件</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={uploadMode} onValueChange={(value) => setUploadMode(value as "new" | "replace")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">新建独立文件实体（同名也不合并）</SelectItem>
                <SelectItem value="replace">显式替换已有文件</SelectItem>
              </SelectContent>
            </Select>
            {uploadMode === "replace" ? (
              <Select value={replaceTargetId} onValueChange={setReplaceTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择被替换文件" />
                </SelectTrigger>
                <SelectContent>
                  {files.filter((file) => file.assetKind !== "link").map((file) => (
                    <SelectItem key={file.id} value={file.id}>
                      {file.name} · {file.versionCount}版本
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select value={uploadType} onValueChange={(value) => setUploadType(value as FileType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {uploadTypeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className={cn("text-xs leading-5 text-gray-500", breakableTextClass)}>
              当前上传策略允许：{uploadProfile.fileTypes.map((type) => getFileTypeLabel(type)).join("、")}
              {uploadProfile.formats.length > 0 ? `；格式：${formatShortList(uploadProfile.formats, 8)}` : ""}
            </p>
            <Input
              value={uploadTags}
              onChange={(event) => setUploadTags(event.target.value)}
              placeholder="标签，用逗号分隔"
            />
            <Input
              value={changeSummary}
              onChange={(event) => setChangeSummary(event.target.value)}
              placeholder="版本变更说明"
            />
          </div>
          <div
            className={cn(
              "min-w-0 overflow-hidden rounded-lg border-2 border-dashed p-5 text-center transition-colors sm:p-8",
              dragOver ? "border-primary-500 bg-primary-50" : "border-gray-300"
            )}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
          >
            <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600">拖拽文件到此处，或</p>
            <label className="mt-2 inline-block">
              <input
                type="file"
                className="hidden"
                accept={uploadAccept}
                disabled={uploading}
                onChange={(e) => {
                  handleUpload(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
              <Button type="button" variant="outline" size="sm" asChild>
                <span>选择文件</span>
              </Button>
            </label>
          </div>
          {uploading && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="w-5 h-5 animate-spin text-primary-500 mr-2" />
              <span className="text-sm text-gray-500">上传中...</span>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Link Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加网盘链接</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">名称</label>
              <Input
                placeholder="链接名称"
                value={linkForm.name}
                onChange={(e) => setLinkForm({ ...linkForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">链接</label>
              <Input
                placeholder="https://..."
                value={linkForm.url}
                onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">提取码</label>
              <Input
                placeholder="可选"
                value={linkForm.extractCode}
                onChange={(e) => setLinkForm({ ...linkForm, extractCode: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">描述</label>
              <Input
                placeholder="可选"
                value={linkForm.description}
                onChange={(e) => setLinkForm({ ...linkForm, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>取消</Button>
            <Button onClick={handleAddLink} disabled={addingLink}>
              {addingLink && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Sheet */}
      <Sheet open={!!previewFile} onOpenChange={(open) => !open && resetPreviewState()}>
        <SheetContent className="!w-[94vw] !max-w-[94vw] overflow-y-auto p-0 sm:!max-w-[1200px]">
          <SheetHeader className="border-b border-gray-200 px-6 py-5">
            <div className="min-w-0 pr-8">
              <SheetTitle className="text-xl">在线预览</SheetTitle>
              {previewFile && (
                <p className={cn("mt-1 text-sm text-gray-500", breakableTextClass)}>
                  {previewFile.name}
                </p>
              )}
            </div>
          </SheetHeader>

          <div className="space-y-5 px-6 py-5">
            {previewFile && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <Badge variant="outline">{getFileTypeLabel(previewFile.type)}</Badge>
                {previewData?.version && <Badge variant="secondary">{versionLabel(previewData.version)}</Badge>}
                {previewData && <span>{formatFileSize(previewData.size)}</span>}
                {previewData?.mimeType && <span className={breakableTextClass}>{previewData.mimeType}</span>}
              </div>
            )}

            {previewLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
              </div>
            ) : previewData ? (
              <>
                {previewVersions.length > 0 && previewData.version && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-500">预览版本</label>
                      <Select
                        value={previewVersionId || previewData.version.id}
                        onValueChange={handlePreviewVersionChange}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {previewVersions.map((version) => (
                            <SelectItem key={version.id} value={version.id}>
                              {versionLabel(version)} · {new Date(version.createdAt).toLocaleString("zh-CN")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {previewData.kind === "text" && previewVersions.length > 1 && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500">对比版本</label>
                        <Select value={compareVersionId} onValueChange={handleCompareVersionChange}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">不对比，仅查看当前文本</SelectItem>
                            {previewVersions
                              .filter((version) => version.id !== (previewVersionId || previewData.version?.id))
                              .map((version) => (
                                <SelectItem key={version.id} value={version.id}>
                                  {versionLabel(version)} · {new Date(version.createdAt).toLocaleString("zh-CN")}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}

                {previewData.kind === "video" && (
                  <div className="space-y-3">
                    <div className="overflow-hidden rounded-lg border border-gray-900 bg-black">
                      <video
                        className="aspect-video w-full bg-black"
                        controls
                        preload="metadata"
                        src={previewData.url || previewData.downloadUrl}
                      >
                        当前浏览器不支持视频播放。
                      </video>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(previewData.downloadUrl || previewData.url, "_blank")}
                    >
                      <ExternalLink className="mr-1.5 h-4 w-4" />
                      打开播放地址
                    </Button>
                  </div>
                )}

                {previewData.kind === "text" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
                      <span>{previewTextLineCount} 行文本</span>
                      {compareLoading && (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          正在加载对比版本
                        </span>
                      )}
                    </div>

                    {compareData?.kind === "text" ? (
                      <div className="space-y-2">
                        <div className="text-xs text-gray-500">
                          {versionLabel(compareData.version)} → {versionLabel(previewData.version)}
                        </div>
                        <div className="max-h-[65vh] overflow-auto rounded-lg border border-gray-200 bg-white font-mono text-xs leading-5">
                          {diffRows.map((row, index) => (
                            <div
                              key={`${row.kind}-${row.oldLine ?? "x"}-${row.newLine ?? "x"}-${index}`}
                              className={cn(
                                "grid grid-cols-[3.5rem_3.5rem_2rem_minmax(0,1fr)] gap-2 border-b border-gray-100 px-3 py-1 last:border-0",
                                row.kind === "add" && "bg-green-50 text-green-900",
                                row.kind === "remove" && "bg-red-50 text-red-900",
                                row.kind === "same" && "text-gray-700"
                              )}
                            >
                              <span className="select-none text-right text-gray-400">{row.oldLine ?? ""}</span>
                              <span className="select-none text-right text-gray-400">{row.newLine ?? ""}</span>
                              <span className="select-none text-center text-gray-500">
                                {row.kind === "add" ? "+" : row.kind === "remove" ? "-" : ""}
                              </span>
                              <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                {row.text || " "}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <pre className="max-h-[65vh] overflow-auto rounded-lg bg-gray-950 p-4 text-xs leading-5 text-gray-100 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {previewData.text || ""}
                      </pre>
                    )}
                  </div>
                )}

                {previewData.kind === "unsupported" && (
                  <div className="space-y-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
                    <p className="text-sm font-medium text-gray-700">暂不支持在线预览</p>
                    <p className="text-sm text-gray-500">{previewData.reason || "该文件类型需要下载后查看"}</p>
                    {previewFile && (
                      <Button variant="outline" size="sm" onClick={() => handleDownload(previewFile)}>
                        下载文件
                      </Button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
                单击文件后会在这里加载预览。
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Version History Sheet */}
      <Sheet open={!!selectedFile} onOpenChange={() => setSelectedFile(null)}>
        <SheetContent className="overflow-y-auto p-0 sm:max-w-lg">
          <SheetHeader className="border-b border-gray-200 px-6 py-5">
            <SheetTitle className="text-xl">版本历史</SheetTitle>
          </SheetHeader>
          {selectedFile && (
            <div className="space-y-5 px-6 py-5">
              {selectedFile.assetKind === "link" ? (
                <LinkHistoryList file={selectedFile} />
              ) : (
                <>
                  <div className="space-y-1">
                    <p className="break-words text-base font-semibold leading-6 text-gray-900">{selectedFile.name}</p>
                    <p className="text-sm text-gray-500">共 {selectedFile.versionCount} 个版本</p>
                  </div>
                  {versionsLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
                    </div>
                  ) : versions.length > 0 ? (
                    <div className="space-y-3">
                      {versions.map((version) => (
                        <div key={version.id} className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-lg font-semibold leading-none text-gray-900">v{version.versionNumber}</span>
                            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                              {version.isCurrent && <span className="text-[10px] rounded bg-primary-50 text-primary-700 px-1.5 py-0.5">当前</span>}
                              {version.isLatestApproved && <span className="text-[10px] rounded bg-green-50 text-green-700 px-1.5 py-0.5">通过</span>}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <p className="break-words text-sm leading-5 text-gray-700">
                              {version.changeSummary || "无变更说明"}
                            </p>
                            <p className="text-xs text-gray-500">{new Date(version.createdAt).toLocaleString("zh-CN")}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleDownloadVersion(selectedFile.id, version.id)}>
                              下载此版本
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleApproveVersion(version.id)}>
                              通过此版本
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-sm text-gray-400">
                      暂无版本记录
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除文件</AlertDialogTitle>
            <AlertDialogDescription>
              删除后文件会从列表中隐藏，已有临时下载链接会立即失效，历史版本和审阅引用会保留用于追溯。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingFile}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deletingFile}
              onClick={(event) => {
                event.preventDefault();
                handleDeleteFile();
              }}
            >
              {deletingFile && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
