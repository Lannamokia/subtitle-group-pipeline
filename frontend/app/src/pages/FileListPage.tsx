import { useState, useEffect, useCallback } from "react";
import { api, fileApi, getErrorMessage, projectApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { FileListItem } from "@/components/FileListItem";
import { toast } from "sonner";
import type { FileEntity, FileType, FileVersion, LinkAsset, Project } from "@/types";
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

export function FileListPage() {
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
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkForm, setLinkForm] = useState({ name: "", url: "", extractCode: "", description: "" });
  const [addingLink, setAddingLink] = useState(false);

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
      setLinks(await fileApi.getLinks({ projectId: selectedProjectId }));
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

  const enterProjectFiles = (projectId: string) => {
    setSelectedProjectId(projectId);
    setSearch("");
    setTagFilter("");
    setTypeFilter("all");
    setSelectedFile(null);
  };

  const leaveProjectFiles = () => {
    setSelectedProjectId(null);
    setFiles([]);
    setLinks([]);
    setSearch("");
    setTagFilter("");
    setTypeFilter("all");
    setSelectedFile(null);
  };

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

  const handleDownload = async (fileId: string) => {
    try {
      const res = await api.post(`/files/${fileId}/download`);
      window.open(res.data.data?.url ?? res.data.data?.downloadUrl, "_blank");
    } catch (error) {
      toast.error("获取下载链接失败: " + getErrorMessage(error));
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
      setLinks(await fileApi.getLinks({ projectId: selectedProjectId }));
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
                      onDownload={() => handleDownload(file.id)}
                      onViewHistory={() => setSelectedFile(file)}
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
                  {files.map((file) => (
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
                  {FILE_TYPE_OPTIONS.filter((opt) => opt.value !== "all").map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
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
                onChange={(e) => handleUpload(e.target.files)}
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

      {/* Version History Sheet */}
      <Sheet open={!!selectedFile} onOpenChange={() => setSelectedFile(null)}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>版本历史</SheetTitle>
          </SheetHeader>
          {selectedFile && (
            <div className="mt-6 space-y-3">
              <div className="text-sm">
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-gray-500">共 {selectedFile.versionCount} 个版本</p>
              </div>
              {versionsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
                </div>
              ) : versions.length > 0 ? (
                <div className="space-y-2">
                  {versions.map((version) => (
                    <div key={version.id} className="rounded-md border border-gray-200 p-3 text-sm space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">v{version.versionNumber}</span>
                        <div className="flex items-center gap-1">
                          {version.isCurrent && <span className="text-[10px] rounded bg-primary-50 text-primary-700 px-1.5 py-0.5">当前</span>}
                          {version.isLatestApproved && <span className="text-[10px] rounded bg-green-50 text-green-700 px-1.5 py-0.5">通过</span>}
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">
                        {version.changeSummary || "无变更说明"} · {new Date(version.createdAt).toLocaleString("zh-CN")}
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleDownload(selectedFile.id)}>
                          下载
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
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
