import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router";
import { api, getErrorMessage } from "@/lib/api";
import { cn, getRoleLabel, getRoleColor, formatRelativeTime } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AvatarGroup, UserAvatar } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { TaskCard } from "@/components/TaskCard";
import { FileListItem } from "@/components/FileListItem";
import { TimelineEventItem } from "@/components/TimelineEvent";
import { toast } from "sonner";
import type {
  Project,
  Task,
  TaskStatus,
  FileEntity,
  FileType,
  TimelineEvent,
  WikiDocument,
  SubtitleConflict,
  User,
  TaskRole,
  WikiBlock,
  WikiStatus,
} from "@/types";
import {
  FolderKanban,
  FileArchive,
  BookOpen,
  Users,
  Settings,
  Activity,
  GitMerge,
  ArrowLeft,
  Loader2,
  Plus,
  Upload,
  CheckCircle,
  Play,
  UserCheck,
  RotateCcw,
  Archive,
  Filter,
  Search,
  Clock,
  Check,
  X,
  Megaphone,
  Send,
  Edit3,
  Table,
  Trash2,
  FileText,
} from "lucide-react";

type ProjectTab = "tasks" | "files" | "wiki" | "members" | "settings" | "activity" | "dedup" | "announcements";

const KANBAN_COLUMNS: { id: string; title: string; statuses: TaskStatus[] }[] = [
  { id: "todo", title: "待处理", statuses: ["pending_publish", "claimable", "assigned"] },
  { id: "in_progress", title: "进行中", statuses: ["in_progress", "submitted"] },
  { id: "review", title: "待审核", statuses: ["submitted"] },
  { id: "done", title: "已完成", statuses: ["review_approved", "completed"] },
];

const FILE_TYPE_OPTIONS: { value: FileType | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "video", label: "视频" },
  { value: "subtitle", label: "字幕" },
  { value: "font", label: "字体" },
  { value: "project_package", label: "工程包" },
  { value: "other", label: "其他" },
];

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const isSupervisor = useAuthStore((s) => s.isSupervisor());
  const [activeTab, setActiveTab] = useState<ProjectTab>("tasks");
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [files, setFiles] = useState<FileEntity[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [wiki, setWiki] = useState<WikiDocument | null>(null);
  const [conflicts, setConflicts] = useState<SubtitleConflict[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProject = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [projectRes, tasksRes, filesRes, eventsRes, wikiRes] = await Promise.all([
        api.get<{ data: Project }>(`/projects/${projectId}`),
        api.get<{ data: Task[] }>(`/tasks`, { params: { projectId } }),
        api.get<{ data: FileEntity[] }>(`/files`, { params: { projectId } }),
        api.get<{ data: TimelineEvent[] }>(`/timeline/project/${projectId}`),
        api.get<{ data: { wikis: WikiDocument[] } }>(`/wiki`, { params: { project_id: projectId } }).catch(() => ({ data: { data: { wikis: [] } } })),
      ]);
      setProject(projectRes.data.data);
      setTasks(tasksRes.data.data);
      setFiles(filesRes.data.data);
      setEvents(eventsRes.data.data);
      setWiki(wikiRes.data.data?.wikis?.[0] ?? null);
    } catch (error) {
      toast.error("获取项目信息失败: " + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const fetchConflicts = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.get<SubtitleConflict[]>(`/projects/${projectId}/conflicts`);
      setConflicts(res.data);
    } catch {
      // Conflicts endpoint may not exist
      setConflicts([]);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  useEffect(() => {
    if (activeTab === "dedup") {
      fetchConflicts();
    }
  }, [activeTab, fetchConflicts]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-gray-500">项目不存在</p>
        <Link to="/projects" className="text-primary-500 text-sm mt-2">
          返回项目列表
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Breadcrumb + Header */}
      <div>
        <Link
          to="/projects"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-3"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          项目
        </Link>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-display text-gray-800">{project.name}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {project.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
              <span className="text-sm text-gray-500">
                第{project.season}季 · {project.episodes}集
              </span>
              <span className="text-sm text-gray-400">
                创建于 {new Date(project.createdAt).toLocaleDateString("zh-CN")}
              </span>
            </div>
          </div>
          <AvatarGroup users={project.members.map((m) => m.user)} max={5} />
        </div>

        {/* Progress bar */}
        <div className="mt-4 flex items-center gap-4">
          <div className="flex-1">
            <Progress value={project.progress} className="h-2" />
          </div>
          <span className="text-sm font-medium text-gray-700 shrink-0">{project.progress}%</span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ProjectTab)}>
        <TabsList className="bg-transparent border-b border-gray-200 w-full justify-start rounded-none h-auto p-0 gap-0 overflow-x-auto scrollbar-thin">
          <ProjectTabTrigger value="tasks" icon={<FolderKanban className="w-4 h-4" />} active={activeTab === "tasks"}>
            任务
          </ProjectTabTrigger>
          <ProjectTabTrigger value="files" icon={<FileArchive className="w-4 h-4" />} active={activeTab === "files"}>
            文件
          </ProjectTabTrigger>
          <ProjectTabTrigger value="wiki" icon={<BookOpen className="w-4 h-4" />} active={activeTab === "wiki"}>
            Wiki
          </ProjectTabTrigger>
          <ProjectTabTrigger value="members" icon={<Users className="w-4 h-4" />} active={activeTab === "members"}>
            成员
          </ProjectTabTrigger>
          <ProjectTabTrigger value="announcements" icon={<Megaphone className="w-4 h-4" />} active={activeTab === "announcements"}>
            公告
          </ProjectTabTrigger>
          <ProjectTabTrigger value="dedup" icon={<GitMerge className="w-4 h-4" />} active={activeTab === "dedup"}>
            去重
          </ProjectTabTrigger>
          <ProjectTabTrigger value="activity" icon={<Activity className="w-4 h-4" />} active={activeTab === "activity"}>
            动态
          </ProjectTabTrigger>
          <ProjectTabTrigger value="settings" icon={<Settings className="w-4 h-4" />} active={activeTab === "settings"}>
            设置
          </ProjectTabTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-6">
          <TasksTab tasks={tasks} onUpdate={fetchProject} />
        </TabsContent>

        <TabsContent value="files" className="mt-6">
          <FilesTab files={files} projectId={projectId!} onUpdate={fetchProject} />
        </TabsContent>

        <TabsContent value="wiki" className="mt-6">
          <WikiTab wiki={wiki} projectId={projectId!} />
        </TabsContent>

        <TabsContent value="members" className="mt-6">
          <MembersTab project={project} onUpdate={fetchProject} />
        </TabsContent>

        <TabsContent value="announcements" className="mt-6">
          <ProjectAnnouncementsTab projectId={projectId!} />
        </TabsContent>

        <TabsContent value="dedup" className="mt-6">
          <DedupTab conflicts={conflicts} projectId={projectId!} isSupervisor={isSupervisor} />
        </TabsContent>

        <TabsContent value="activity" className="mt-6">
          <ActivityTab events={events} />
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <SettingsTab project={project} onUpdate={fetchProject} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------- Tab Trigger ---------- */

function ProjectTabTrigger({
  value,
  icon,
  children,
  active,
}: {
  value: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  active: boolean;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        "rounded-none border-b-2 border-transparent px-3 md:px-4 py-3 text-sm gap-1.5 data-[state=active]:shadow-none",
        active
          ? "border-primary-500 text-primary-700 font-medium data-[state=active]:bg-transparent"
          : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
      )}
    >
      {icon}
      {children}
    </TabsTrigger>
  );
}

/* ---------- Tasks Tab ---------- */

function TasksTab({ tasks, onUpdate }: { tasks: Task[]; onUpdate: () => void }) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskFilter, setTaskFilter] = useState("");
  const [updating, setUpdating] = useState(false);

  const filteredTasks = tasks.filter((t) =>
    taskFilter ? t.name.toLowerCase().includes(taskFilter.toLowerCase()) : true
  );

  const handleTaskAction = async (taskId: string, action: string) => {
    setUpdating(true);
    try {
      await api.post(`/tasks/${taskId}/${action}`);
      toast.success("操作成功");
      onUpdate();
    } catch {
      toast.error("操作失败: " + getErrorMessage(error));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="搜索任务..."
            className="pl-9"
            value={taskFilter}
            onChange={(e) => setTaskFilter(e.target.value)}
          />
        </div>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-1.5" />
          新建任务
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 md:gap-4">
        {KANBAN_COLUMNS.map((column) => {
          const columnTasks = filteredTasks.filter((t) => column.statuses.includes(t.status));
          return (
            <Card key={column.id} className="bg-gray-50/50 border-gray-200/60">
              <CardHeader className="px-4 py-3 pb-0">
                <CardTitle className="text-h3 flex items-center justify-between">
                  <span>{column.title}</span>
                  <span className="text-xs text-gray-400 font-normal bg-gray-100 px-2 py-0.5 rounded-full">
                    {columnTasks.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-3 space-y-2">
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => setSelectedTask(task)}
                  />
                ))}
                {columnTasks.length === 0 && (
                  <div className="text-center py-8 text-xs text-gray-400">暂无任务</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Task Detail Sheet */}
      <Sheet open={!!selectedTask} onOpenChange={() => setSelectedTask(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedTask && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedTask.name}</SheetTitle>
              </SheetHeader>
              <div className="space-y-6 mt-6">
                <div className="flex items-center gap-3">
                  <StatusBadge status={selectedTask.status} size="md" showIcon />
                  <span className={cn("text-caption px-2 py-0.5 rounded border", getRoleColor(selectedTask.role))}>
                    {getRoleLabel(selectedTask.role)}
                  </span>
                </div>

                {selectedTask.description && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">描述</h4>
                    <p className="text-sm text-gray-600">{selectedTask.description}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">负责人</span>
                    <div className="mt-1 flex items-center gap-2">
                      {selectedTask.assignee ? (
                        <>
                          <UserAvatar user={selectedTask.assignee} size="sm" />
                          <span>{selectedTask.assignee.username}</span>
                        </>
                      ) : (
                        <span className="text-gray-400 italic">待认领</span>
                      )}
                    </div>
                  </div>
                  {selectedTask.deadline && (
                    <div>
                      <span className="text-gray-500">截止日期</span>
                      <div className="mt-1 flex items-center gap-1 text-gray-700">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(selectedTask.deadline).toLocaleDateString("zh-CN")}
                      </div>
                    </div>
                  )}
                </div>

                {/* Task Actions */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-700">操作</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedTask.status === "claimable" && (
                      <Button
                        size="sm"
                        onClick={() => handleTaskAction(selectedTask.id, "claim")}
                        disabled={updating}
                      >
                        <UserCheck className="w-3.5 h-3.5 mr-1" />
                        认领
                      </Button>
                    )}
                    {selectedTask.status === "assigned" && (
                      <Button
                        size="sm"
                        onClick={() => handleTaskAction(selectedTask.id, "start")}
                        disabled={updating}
                      >
                        <Play className="w-3.5 h-3.5 mr-1" />
                        开始
                      </Button>
                    )}
                    {selectedTask.status === "in_progress" && (
                      <Button
                        size="sm"
                        onClick={() => handleTaskAction(selectedTask.id, "submit")}
                        disabled={updating}
                      >
                        <CheckCircle className="w-3.5 h-3.5 mr-1" />
                        提交
                      </Button>
                    )}
                    {selectedTask.status === "submitted" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTaskAction(selectedTask.id, "approve")}
                          disabled={updating}
                        >
                          <Check className="w-3.5 h-3.5 mr-1" />
                          通过
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600"
                          onClick={() => handleTaskAction(selectedTask.id, "reject")}
                          disabled={updating}
                        >
                          <X className="w-3.5 h-3.5 mr-1" />
                          驳回
                        </Button>
                      </>
                    )}
                    {(selectedTask.status === "review_rejected" || selectedTask.status === "overdue") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTaskAction(selectedTask.id, "return")}
                        disabled={updating}
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                        重新认领
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ---------- Files Tab ---------- */

function FilesTab({ files, projectId, onUpdate }: { files: FileEntity[]; projectId: string; onUpdate: () => void }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<FileType | "all">("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileEntity | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const filteredFiles = files.filter((f) => {
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== "all" && f.type !== typeFilter) return false;
    return true;
  });

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", fileList[0]);
      formData.append("projectId", projectId);
      await api.post("/files/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("文件上传成功");
      setUploadOpen(false);
      onUpdate();
    } catch {
      toast.error("上传失败: " + getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (fileId: string) => {
    try {
      const res = await api.post(`/files/${fileId}/download`);
      window.open(res.data.url, "_blank");
    } catch {
      toast.error("获取下载链接失败: " + getErrorMessage(error));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="搜索文件..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as FileType | "all")}>
            <SelectTrigger className="w-32">
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
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <Upload className="w-4 h-4 mr-1.5" />
          上传文件
        </Button>
      </div>

      <Card>
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
            <div className="text-center py-12 text-sm text-gray-400">暂无文件</div>
          )}
        </CardContent>
      </Card>

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上传文件</DialogTitle>
          </DialogHeader>
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

      {/* File History Sheet */}
      <Sheet open={!!selectedFile} onOpenChange={() => setSelectedFile(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>版本历史</SheetTitle>
          </SheetHeader>
          {selectedFile && (
            <div className="mt-6 space-y-3">
              <div className="text-sm">
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-gray-500">共 {selectedFile.versionCount} 个版本</p>
              </div>
              {/* Version list would be fetched from API */}
              <div className="text-center py-8 text-sm text-gray-400">
                版本历史详情需要从后端获取
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ---------- Wiki Tab (Enhanced) ---------- */

function WikiTab({ wiki, projectId }: { wiki: WikiDocument | null; projectId: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const [blocks, setBlocks] = useState<WikiBlock[]>(wiki?.blocks || []);
  const [title, setTitle] = useState(wiki?.title || "项目Wiki");
  const [status, setStatus] = useState<WikiStatus>(wiki?.status || "draft");
  const [saving, setSaving] = useState(false);

  const handleAddBlock = (type: WikiBlock["type"]) => {
    const newBlock: WikiBlock = {
      id: `block-${Date.now()}`,
      type,
      content: type === "markdown" ? "" : "",
      data: type === "table" ? { headers: ["列1", "列2", "列3"], rows: [["", "", ""]] } : undefined,
    };
    setBlocks((prev) => [...prev, newBlock]);
  };

  const handleUpdateBlock = (index: number, block: WikiBlock) => {
    setBlocks((prev) => prev.map((b, i) => (i === index ? block : b)));
  };

  const handleDeleteBlock = (index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/projects/${projectId}/wiki`, { title, blocks });
      setIsEditing(false);
      setStatus("approved");
      toast.success("Wiki已保存");
    } catch {
      toast.error("保存失败: " + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  // Use wiki data or fallback to mock
  const displayBlocks = blocks.length > 0 ? blocks : (wiki?.blocks || []);
  const displayTitle = title || wiki?.title || "项目Wiki";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6">
      <Card className="lg:col-span-1 h-fit">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-h3">Wiki页面</CardTitle>
        </CardHeader>
        <CardContent className="p-2 pt-0">
          <div className="space-y-0.5">
            <WikiNavItem active>项目说明</WikiNavItem>
            <WikiNavItem>角色译名表</WikiNavItem>
            <WikiNavItem>制作规范</WikiNavItem>
            <WikiNavItem>术语对照</WikiNavItem>
          </div>
          <Button variant="ghost" size="sm" className="w-full mt-2 text-primary-500">
            + 添加页面
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="flex flex-row items-center justify-between py-4 border-b">
          <div>
            <CardTitle className="text-h2">{displayTitle}</CardTitle>
            {wiki && (
              <p className="text-xs text-gray-400 mt-1">
                最后更新：{wiki.updatedBy.username} ·{" "}
                {new Date(wiki.updatedAt).toLocaleDateString("zh-CN")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={status === "approved" ? "default" : "outline"}
              className="text-xs"
            >
              {status === "approved" ? "已批准" : status === "pending" ? "待审核" : "草稿"}
            </Badge>
            {!isEditing ? (
              <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
                <Edit3 className="w-3.5 h-3.5 mr-1" />
                编辑
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>
                  <X className="w-3.5 h-3.5 mr-1" />
                  取消
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                  <Check className="w-3.5 h-3.5 mr-1" />
                  保存
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {isEditing ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">页面标题</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              {blocks.map((block, index) => (
                <div key={block.id} className="border border-gray-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px]">
                      {block.type === "markdown" ? "Markdown" : "表格"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-500"
                      onClick={() => handleDeleteBlock(index)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {block.type === "markdown" ? (
                    <Textarea
                      value={block.content}
                      onChange={(e) => handleUpdateBlock(index, { ...block, content: e.target.value })}
                      className="min-h-[100px] font-mono text-sm"
                    />
                  ) : (
                    <EditableTableBlock block={block} onChange={(b) => handleUpdateBlock(index, b)} />
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => handleAddBlock("markdown")}>
                  <FileText className="w-3.5 h-3.5 mr-1" />
                  Markdown
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleAddBlock("table")}>
                  <Table className="w-3.5 h-3.5 mr-1" />
                  表格
                </Button>
              </div>
            </div>
          ) : (
            displayBlocks.length === 0 ? (
              <div className="text-center py-12 text-sm text-gray-400">
                暂无Wiki内容，点击编辑开始添加
              </div>
            ) : (
              displayBlocks.map((block) =>
                block.type === "markdown" ? (
                  <div key={block.id} className="prose prose-sm max-w-none prose-headings:text-gray-800 prose-p:text-gray-600">
                    {block.content.split("\n").map((line, i) => {
                      if (line.startsWith("# ")) return <h1 key={i} className="text-xl font-semibold text-gray-800 mt-4 mb-2">{line.slice(2)}</h1>;
                      if (line.startsWith("## ")) return <h2 key={i} className="text-lg font-medium text-gray-700 mt-3 mb-2">{line.slice(3)}</h2>;
                      if (line.startsWith("- ")) return <li key={i} className="text-sm text-gray-600 ml-4">{line.slice(2)}</li>;
                      if (line.trim() === "") return <div key={i} className="h-2" />;
                      return <p key={i} className="text-sm text-gray-600 leading-relaxed">{line}</p>;
                    })}
                  </div>
                ) : (
                  <div key={block.id}>
                    {block.data && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-gray-50">
                              {(block.data as Record<string, string[]>).headers.map((h: string) => (
                                <th key={h} className="text-left px-3 py-2 font-medium text-gray-700 border border-gray-200">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(block.data as Record<string, string[][]>).rows.map((row: string[], i: number) => (
                              <tr key={i} className="hover:bg-gray-50">
                                {row.map((cell, j) => (
                                  <td key={j} className="px-3 py-2 text-gray-600 border border-gray-200">{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              )
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EditableTableBlock({ block, onChange }: { block: WikiBlock; onChange: (block: WikiBlock) => void }) {
  const data = (block.data as { headers: string[]; rows: string[][] }) || { headers: ["列1", "列2", "列3"], rows: [["", "", ""]] };

  const updateHeader = (index: number, value: string) => {
    const newHeaders = [...data.headers];
    newHeaders[index] = value;
    onChange({ ...block, data: { ...data, headers: newHeaders } });
  };

  const updateCell = (rowIndex: number, colIndex: number, value: string) => {
    const newRows = data.rows.map((r, i) => i === rowIndex ? r.map((c, j) => (j === colIndex ? value : c)) : r);
    onChange({ ...block, data: { ...data, rows: newRows } });
  };

  const addRow = () => {
    onChange({ ...block, data: { ...data, rows: [...data.rows, new Array(data.headers.length).fill("")] } });
  };

  const removeRow = (index: number) => {
    if (data.rows.length <= 1) return;
    onChange({ ...block, data: { ...data, rows: data.rows.filter((_, i) => i !== index) } });
  };

  const addColumn = () => {
    onChange({ ...block, data: { headers: [...data.headers, `列${data.headers.length + 1}`], rows: data.rows.map((r) => [...r, ""]) } });
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50">
              {data.headers.map((h, i) => (
                <th key={i} className="border border-gray-200 p-0">
                  <Input value={h} onChange={(e) => updateHeader(i, e.target.value)} className="border-0 rounded-none bg-transparent focus-visible:ring-0 text-sm font-medium h-8" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="border border-gray-200 p-0">
                    <Input value={cell} onChange={(e) => updateCell(ri, ci, e.target.value)} className="border-0 rounded-none bg-transparent focus-visible:ring-0 text-sm h-8" />
                  </td>
                ))}
                <td className="border-0 w-8">
                  {data.rows.length > 1 && (
                    <button onClick={() => removeRow(ri)} className="text-gray-400 hover:text-red-500 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addRow}><Plus className="w-3.5 h-3.5 mr-1" />添加行</Button>
        <Button variant="outline" size="sm" onClick={addColumn}><Plus className="w-3.5 h-3.5 mr-1" />添加列</Button>
      </div>
    </div>
  );
}

function WikiNavItem({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button className={cn("w-full text-left px-3 py-2 rounded-md text-sm transition-colors", active ? "bg-primary-50 text-primary-700 font-medium" : "text-gray-600 hover:bg-gray-50")}>
      {children}
    </button>
  );
}

/* ---------- Project Announcements Tab ---------- */

function ProjectAnnouncementsTab({ projectId }: { projectId: string }) {
  const [announcements, setAnnouncements] = useState<import("@/types").Announcement[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.post(`/projects/${projectId}/announcements`, {
        title: newTitle.trim(),
        content: newContent.trim(),
      });
      setAnnouncements((prev) => [res.data as import("@/types").Announcement, ...prev]);
      setNewTitle("");
      setNewContent("");
      setIsCreating(false);
      toast.success("公告已发布");
    } catch {
      toast.error("发布失败: " + getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-h2 text-gray-800">项目公告</h2>
        <Button size="sm" onClick={() => setIsCreating(!isCreating)}>
          {isCreating ? (
            <><X className="w-4 h-4 mr-1.5" />取消</>
          ) : (
            <><Plus className="w-4 h-4 mr-1.5" />发布公告</>
          )}
        </Button>
      </div>

      {isCreating && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">标题</label>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="输入公告标题..." className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">内容</label>
              <Textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="输入公告内容..." className="mt-1 min-h-[100px]" />
            </div>
            <div className="flex justify-end">
              <Button onClick={handleCreate} disabled={!newTitle.trim() || !newContent.trim() || submitting}>
                {submitting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                <Send className="w-4 h-4 mr-1.5" />
                发布
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {announcements.length > 0 ? (
        <div className="space-y-3">
          {announcements.map((announcement) => (
            <Card key={announcement.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Megaphone className="w-4 h-4 text-primary-500" />
                      <h3 className="text-sm font-medium text-gray-800">{announcement.title}</h3>
                    </div>
                    <p className="text-sm text-gray-600 mt-2 leading-relaxed">{announcement.content}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <UserAvatar user={announcement.createdBy} size="xs" />
                      <span className="text-xs text-gray-400">
                        {announcement.createdBy.username} · {formatRelativeTime(announcement.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Megaphone className="w-10 h-10 text-gray-300" />
            <p className="text-sm text-gray-500 mt-3">暂无项目公告</p>
            <p className="text-xs text-gray-400 mt-1">发布第一条公告通知项目成员</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ---------- Members Tab ---------- */

function MembersTab({ project, onUpdate }: { project: Project; onUpdate: () => void }) {
  const isSupervisor = useAuthStore((s) => s.isSupervisor());
  const [inviteOpen, setInviteOpen] = useState(false);
  const [joinRequests, setJoinRequests] = useState<{ id: string; user: User; role: TaskRole; message?: string }[]>([]);

  useEffect(() => {
    if (!isSupervisor) return;
    const fetchJoinRequests = async () => {
      try {
        const res = await api.get(`/projects/${project.id}/join-requests`);
        setJoinRequests(res.data);
      } catch {
        setJoinRequests([]);
      }
    };
    fetchJoinRequests();
  }, [isSupervisor, project.id]);

  const handleApproveRequest = async (requestId: string) => {
    try {
      await api.post(`/projects/${project.id}/join-requests/${requestId}/approve`);
      toast.success("已批准加入请求");
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      onUpdate();
    } catch {
      toast.error("操作失败: " + getErrorMessage(error));
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      await api.post(`/projects/${project.id}/join-requests/${requestId}/reject`);
      toast.success("已拒绝加入请求");
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch {
      toast.error("操作失败: " + getErrorMessage(error));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <CardTitle className="text-h2">项目成员</CardTitle>
          {isSupervisor && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              添加成员
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-100">
            {project.members.map((member) => (
              <div key={member.user.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-6 py-3 sm:py-4 hover:bg-gray-50 gap-2">
                <div className="flex items-center gap-3">
                  <UserAvatar user={member.user} size="md" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{member.user.username}</p>
                    <p className="text-xs text-gray-400">QQ: {member.user.qq}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Badge variant="outline" className="text-xs">
                    {getRoleLabel(member.role)}
                  </Badge>
                  <span className="text-xs text-gray-400">
                    {new Date(member.joinedAt).toLocaleDateString("zh-CN")} 加入
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Join Requests */}
      {isSupervisor && joinRequests.length > 0 && (
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-h2">加入请求</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {joinRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-3">
                    <UserAvatar user={req.user} size="sm" />
                    <div>
                      <p className="text-sm font-medium">{req.user.username}</p>
                      <p className="text-xs text-gray-500">
                        申请角色: {getRoleLabel(req.role)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => handleApproveRequest(req.id)}>
                      <Check className="w-3.5 h-3.5 mr-1" />
                      批准
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600"
                      onClick={() => handleRejectRequest(req.id)}
                    >
                      <X className="w-3.5 h-3.5 mr-1" />
                      拒绝
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>邀请成员</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">选择用户</label>
              <Input placeholder="搜索用户..." />
            </div>
            <div>
              <label className="text-sm font-medium">分配角色</label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="选择角色" />
                </SelectTrigger>
                <SelectContent>
                  {["source", "timing", "translation", "post_production", "encoding", "release"].map((r) => (
                    <SelectItem key={r} value={r}>{getRoleLabel(r as TaskRole)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>取消</Button>
            <Button>邀请</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- Dedup Tab ---------- */

function DedupTab({ conflicts, projectId, isSupervisor }: { conflicts: SubtitleConflict[]; projectId: string; isSupervisor: boolean }) {
  const [selectedConflict, setSelectedConflict] = useState<SubtitleConflict | null>(null);
  const [resolving, setResolving] = useState(false);

  const handleResolve = async (conflictId: string, resolution: { keepTranslationId?: string; mergedText?: string }) => {
    setResolving(true);
    try {
      await api.post(`/projects/${projectId}/conflicts/${conflictId}/resolve`, resolution);
      toast.success("冲突已解决");
      setSelectedConflict(null);
    } catch {
      toast.error("解决失败: " + getErrorMessage(error));
    } finally {
      setResolving(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h2 text-gray-800">字幕去重与冲突解决</h2>
          <p className="text-sm text-gray-500 mt-1">共 {conflicts.length} 个冲突待处理</p>
        </div>
      </div>

      {/* Timeline visualization placeholder */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-h3">时间轴可视化</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="h-16 bg-gray-50 rounded-lg relative overflow-hidden">
            {conflicts.map((conflict) => (
              <div
                key={conflict.id}
                className={cn(
                  "absolute h-full top-0 cursor-pointer transition-opacity hover:opacity-80",
                  conflict.conflictType === "exact_duplicate"
                    ? "bg-gray-300"
                    : conflict.conflictType === "text_conflict"
                      ? "bg-red-300"
                      : "bg-yellow-300"
                )}
                style={{
                  left: `${(conflict.startTime / 1800) * 100}%`,
                  width: `${Math.max(((conflict.endTime - conflict.startTime) / 1800) * 100, 0.5)}%`,
                }}
                onClick={() => setSelectedConflict(conflict)}
                title={`${formatTime(conflict.startTime)} - ${formatTime(conflict.endTime)}`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
            <span>00:00</span>
            <span>15:00</span>
            <span>30:00</span>
          </div>
        </CardContent>
      </Card>

      {/* Conflict list */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-h3">冲突列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-100">
            {conflicts.map((conflict) => (
              <div
                key={conflict.id}
                className="px-6 py-4 hover:bg-gray-50 cursor-pointer"
                onClick={() => setSelectedConflict(conflict)}
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">
                        {formatTime(conflict.startTime)} - {formatTime(conflict.endTime)}
                      </span>
                      <Badge
                        variant={
                          conflict.conflictType === "exact_duplicate"
                            ? "default"
                            : conflict.conflictType === "text_conflict"
                              ? "destructive"
                              : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {conflict.conflictType === "exact_duplicate"
                          ? "完全重复"
                          : conflict.conflictType === "text_conflict"
                            ? "文本冲突"
                            : "时间轴重叠"}
                      </Badge>
                    </div>
                    <div className="space-y-1 mt-2">
                      {conflict.translations.map((t) => (
                        <p key={t.translatorId} className="text-xs text-gray-500">
                          <span className="font-medium text-gray-600">{t.translatorName}:</span>{" "}
                          {t.text}
                        </p>
                      ))}
                    </div>
                  </div>
                  {isSupervisor && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); }}>
                        选择保留
                      </Button>
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); }}>
                        合并
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {conflicts.length === 0 && (
              <div className="text-center py-12 text-sm text-gray-400">暂无冲突</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Conflict Detail Sheet */}
      <Sheet open={!!selectedConflict} onOpenChange={() => setSelectedConflict(null)}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>冲突详情</SheetTitle>
          </SheetHeader>
          {selectedConflict && (
            <div className="mt-6 space-y-6">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {formatTime(selectedConflict.startTime)} - {formatTime(selectedConflict.endTime)}
                </span>
                <Badge
                  variant={
                    selectedConflict.conflictType === "exact_duplicate"
                      ? "default"
                      : selectedConflict.conflictType === "text_conflict"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {selectedConflict.conflictType === "exact_duplicate"
                    ? "完全重复"
                    : selectedConflict.conflictType === "text_conflict"
                      ? "文本冲突"
                      : "时间轴重叠"}
                </Badge>
              </div>

              <div className="space-y-3">
                {selectedConflict.translations.map((t) => (
                  <Card key={t.translatorId}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <UserAvatar user={{ id: t.translatorId, username: t.translatorName, role: "member", status: "active", createdAt: "" }} size="sm" />
                        <span className="text-sm font-medium">{t.translatorName}</span>
                      </div>
                      <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded">{t.text}</p>
                      {isSupervisor && (
                        <Button
                          size="sm"
                          className="mt-2 w-full"
                          onClick={() => handleResolve(selectedConflict.id, { keepTranslationId: t.translatorId })}
                          disabled={resolving}
                        >
                          保留此版本
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {isSupervisor && selectedConflict.conflictType === "text_conflict" && (
                <div>
                  <label className="text-sm font-medium">手动合并</label>
                  <Textarea
                    placeholder="输入合并后的文本..."
                    className="mt-1"
                    id="merged-text"
                  />
                  <Button
                    className="mt-2 w-full"
                    onClick={() => {
                      const text = (document.getElementById("merged-text") as HTMLTextAreaElement)?.value;
                      if (text) handleResolve(selectedConflict.id, { mergedText: text });
                    }}
                    disabled={resolving}
                  >
                    提交合并结果
                  </Button>
                </div>
              )}

              {isSupervisor && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleResolve(selectedConflict.id, {})}
                  disabled={resolving}
                >
                  标记为延后处理
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ---------- Activity Tab ---------- */

function ActivityTab({ events }: { events: TimelineEvent[] }) {
  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-h2">项目动态</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {events.length > 0 ? (
          <div className="space-y-0">
            {events.map((event) => (
              <TimelineEventItem key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-sm text-gray-400">暂无动态</div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Settings Tab ---------- */

function SettingsTab({ project, onUpdate }: { project: Project; onUpdate: () => void }) {
  const isSupervisor = useAuthStore((s) => s.isSupervisor());
  const [name, setName] = useState(project.name);
  const [tags, setTags] = useState(project.tags);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/projects/${project.id}`, { name, tags });
      toast.success("设置已保存");
      onUpdate();
    } catch {
      toast.error("保存失败: " + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await api.post(`/projects/${project.id}/archive`);
      toast.success("项目已归档");
      onUpdate();
    } catch {
      toast.error("归档失败: " + getErrorMessage(error));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="max-w-full md:max-w-2xl space-y-6 px-0">
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2">项目设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">项目名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isSupervisor}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">标签</label>
            <Input
              value={tags.join(", ")}
              onChange={(e) => setTags(e.target.value.split(",").map((t) => t.trim()).filter(Boolean))}
              disabled={!isSupervisor}
              placeholder="用逗号分隔"
            />
          </div>
          {isSupervisor && (
            <div className="pt-4 flex items-center gap-3">
              <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={handleArchive} disabled={archiving}>
                {archiving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                <Archive className="w-4 h-4 mr-1.5" />
                归档项目
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                保存设置
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
