import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router";
import {
  announcementApi,
  api,
  fileApi,
  getErrorMessage,
  normalizeAnnouncement,
  normalizeConflict,
  normalizeFile,
  normalizeProject,
  normalizeTask,
  normalizeTimelineEvent,
  normalizeUser,
  memberApi,
  projectApi,
  taskApi,
  wikiApi,
} from "@/lib/api";
import {
  getPolicyAwareTaskDeliveryRule,
  getPolicyUploadProfile,
  TASK_PIPELINE_ROLES,
  TASK_WORKFLOW_STEPS,
} from "@/lib/taskWorkflow";
import { cn, getFileTypeLabel, getRoleLabel, getRoleColor, formatRelativeTime } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AvatarGroup, UserAvatar } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { TaskCard } from "@/components/TaskCard";
import { FileListItem } from "@/components/FileListItem";
import { LinkHistoryList } from "@/components/LinkHistoryList";
import { TimelineEventItem } from "@/components/TimelineEvent";
import { DeliveryChecklistEditor } from "@/components/DeliveryChecklistEditor";
import { TaskCommentPanel } from "@/components/TaskCommentPanel";
import { toast } from "sonner";
import type {
  Project,
  ProjectUnit,
  Task,
  TaskStatus,
  FileEntity,
  FileType,
  FileVersion,
  TimelineEvent,
  WikiDocument,
  SubtitleConflict,
  User,
  TaskRole,
  TranslationClaim,
  ProductOutputConfig,
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
  Link2,
  Megaphone,
  Send,
  Edit3,
  Table,
  Trash2,
  FileText,
  ListOrdered,
} from "lucide-react";

type ProjectTab = "tasks" | "files" | "wiki" | "members" | "settings" | "activity" | "dedup" | "announcements";

type ApiEnvelope<T> = { data: T };

type WikiPageKey = "project-overview" | "role-names" | "production-guide" | "term-glossary";

const WIKI_PAGE_TITLES: Record<WikiPageKey, string> = {
  "project-overview": "项目说明",
  "role-names": "角色译名表",
  "production-guide": "制作规范",
  "term-glossary": "术语对照",
};

const DEFAULT_WIKI_PAGE_IDS = Object.keys(WIKI_PAGE_TITLES) as WikiPageKey[];
const UNASSIGNED_SELECT_VALUE = "__unassigned__";
const UNASSIGNED_UNIT_SELECT_VALUE = "__project__";
const TASK_TEMPLATE_CUSTOM_VALUE = "__custom__";

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
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
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
        projectApi.getProject(projectId),
        taskApi.getTasks({ projectId }),
        fileApi.getFiles({ projectId }),
        api.get<ApiEnvelope<{ events: unknown[] }>>(`/timeline/project/${projectId}`),
        wikiApi.getWiki(projectId).catch(() => null),
      ]);
      setProject(projectRes);
      const mergedTasks = projectRes.tasks?.length ? projectRes.tasks : tasksRes;
      setTasks(mergedTasks);
      setSelectedUnitId((current) => {
        if (!current) return null;
        return projectRes.units?.some((unit) => unit.id === current) ? current : null;
      });
      setFiles(filesRes.items);
      setEvents((eventsRes.data.data.events ?? []).map((event) => normalizeTimelineEvent(event as Record<string, unknown>)));
      setWiki(wikiRes);
    } catch (error) {
      toast.error("获取项目信息失败: " + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const fetchConflicts = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await api.get<ApiEnvelope<unknown[]>>(`/projects/${projectId}/conflicts`);
      setConflicts(res.data.data.map((conflict) => normalizeConflict(conflict as Record<string, unknown>)));
    } catch (error) {
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
          <TasksTab
            project={project}
            tasks={tasks}
            selectedUnitId={selectedUnitId}
            onSelectUnit={setSelectedUnitId}
            onUpdate={fetchProject}
          />
        </TabsContent>

        <TabsContent value="files" className="mt-6">
          <FilesTab files={files} project={project} onUpdate={fetchProject} />
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

function getUnitTitle(unit: ProjectUnit) {
  return unit.title || `第 ${unit.season} 季 第 ${unit.episode} 集`;
}

function isCompletedTask(task: Task) {
  return task.status === "completed" || task.status === "review_approved";
}

function isActiveTask(task: Task) {
  return ["assigned", "in_progress", "submitted"].includes(task.status);
}

function isPipelineActiveTask(task: Task) {
  return ["claimable", "assigned", "in_progress", "submitted", "review_rejected", "overdue"].includes(task.status);
}

function sortTasksByCreatedAtDesc(a: Task, b: Task) {
  return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
}

function findPipelinePredecessor(tasks: Task[], unitId: string | null, role: TaskRole) {
  const roleIndex = TASK_PIPELINE_ROLES.indexOf(role as Exclude<TaskRole, "supervisor">);
  if (roleIndex <= 0) return null;

  const previousRoles = TASK_PIPELINE_ROLES.slice(0, roleIndex).reverse();
  for (const previousRole of previousRoles) {
    const candidate = tasks
      .filter((task) => task.unitId === unitId && task.role === previousRole)
      .sort(sortTasksByCreatedAtDesc)[0];
    if (candidate) return candidate;
  }
  return null;
}

function getTaskTemplateValue(role: Exclude<TaskRole, "supervisor">, title: string) {
  return `${role}:${title}`;
}

function formatShortList(items: string[], max = 8) {
  if (items.length <= max) return items.join("、");
  return `${items.slice(0, max).join("、")} 等 ${items.length} 种`;
}

const breakableTextClass = "break-words [overflow-wrap:anywhere]";

function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "未设置";
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function ProductOutputRequirement({
  title,
  output,
}: {
  title: string;
  output: ProductOutputConfig;
}) {
  const items: Array<{ label: string; value: string }> = [
    { label: "分辨率", value: output.resolution },
    { label: "帧率", value: output.frameRate },
    { label: "编码器", value: output.encoder },
    { label: "编码器预设", value: output.encoderPreset },
    { label: "码率", value: output.videoBitrate },
    { label: "成片大小", value: output.targetSize },
    { label: "音频编码方式", value: output.audioCodec },
    { label: "音频码率", value: output.audioBitrate },
    { label: "音频声道数", value: output.audioChannels },
  ];

  return (
    <div className="min-w-0 overflow-hidden rounded-md bg-white px-3 py-2">
      <p className="text-xs font-semibold text-gray-700">{title}</p>
      <div className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="flex min-w-0 justify-between gap-2 rounded bg-gray-50 px-2 py-1.5">
            <span className="shrink-0 text-gray-500">{item.label}</span>
            <span className={cn("min-w-0 text-right text-gray-700", breakableTextClass)}>{item.value || "-"}</span>
          </div>
        ))}
      </div>
      {output.extraParams && (
        <div className="mt-2 rounded bg-gray-50 px-2 py-1.5 text-xs">
          <p className="text-gray-500">额外参数</p>
          <p className="mt-1 break-all font-mono text-gray-700">{output.extraParams}</p>
        </div>
      )}
    </div>
  );
}

function EpisodeListView({
  units,
  tasks,
  onSelectUnit,
  onCreateTask,
}: {
  units: ProjectUnit[];
  tasks: Task[];
  onSelectUnit: (unitId: string) => void;
  onCreateTask: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-h2 text-gray-800">分集列表</h2>
          <p className="mt-1 text-sm text-gray-500">先选择分集，再进入该集的任务看板。</p>
        </div>
        <Button size="sm" onClick={onCreateTask}>
          <Plus className="w-4 h-4 mr-1.5" />
          新建任务
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {units.map((unit) => {
          const unitTasks = tasks.filter((task) => task.unitId === unit.id);
          const completed = unitTasks.filter((task) => ["completed", "review_approved"].includes(task.status)).length;
          const progress = unitTasks.length > 0 ? Math.round((completed / unitTasks.length) * 100) : unit.progress;
          const activeCount = unitTasks.filter((task) => ["assigned", "in_progress", "submitted"].includes(task.status)).length;

          return (
            <button
              key={unit.id}
              type="button"
              onClick={() => onSelectUnit(unit.id)}
              className="rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-primary-200 hover:bg-primary-50/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{getUnitTitle(unit)}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    第 {unit.season} 季 · 第 {unit.episode} 集
                  </p>
                </div>
                <Badge variant="outline" className="text-xs">
                  {unitTasks.length || unit.taskCount || 0} 个任务
                </Badge>
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>完成进度</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                <span>{completed} 已完成</span>
                <span>{activeCount} 进行中</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TasksTab({
  project,
  tasks,
  selectedUnitId,
  onSelectUnit,
  onUpdate,
}: {
  project: Project;
  tasks: Task[];
  selectedUnitId: string | null;
  onSelectUnit: (unitId: string | null) => void;
  onUpdate: () => void | Promise<void>;
}) {
  const isSupervisor = useAuthStore((s) => s.isSupervisor());
  const currentUser = useAuthStore((s) => s.user);
  const canManageTasks =
    isSupervisor ||
    currentUser?.id === project.supervisorId ||
    project.members.some((member) => member.user.id === currentUser?.id && member.role === "supervisor");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<Task | null>(null);
  const [resetTaskTarget, setResetTaskTarget] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingTask, setDeletingTask] = useState(false);
  const [resettingTask, setResettingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskUnitId, setNewTaskUnitId] = useState(UNASSIGNED_UNIT_SELECT_VALUE);
  const [newTaskRole, setNewTaskRole] = useState<TaskRole>("translation");
  const [newTaskTemplateKey, setNewTaskTemplateKey] = useState(TASK_TEMPLATE_CUSTOM_VALUE);
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [taskFilter, setTaskFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<TaskRole | "all">("all");
  const [updating, setUpdating] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [taskUploadType, setTaskUploadType] = useState<FileType>("subtitle");
  const [taskUploadTags, setTaskUploadTags] = useState("");
  const [taskUploadSummary, setTaskUploadSummary] = useState("");
  const [taskSubmitMode, setTaskSubmitMode] = useState<"file" | "link">("file");
  const [taskLinkName, setTaskLinkName] = useState("");
  const [taskLinkUrl, setTaskLinkUrl] = useState("");
  const [taskLinkExtractCode, setTaskLinkExtractCode] = useState("");
  const [taskLinkDescription, setTaskLinkDescription] = useState("");
  const [sourceEpisodeLength, setSourceEpisodeLength] = useState<number | "">("");
  const [taskUploading, setTaskUploading] = useState(false);
  const [taskDragOver, setTaskDragOver] = useState(false);
  const [segmentStart, setSegmentStart] = useState<number | "">("");
  const [segmentEnd, setSegmentEnd] = useState<number | "">("");
  const [claimingSegment, setClaimingSegment] = useState(false);
  const [abandoningClaimId, setAbandoningClaimId] = useState<string | null>(null);
  const units = project.units ?? [];
  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) ?? null;
  const scopedTasks = selectedUnitId
    ? tasks.filter((task) => task.unitId === selectedUnitId)
    : tasks.filter((task) => !task.unitId);

  const filteredTasks = scopedTasks.filter((task) => {
    if (roleFilter !== "all" && task.role !== roleFilter) return false;
    if (taskFilter && !task.name.toLowerCase().includes(taskFilter.toLowerCase())) return false;
    return true;
  });

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const blockedDependencies = (task: Task) =>
    task.dependencies
      .map((depId) => taskById.get(depId))
      .filter((dep): dep is Task => Boolean(dep))
      .filter((dep) => !["review_approved", "completed"].includes(dep.status));
  const returnableStatuses: TaskStatus[] = ["assigned", "in_progress", "review_rejected", "overdue"];
  const resettableStatuses: TaskStatus[] = [
    "assigned",
    "in_progress",
    "submitted",
    "review_rejected",
    "completed",
    "review_approved",
    "overdue",
    "frozen",
  ];
  const selectedTaskAssigneeId = selectedTask?.assigneeId ?? selectedTask?.assignee?.id;
  const selectedTaskUnit = selectedTask?.unitId
    ? units.find((unit) => unit.id === selectedTask.unitId) ?? null
    : null;
  const selectedTaskClaims = selectedTask?.claims ?? [];
  const activeSelectedTaskClaims = selectedTaskClaims.filter((claim) =>
    ["pending", "active"].includes(claim.status)
  );
  const activeSelectedTaskClaimSeconds = activeSelectedTaskClaims.reduce(
    (sum, claim) => sum + Math.max(0, claim.segmentEnd - claim.segmentStart),
    0
  );
  const selectedTaskClaimCoverage = selectedTaskUnit?.episodeLength
    ? Math.min(100, Math.round((activeSelectedTaskClaimSeconds / selectedTaskUnit.episodeLength) * 100))
    : null;
  const canReturnSelectedTask = Boolean(
    selectedTask &&
      returnableStatuses.includes(selectedTask.status) &&
      (selectedTaskAssigneeId === currentUser?.id || canManageTasks)
  );
  const selectedTaskDeliveryRule = useMemo(
    () => selectedTask ? getPolicyAwareTaskDeliveryRule(selectedTask.role, project.uploadPolicy) : null,
    [project.uploadPolicy, selectedTask?.id, selectedTask?.role]
  );
  const selectedTaskAllowsLink = Boolean(
    selectedTask && ["source", "encoding"].includes(selectedTask.role)
  );
  const selectedTaskRequiresSourceLength = selectedTask?.role === "source";
  const workflowSummaries = TASK_WORKFLOW_STEPS.map((step) => {
    const roleTasks = filteredTasks
      .filter((task) => task.role === step.role)
      .sort(sortTasksByCreatedAtDesc);
    const activeCount = roleTasks.filter(isActiveTask).length;
    const completedCount = roleTasks.filter(isCompletedTask).length;
    const isComplete = roleTasks.length > 0 && roleTasks.every(isCompletedTask);
    const isActive = roleTasks.some(isPipelineActiveTask) && !isComplete;
    return { step, roleTasks, activeCount, completedCount, isComplete, isActive };
  });
  const highlightedStepIndex = (() => {
    const activeIndex = workflowSummaries.findIndex((summary) => summary.isActive);
    if (activeIndex >= 0) return activeIndex;
    const firstIncompleteIndex = workflowSummaries.findIndex((summary) => !summary.isComplete);
    return firstIncompleteIndex >= 0 ? firstIncompleteIndex : workflowSummaries.length - 1;
  })();

  useEffect(() => {
    if (!selectedTask || !selectedTaskDeliveryRule) return;
    setTaskUploadType((current) =>
      selectedTaskDeliveryRule.fileTypes.includes(current)
        ? current
        : selectedTaskDeliveryRule.fileTypes[0] ?? "other"
    );
    setTaskUploadTags("");
    setTaskUploadSummary("");
    setTaskSubmitMode("file");
    setTaskLinkName("");
    setTaskLinkUrl("");
    setTaskLinkExtractCode("");
    setTaskLinkDescription("");
    setSourceEpisodeLength(selectedTaskUnit?.episodeLength ?? "");
    setTaskDragOver(false);
  }, [selectedTask?.id, selectedTaskDeliveryRule, selectedTaskUnit?.episodeLength]);

  useEffect(() => {
    setSegmentStart("");
    setSegmentEnd("");
    setAbandoningClaimId(null);
  }, [selectedTask?.id]);

  const refreshTaskDetail = async (taskId: string) => {
    const freshTask = await taskApi.getTask(taskId);
    setSelectedTask(freshTask);
    await onUpdate();
  };

  const handleOpenTask = async (task: Task) => {
    setSelectedTask(task);
    try {
      const freshTask = await taskApi.getTask(task.id);
      setSelectedTask(freshTask);
    } catch {
      // The list item is still usable if the detail request races with a reload.
    }
  };

  const handleTaskAction = async (task: Task, action: string) => {
    setUpdating(true);
    try {
      if (action === "claim") await taskApi.claimTask(task.id);
      if (action === "start") await taskApi.startTask(task.id);
      if (action === "submit") await taskApi.submitTask(task.id);
      if (action === "return") await taskApi.returnTask(task.id);
      if (action === "approve") await taskApi.approveTask(task.id, reviewComment || undefined);
      if (action === "reject") await taskApi.rejectTask(task.id, reviewComment || undefined);
      toast.success("操作成功");
      setReviewComment("");
      setSelectedTask(null);
      onUpdate();
    } catch (error) {
      toast.error("操作失败: " + getErrorMessage(error));
    } finally {
      setUpdating(false);
    }
  };

  const handleClaimSegment = async () => {
    if (!selectedTask) return;
    if (segmentStart === "" || segmentEnd === "") {
      toast.error("请填写认领起止时间");
      return;
    }
    if (segmentStart >= segmentEnd) {
      toast.error("结束时间必须大于开始时间");
      return;
    }

    setClaimingSegment(true);
    try {
      await taskApi.claimSegment(selectedTask.id, {
        segmentStart: Number(segmentStart),
        segmentEnd: Number(segmentEnd),
      });
      toast.success("已认领翻译时间段");
      setSegmentStart("");
      setSegmentEnd("");
      await refreshTaskDetail(selectedTask.id);
    } catch (error) {
      toast.error("认领失败: " + getErrorMessage(error));
    } finally {
      setClaimingSegment(false);
    }
  };

  const handleAbandonSegment = async (claim: TranslationClaim) => {
    if (!selectedTask) return;
    setAbandoningClaimId(claim.id);
    try {
      await taskApi.abandonSegment(selectedTask.id, claim.id);
      toast.success("已释放翻译时间段");
      await refreshTaskDetail(selectedTask.id);
    } catch (error) {
      toast.error("释放失败: " + getErrorMessage(error));
    } finally {
      setAbandoningClaimId(null);
    }
  };

  const handleAssignTask = async () => {
    if (!selectedTask || !assigneeId) return;
    setUpdating(true);
    try {
      await taskApi.assignTask(selectedTask.id, assigneeId, overrideReason || undefined);
      toast.success("任务已指派");
      setAssigneeId("");
      setOverrideReason("");
      setSelectedTask(null);
      onUpdate();
    } catch (error) {
      toast.error(
        "指派失败: " +
          getErrorMessage(error) +
          (overrideReason ? "" : "；若是依赖阻塞，请填写覆盖原因后由监制处理")
      );
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteTask = async () => {
    if (!deleteTaskTarget) return;
    setDeletingTask(true);
    try {
      await taskApi.deleteTask(deleteTaskTarget.id);
      toast.success("任务已删除");
      if (selectedTask?.id === deleteTaskTarget.id) {
        setSelectedTask(null);
      }
      setDeleteTaskTarget(null);
      onUpdate();
    } catch (error) {
      toast.error("删除任务失败: " + getErrorMessage(error));
    } finally {
      setDeletingTask(false);
    }
  };

  const handleResetTask = async () => {
    if (!resetTaskTarget) return;
    setResettingTask(true);
    try {
      await taskApi.resetTask(resetTaskTarget.id, resetReason.trim() || undefined);
      toast.success("任务已重置，受影响的下游任务已联动处理");
      if (selectedTask?.id === resetTaskTarget.id) {
        setSelectedTask(null);
      }
      setResetTaskTarget(null);
      setResetReason("");
      onUpdate();
    } catch (error) {
      toast.error("重置任务失败: " + getErrorMessage(error));
    } finally {
      setResettingTask(false);
    }
  };

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim()) {
      toast.error("任务标题不能为空");
      return;
    }
    if (units.length > 0 && newTaskUnitId === UNASSIGNED_UNIT_SELECT_VALUE) {
      toast.error("请选择任务归属分集");
      return;
    }

    setCreating(true);
    try {
      const createdTask = await taskApi.createTask({
        project_id: project.id,
        unit_id: newTaskUnitId === UNASSIGNED_UNIT_SELECT_VALUE ? null : newTaskUnitId,
        title: newTaskTitle.trim(),
        role: newTaskRole,
        assignee_id: newTaskAssigneeId || null,
        due_date: newTaskDueDate ? new Date(newTaskDueDate).toISOString() : null,
        description: newTaskDescription.trim() || null,
      } as Partial<Task> & Record<string, unknown>);
      const dependencyUnitId = newTaskUnitId === UNASSIGNED_UNIT_SELECT_VALUE ? null : newTaskUnitId;
      const predecessor = findPipelinePredecessor(tasks, dependencyUnitId, newTaskRole);
      if (predecessor && predecessor.id !== createdTask.id) {
        await taskApi.createDependency(createdTask.id, predecessor.id);
      }
      toast.success(predecessor ? "任务已创建，并已串联前置任务" : "任务已创建");
      setCreateOpen(false);
      setNewTaskTitle("");
      setNewTaskUnitId(selectedUnitId ?? units[0]?.id ?? UNASSIGNED_UNIT_SELECT_VALUE);
      setNewTaskRole("translation");
      setNewTaskTemplateKey(TASK_TEMPLATE_CUSTOM_VALUE);
      setNewTaskAssigneeId("");
      setNewTaskDueDate("");
      setNewTaskDescription("");
      onUpdate();
    } catch (error) {
      toast.error("创建任务失败: " + getErrorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const applyTaskTemplate = (value: string) => {
    setNewTaskTemplateKey(value);
    if (value === TASK_TEMPLATE_CUSTOM_VALUE) return;

    const step = TASK_WORKFLOW_STEPS.find((item) =>
      item.templates.some((template) => getTaskTemplateValue(item.role, template.title) === value)
    );
    const template = step?.templates.find((item) => getTaskTemplateValue(step.role, item.title) === value);
    if (!step || !template) return;

    setNewTaskRole(step.role);
    setNewTaskTitle(template.title);
    setNewTaskDescription(template.description);
  };

  const openCreateTaskDialog = () => {
    setNewTaskUnitId(selectedUnitId ?? units[0]?.id ?? UNASSIGNED_UNIT_SELECT_VALUE);
    setNewTaskTitle("");
    setNewTaskDescription("");
    setNewTaskTemplateKey(TASK_TEMPLATE_CUSTOM_VALUE);
    setNewTaskAssigneeId("");
    setNewTaskDueDate("");
    setCreateOpen(true);
  };

  const handleTaskUpload = async (fileList: FileList | null) => {
    if (!selectedTask || !fileList || fileList.length === 0) return;
    if (selectedTaskRequiresSourceLength && (sourceEpisodeLength === "" || Number(sourceEpisodeLength) <= 0)) {
      toast.error("请填写片源时长");
      return;
    }
    setTaskUploading(true);
    try {
      const tags = taskUploadTags.split(",").map((tag) => tag.trim()).filter(Boolean);
      await fileApi.uploadFile(fileList[0], {
        projectId: project.id,
        taskId: selectedTask.id,
        unitId: selectedTask.unitId,
        role: selectedTask.role,
        type: taskUploadType,
        tags,
        changeSummary: taskUploadSummary,
        episodeLength: selectedTaskRequiresSourceLength ? Number(sourceEpisodeLength) : undefined,
      });
      toast.success("任务文件已上传");
      setTaskUploadTags("");
      setTaskUploadSummary("");
      onUpdate();
    } catch (error) {
      toast.error("任务文件上传失败: " + getErrorMessage(error));
    } finally {
      setTaskUploading(false);
    }
  };

  const handleTaskLinkSubmit = async () => {
    if (!selectedTask || !selectedTaskAllowsLink) return;
    if (!taskLinkUrl.trim()) {
      toast.error("请填写网盘链接");
      return;
    }
    if (selectedTaskRequiresSourceLength && (sourceEpisodeLength === "" || Number(sourceEpisodeLength) <= 0)) {
      toast.error("请填写片源时长");
      return;
    }

    setTaskUploading(true);
    try {
      const tags = taskUploadTags.split(",").map((tag) => tag.trim()).filter(Boolean);
      await fileApi.createLink({
        projectId: project.id,
        taskId: selectedTask.id,
        unitId: selectedTask.unitId,
        role: selectedTask.role,
        type: taskUploadType,
        tags,
        name: taskLinkName.trim() || `${getRoleLabel(selectedTask.role)}网盘链接`,
        url: taskLinkUrl.trim(),
        extractCode: taskLinkExtractCode.trim() || undefined,
        description: taskLinkDescription.trim() || taskUploadSummary.trim() || undefined,
        episodeLength: selectedTaskRequiresSourceLength ? Number(sourceEpisodeLength) : undefined,
      });
      toast.success("网盘链接已提交");
      setTaskUploadTags("");
      setTaskUploadSummary("");
      setTaskLinkName("");
      setTaskLinkUrl("");
      setTaskLinkExtractCode("");
      setTaskLinkDescription("");
      onUpdate();
    } catch (error) {
      toast.error("提交网盘链接失败: " + getErrorMessage(error));
    } finally {
      setTaskUploading(false);
    }
  };

  const createTaskDialog = (
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">任务标题</label>
            <Input
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              placeholder="输入任务标题"
            />
          </div>
          {units.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">归属分集</label>
              <Select value={newTaskUnitId} onValueChange={setNewTaskUnitId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择任务归属分集" />
                </SelectTrigger>
                <SelectContent>
                  {units.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {getUnitTitle(unit)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">任务角色</label>
              <Select
                value={newTaskRole}
                onValueChange={(value) => {
                  setNewTaskRole(value as TaskRole);
                  setNewTaskTemplateKey(TASK_TEMPLATE_CUSTOM_VALUE);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["source", "timing", "translation", "post_production", "encoding", "release", "supervisor"].map((role) => (
                    <SelectItem key={role} value={role}>
                      {getRoleLabel(role as TaskRole)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">负责人</label>
              <Select
                value={newTaskAssigneeId || UNASSIGNED_SELECT_VALUE}
                onValueChange={(value) =>
                  setNewTaskAssigneeId(value === UNASSIGNED_SELECT_VALUE ? "" : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="暂不分配" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_SELECT_VALUE}>暂不分配</SelectItem>
                  {project.members.map((member) => (
                    <SelectItem key={member.user.id} value={member.user.id}>
                      {member.user.nickname || member.user.username} · {getRoleLabel(member.role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">任务模板</label>
            <Select value={newTaskTemplateKey} onValueChange={applyTaskTemplate}>
              <SelectTrigger>
                <SelectValue placeholder="选择任务模板" />
              </SelectTrigger>
              <SelectContent className="max-h-[360px]">
                <SelectItem value={TASK_TEMPLATE_CUSTOM_VALUE}>自定义任务</SelectItem>
                {TASK_WORKFLOW_STEPS.map((step) => (
                  <SelectGroup key={step.role}>
                    <SelectLabel>{getRoleLabel(step.role)}</SelectLabel>
                    {step.templates.map((template) => (
                      <SelectItem
                        key={getTaskTemplateValue(step.role, template.title)}
                        value={getTaskTemplateValue(step.role, template.title)}
                      >
                        {template.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">截止日期</label>
            <Input
              type="datetime-local"
              value={newTaskDueDate}
              onChange={(event) => setNewTaskDueDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">描述</label>
            <Textarea
              value={newTaskDescription}
              onChange={(event) => setNewTaskDescription(event.target.value)}
              placeholder="任务说明（可选）"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
            取消
          </Button>
          <Button onClick={handleCreateTask} disabled={creating}>
            {creating && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            创建任务
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (!selectedUnitId && units.length > 0) {
    return (
      <>
        <EpisodeListView
          units={units}
          tasks={tasks}
          onSelectUnit={onSelectUnit}
          onCreateTask={() => openCreateTaskDialog()}
        />
        {createTaskDialog}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
          {selectedUnit && (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-center sm:w-auto sm:shrink-0"
              onClick={() => onSelectUnit(null)}
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              返回集列表
            </Button>
          )}
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-7 text-gray-800 break-words sm:text-h2">
              {selectedUnit ? getUnitTitle(selectedUnit) : "未分集任务"}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {selectedUnit ? "管理当前分集下的制作任务" : "管理没有绑定到分集的项目任务"}
            </p>
          </div>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto] lg:w-auto lg:min-w-[520px]">
          <div className="relative min-w-0 lg:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="搜索任务..."
              className="w-full pl-9"
              value={taskFilter}
              onChange={(e) => setTaskFilter(e.target.value)}
            />
          </div>
          <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as TaskRole | "all")}>
            <SelectTrigger>
              <SelectValue placeholder="岗位" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部岗位</SelectItem>
              {TASK_WORKFLOW_STEPS.map((step) => (
                <SelectItem key={step.role} value={step.role}>
                  {getRoleLabel(step.role)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="w-full sm:w-auto" onClick={() => openCreateTaskDialog()}>
            <Plus className="w-4 h-4 mr-1.5" />
            新建任务
          </Button>
        </div>
      </div>

      <Card className="border-gray-200/80">
        <CardHeader className="px-4 py-4">
          <CardTitle className="text-base">串行制作流水线</CardTitle>
          <p className="text-xs text-gray-500">从片源到发布按岗位串联，展示当前分集任务进度。</p>
        </CardHeader>
        <CardContent className="space-y-5 px-4 pb-4">
          <div className="overflow-x-auto pb-2">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-6" role="list" aria-label="制作流水线进度">
                {workflowSummaries.map((summary, index) => {
                  const isHighlighted = index === highlightedStepIndex;
                  const isDone = summary.isComplete;
                  const previousStep = workflowSummaries[index - 1];
                  const connectorFill = previousStep?.isComplete
                    ? summary.isComplete
                      ? "w-full"
                      : summary.activeCount > 0
                        ? "w-1/2"
                        : "w-0"
                    : "w-0";
                  return (
                    <div
                      key={summary.step.role}
                      className="relative flex min-w-0 flex-col items-center text-center"
                      role="listitem"
                    >
                      {index > 0 && (
                        <div className="absolute right-1/2 top-6 h-1 w-full -translate-y-1/2 rounded-full bg-gray-200 md:top-7">
                          <div
                            className={cn(
                              "h-full rounded-full bg-primary-500 transition-all duration-500 ease-out",
                              connectorFill
                            )}
                          />
                        </div>
                      )}
                      <div
                        className={cn(
                          "relative z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 bg-white text-base font-semibold shadow-sm transition-colors md:h-14 md:w-14 md:text-lg",
                          isDone && "border-primary-500 bg-primary-500 text-white shadow-primary-100",
                          isHighlighted && !isDone && "border-primary-500 text-primary-600 ring-4 ring-primary-50",
                          !isDone && !isHighlighted && "border-gray-300 text-gray-400"
                        )}
                        aria-current={isHighlighted ? "step" : undefined}
                      >
                        {index + 1}
                      </div>
                      <div className="mt-5 min-w-0 max-w-[132px]">
                        <p
                          className={cn(
                            "text-base font-semibold",
                            isDone || isHighlighted ? "text-gray-900" : "text-gray-400"
                          )}
                        >
                          {getRoleLabel(summary.step.role)}
                        </p>
                        <p
                          className={cn(
                            "mt-1 text-xs leading-5",
                            isDone || isHighlighted ? "text-gray-600" : "text-gray-400"
                          )}
                        >
                          {summary.step.deliverables[0]}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {workflowSummaries.map(({ step, roleTasks, activeCount, completedCount, isComplete, isActive }) => {
            return (
              <Card key={step.role} className="bg-gray-50/60 border-gray-200/70">
                <CardHeader className="px-3 py-3 pb-0">
                  <CardTitle className="flex items-start justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="block text-[11px] font-normal text-gray-400">
                        {isComplete ? "步骤已完成" : isActive ? "正在推进" : "等待前序"}
                      </span>
                      <span>{getRoleLabel(step.role)}</span>
                    </span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{roleTasks.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 p-3">
                  <div className="grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="rounded-md bg-white px-2 py-1.5">
                      <p className="font-semibold text-gray-800">{activeCount}</p>
                      <p className="text-[10px] text-gray-500">进行中</p>
                    </div>
                    <div className="rounded-md bg-white px-2 py-1.5">
                      <p className="font-semibold text-gray-800">{completedCount}</p>
                      <p className="text-[10px] text-gray-500">完成</p>
                    </div>
                  </div>
                  <div className="min-w-0 overflow-hidden rounded-md bg-white px-2 py-2 text-[11px] text-gray-500">
                    <p className="font-medium text-gray-600">可提交</p>
                    <p className={cn("mt-1 leading-5", breakableTextClass)}>{formatShortList(step.formats, 5)}</p>
                  </div>
                  <div className="space-y-2">
                    {roleTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onClick={() => handleOpenTask(task)}
                      />
                    ))}
                    {roleTasks.length === 0 && (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-white py-8 text-center text-xs text-gray-400">
                        暂无任务
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
          );
        })}
          </div>
        </CardContent>
      </Card>

      {/* Task Detail Sheet */}
      <Sheet open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <SheetContent className="w-[min(100vw,560px)] max-w-[100vw] overflow-y-auto px-4 sm:px-6">
          {selectedTask && (
            <>
              <SheetHeader className="px-0 pr-8">
                <SheetTitle className="break-words text-xl">{selectedTask.name}</SheetTitle>
              </SheetHeader>
              <div className="mt-6 min-w-0 space-y-6">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <StatusBadge status={selectedTask.status} size="md" showIcon />
                  <span className={cn("text-caption rounded border px-2 py-0.5", getRoleColor(selectedTask.role))}>
                    {getRoleLabel(selectedTask.role)}
                  </span>
                </div>

                {selectedTask.description && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">描述</h4>
                    <p className="text-sm text-gray-600">{selectedTask.description}</p>
                  </div>
                )}

                {selectedTaskDeliveryRule && (
                  <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/70 p-3">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700">岗位交付要求</h4>
                      <p className="mt-1 text-xs leading-5 text-gray-500">{selectedTaskDeliveryRule.guidance}</p>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {selectedTaskDeliveryRule.deliverables.map((item) => (
                        <Badge
                          key={item}
                          variant="outline"
                          className={cn("max-w-full whitespace-normal bg-white text-center text-[10px] font-normal", breakableTextClass)}
                        >
                          {item}
                        </Badge>
                      ))}
                    </div>
                    <div className="grid gap-2 text-xs sm:grid-cols-2">
                      <div className="min-w-0 overflow-hidden rounded-md bg-white px-3 py-2">
                        <p className="font-medium text-gray-600">文件类别</p>
                        <p className={cn("mt-1 text-gray-500", breakableTextClass)}>
                          {selectedTaskDeliveryRule.fileTypes.map((type) => getFileTypeLabel(type)).join("、")}
                        </p>
                      </div>
                      <div className="min-w-0 overflow-hidden rounded-md bg-white px-3 py-2">
                        <p className="font-medium text-gray-600">常用格式</p>
                        <p className={cn("mt-1 text-gray-500", breakableTextClass)}>
                          {formatShortList(selectedTaskDeliveryRule.formats, 6)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {selectedTask.role === "encoding" && project.productConfig && (
                  <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/70 p-3">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700">成品配置</h4>
                      <div className="mt-2 rounded-md bg-white px-3 py-2 text-xs">
                        <p className="font-medium text-gray-600">命名规则</p>
                        <p className="mt-1 break-all font-mono text-gray-700">{project.productConfig.namingRule}</p>
                      </div>
                    </div>
                    <ProductOutputRequirement title="内封成品" output={project.productConfig.outputs.muxed} />
                    <ProductOutputRequirement title="内嵌成品" output={project.productConfig.outputs.burned} />
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

                {selectedTask.dependencies.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-700">依赖状态</h4>
                    <div className="space-y-2">
                      {selectedTask.dependencies.map((depId) => {
                        const dep = taskById.get(depId);
                        const done = dep ? ["review_approved", "completed"].includes(dep.status) : false;
                        return (
                          <div key={depId} className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2 text-xs">
                            <span className="text-gray-600 truncate">{dep?.name ?? depId}</span>
                            <Badge variant={done ? "default" : "outline"} className="text-[10px]">
                              {done ? "已满足" : "阻塞中"}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                    {blockedDependencies(selectedTask).length > 0 && (
                      <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md px-3 py-2">
                        前置任务未完成，后续领取或开始会被依赖规则阻止。
                      </p>
                    )}
                  </div>
                )}

                {selectedTask.role === "translation" && (
                  <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-medium text-gray-800">分段认领</h4>
                        <p className="mt-1 text-xs leading-5 text-gray-500">
                          翻译任务需要按时间段认领，时间单位为秒。
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 bg-white text-[10px]">
                        {selectedTaskClaimCoverage === null ? "时长未设置" : `${selectedTaskClaimCoverage}% 已认领`}
                      </Badge>
                    </div>
                    <div className="grid gap-2 text-xs sm:grid-cols-3">
                      <div className="rounded-md bg-white px-3 py-2">
                        <p className="font-medium text-gray-600">本集时长</p>
                        <p className="mt-1 text-gray-500">{formatDuration(selectedTaskUnit?.episodeLength)}</p>
                      </div>
                      <div className="rounded-md bg-white px-3 py-2">
                        <p className="font-medium text-gray-600">已认领</p>
                        <p className="mt-1 text-gray-500">{formatDuration(activeSelectedTaskClaimSeconds)}</p>
                      </div>
                      <div className="rounded-md bg-white px-3 py-2">
                        <p className="font-medium text-gray-600">有效片段</p>
                        <p className="mt-1 text-gray-500">{activeSelectedTaskClaims.length} 段</p>
                      </div>
                    </div>
                    {activeSelectedTaskClaims.length > 0 ? (
                      <div className="space-y-2">
                        {activeSelectedTaskClaims.map((claim) => {
                          const isOwnClaim = claim.userId === currentUser?.id;
                          return (
                            <div key={claim.id} className="flex flex-col gap-2 rounded-md bg-white px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="font-medium text-gray-700">
                                  {formatDuration(claim.segmentStart)} - {formatDuration(claim.segmentEnd)}
                                </p>
                                <p className="mt-0.5 truncate text-gray-500">
                                  {claim.user?.nickname || claim.user?.username || "未知成员"} · {formatDuration(claim.segmentEnd - claim.segmentStart)}
                                </p>
                              </div>
                              {isOwnClaim && ["pending", "active"].includes(claim.status) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 w-full text-xs sm:w-auto"
                                  onClick={() => handleAbandonSegment(claim)}
                                  disabled={abandoningClaimId === claim.id}
                                >
                                  {abandoningClaimId === claim.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                  释放
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-blue-200 bg-white py-5 text-center text-xs text-gray-400">
                        还没有人认领时间段
                      </div>
                    )}
                    {["claimable", "assigned", "in_progress", "submitted"].includes(selectedTask.status) && (
                      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <Input
                          type="number"
                          min={0}
                          value={segmentStart}
                          onChange={(event) => setSegmentStart(event.target.value === "" ? "" : Number(event.target.value))}
                          placeholder="开始秒数"
                        />
                        <Input
                          type="number"
                          min={0}
                          value={segmentEnd}
                          onChange={(event) => setSegmentEnd(event.target.value === "" ? "" : Number(event.target.value))}
                          placeholder="结束秒数"
                        />
                        <Button
                          size="sm"
                          onClick={handleClaimSegment}
                          disabled={claimingSegment}
                        >
                          {claimingSegment && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                          认领时间段
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {isSupervisor && (
                  <div className="min-w-0 space-y-2">
                    <h4 className="text-sm font-medium text-gray-700">监制指派</h4>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                      <Select value={assigneeId} onValueChange={setAssigneeId}>
                        <SelectTrigger className="min-w-0 flex-1">
                          <SelectValue placeholder="选择负责人" />
                        </SelectTrigger>
                        <SelectContent>
                          {project.members.map((member) => (
                            <SelectItem key={member.user.id} value={member.user.id}>
                              {member.user.nickname || member.user.username} · {getRoleLabel(member.role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        className="w-full shrink-0 sm:w-auto"
                        onClick={handleAssignTask}
                        disabled={!assigneeId || updating}
                      >
                        <UserCheck className="w-3.5 h-3.5 mr-1" />
                        指派
                      </Button>
                    </div>
                    <Input
                      value={overrideReason}
                      onChange={(event) => setOverrideReason(event.target.value)}
                      placeholder="依赖覆盖原因（可选）"
                    />
                  </div>
                )}

                {selectedTask.status === "submitted" && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-700">审核意见</h4>
                    <Textarea
                      value={reviewComment}
                      onChange={(event) => setReviewComment(event.target.value)}
                      placeholder="填写通过或驳回说明..."
                    />
                  </div>
                )}

                {selectedTaskDeliveryRule && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-medium text-gray-700">提交任务文件</h4>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {getRoleLabel(selectedTask.role)}
                      </Badge>
                    </div>
                    {selectedTaskAllowsLink && (
                      <div className="grid grid-cols-2 rounded-md border border-gray-200 bg-gray-50 p-1 text-xs">
                        <Button
                          type="button"
                          size="sm"
                          variant={taskSubmitMode === "file" ? "default" : "ghost"}
                          className="h-8"
                          onClick={() => setTaskSubmitMode("file")}
                        >
                          <Upload className="mr-1.5 h-3.5 w-3.5" />
                          上传文件
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={taskSubmitMode === "link" ? "default" : "ghost"}
                          className="h-8"
                          onClick={() => setTaskSubmitMode("link")}
                        >
                          <Link2 className="mr-1.5 h-3.5 w-3.5" />
                          网盘链接
                        </Button>
                      </div>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Select value={taskUploadType} onValueChange={(value) => setTaskUploadType(value as FileType)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedTaskDeliveryRule.fileTypes.map((type) => (
                            <SelectItem key={type} value={type}>
                              {getFileTypeLabel(type)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={taskUploadTags}
                        onChange={(event) => setTaskUploadTags(event.target.value)}
                        placeholder="标签，用逗号分隔"
                      />
                    </div>
                    {selectedTaskRequiresSourceLength && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-600">片源时长（秒，必填）</label>
                        <Input
                          type="number"
                          min={1}
                          value={sourceEpisodeLength}
                          onChange={(event) =>
                            setSourceEpisodeLength(event.target.value === "" ? "" : Number(event.target.value))
                          }
                          placeholder="片源时长（秒，必填）"
                        />
                        <p className="text-xs text-gray-500">
                          该时长会写入当前分集，后续翻译分段认领会按此时长校验。
                        </p>
                      </div>
                    )}
                    <Input
                      value={taskUploadSummary}
                      onChange={(event) => setTaskUploadSummary(event.target.value)}
                      placeholder="提交说明或版本变更说明"
                    />
                    {taskSubmitMode === "link" && selectedTaskAllowsLink ? (
                      <div className="space-y-3 rounded-lg border border-dashed border-blue-200 bg-blue-50/50 p-3">
                        <Input
                          value={taskLinkName}
                          onChange={(event) => setTaskLinkName(event.target.value)}
                          placeholder="链接名称（可选）"
                        />
                        <Input
                          value={taskLinkUrl}
                          onChange={(event) => setTaskLinkUrl(event.target.value)}
                          placeholder="https://..."
                        />
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input
                            value={taskLinkExtractCode}
                            onChange={(event) => setTaskLinkExtractCode(event.target.value)}
                            placeholder="提取码（可选）"
                          />
                          <Input
                            value={taskLinkDescription}
                            onChange={(event) => setTaskLinkDescription(event.target.value)}
                            placeholder="链接说明（可选）"
                          />
                        </div>
                        <Button type="button" size="sm" onClick={handleTaskLinkSubmit} disabled={taskUploading}>
                          {taskUploading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                          提交网盘链接
                        </Button>
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "min-w-0 overflow-hidden rounded-lg border-2 border-dashed p-4 text-center transition-colors sm:p-5",
                          taskDragOver ? "border-primary-500 bg-primary-50" : "border-gray-300 bg-white"
                        )}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setTaskDragOver(true);
                        }}
                        onDragLeave={() => setTaskDragOver(false)}
                        onDrop={(event) => {
                          event.preventDefault();
                          setTaskDragOver(false);
                          handleTaskUpload(event.dataTransfer.files);
                        }}
                      >
                        <Upload className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                        <p className="text-sm text-gray-600">拖拽符合岗位要求的文件到此处</p>
                        <p className={cn("mx-auto mt-1 max-w-full text-xs leading-5 text-gray-400", breakableTextClass)}>
                          支持：{formatShortList(selectedTaskDeliveryRule.formats, 8)}
                        </p>
                        <label className="mt-3 inline-block">
                          <input
                            type="file"
                            className="hidden"
                            accept={selectedTaskDeliveryRule.accept}
                            disabled={taskUploading}
                            onChange={(event) => {
                              handleTaskUpload(event.target.files);
                              event.currentTarget.value = "";
                            }}
                          />
                          <Button type="button" variant="outline" size="sm" asChild disabled={taskUploading}>
                            <span>
                              {taskUploading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                              选择文件
                            </span>
                          </Button>
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* Task Actions */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-700">操作</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedTask.status === "claimable" && selectedTask.role !== "translation" && (
                      <Button
                        size="sm"
                        onClick={() => handleTaskAction(selectedTask, "claim")}
                        disabled={updating}
                      >
                        <UserCheck className="w-3.5 h-3.5 mr-1" />
                        认领
                      </Button>
                    )}
                    {selectedTask.status === "assigned" && (
                      <Button
                        size="sm"
                        onClick={() => handleTaskAction(selectedTask, "start")}
                        disabled={updating}
                      >
                        <Play className="w-3.5 h-3.5 mr-1" />
                        开始
                      </Button>
                    )}
                    {selectedTask.status === "in_progress" && (
                      <Button
                        size="sm"
                        onClick={() => handleTaskAction(selectedTask, "submit")}
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
                          onClick={() => handleTaskAction(selectedTask, "approve")}
                          disabled={updating}
                        >
                          <Check className="w-3.5 h-3.5 mr-1" />
                          通过
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600"
                          onClick={() => handleTaskAction(selectedTask, "reject")}
                          disabled={updating}
                        >
                          <X className="w-3.5 h-3.5 mr-1" />
                          驳回
                        </Button>
                      </>
                    )}
                    {canReturnSelectedTask && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTaskAction(selectedTask, "return")}
                        disabled={updating}
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                        {selectedTaskAssigneeId === currentUser?.id ? "退回任务" : "退回可认领"}
                      </Button>
                    )}
                    {canManageTasks && resettableStatuses.includes(selectedTask.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setResetTaskTarget(selectedTask);
                          setResetReason("");
                        }}
                        disabled={updating || resettingTask}
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                        重置为进行中
                      </Button>
                    )}
                    {canManageTasks && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setDeleteTaskTarget(selectedTask)}
                        disabled={updating || deletingTask}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        删除任务
                      </Button>
                    )}
                  </div>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <TaskCommentPanel taskId={selectedTask.id} projectId={project.id} />
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTaskTarget} onOpenChange={(open) => !open && setDeleteTaskTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除任务</AlertDialogTitle>
            <AlertDialogDescription>
              删除后该任务会从任务列表中移除，并清理任务依赖关系。若该任务已经开始或已有提交、审核、评论记录，相关记录会随任务删除或解除关联，下游任务会按依赖联动重置。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingTask}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deletingTask}
              onClick={(event) => {
                event.preventDefault();
                handleDeleteTask();
              }}
            >
              {deletingTask && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!resetTaskTarget}
        onOpenChange={(open) => {
          if (!open) {
            setResetTaskTarget(null);
            setResetReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认重置任务状态</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-gray-600">
                <p>
                  任务会回到进行中状态。它后续已经开始、提交或完成的任务会被联动重置；发布任务的旧发布产物会被丢弃。
                </p>
                <Textarea
                  value={resetReason}
                  onChange={(event) => setResetReason(event.target.value)}
                  placeholder="重置原因（可选）"
                  className="mt-2"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resettingTask}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={resettingTask}
              onClick={(event) => {
                event.preventDefault();
                handleResetTask();
              }}
            >
              {resettingTask && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              确认重置
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {createTaskDialog}
    </div>
  );
}

/* ---------- Files Tab ---------- */

function FilesTab({ files, project, onUpdate }: { files: FileEntity[]; project: Project; onUpdate: () => void }) {
  const currentUser = useAuthStore((state) => state.user);
  const isSupervisor = useAuthStore((state) => state.isSupervisor());
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
  const currentProjectRole = isSupervisor
    ? "supervisor" as TaskRole
    : project.members.find((member) => member.user.id === currentUser?.id)?.role;
  const uploadProfile = useMemo(
    () => getPolicyUploadProfile(project.uploadPolicy, currentProjectRole),
    [currentProjectRole, project.uploadPolicy]
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
    ? getPolicyUploadProfile(project.uploadPolicy, currentProjectRole, [replaceTarget.type]).accept
    : uploadProfile.constrained
      ? uploadProfile.accept
      : getPolicyUploadProfile(null, undefined, [uploadType]).accept;

  const filteredFiles = files.filter((f) => {
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (tagFilter && !f.tags.some((tag) => tag.toLowerCase().includes(tagFilter.toLowerCase()))) return false;
    if (typeFilter !== "all" && f.type !== typeFilter) return false;
    return true;
  });

  useEffect(() => {
    if (uploadTypeOptions.length > 0 && !uploadTypeOptions.some((option) => option.value === uploadType)) {
      setUploadType(uploadTypeOptions[0].value);
    }
  }, [uploadType, uploadTypeOptions]);

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

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
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
          projectId: project.id,
          type: uploadType,
          tags,
          changeSummary,
        });
      }
      toast.success("文件上传成功");
      setUploadOpen(false);
      setReplaceTargetId("");
      setChangeSummary("");
      setUploadTags("");
      onUpdate();
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

  const handleDownloadVersion = async (fileId: string, versionId: string) => {
    try {
      const url = await fileApi.downloadVersion(fileId, versionId);
      if (url) window.open(url, "_blank");
    } catch (error) {
      toast.error("获取历史版本失败: " + getErrorMessage(error));
    }
  };

  const handleApproveVersion = async (file: FileEntity, versionId: string) => {
    setVersionsLoading(true);
    try {
      await fileApi.approveVersion(file.id, versionId);
      setVersions(await fileApi.getVersions(file.id));
      toast.success("版本已审核通过");
      onUpdate();
    } catch (error) {
      toast.error("审核失败: " + getErrorMessage(error));
    } finally {
      setVersionsLoading(false);
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
          <Input
            placeholder="按标签过滤..."
            className="w-40"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          />
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
                  onDownload={() => handleDownload(file)}
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

      {/* File History Sheet */}
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
                            <div className="text-lg font-semibold leading-none text-gray-900">v{version.versionNumber}</div>
                            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                              {version.isCurrent && <Badge variant="default" className="text-[10px]">当前</Badge>}
                              {version.isLatest && <Badge variant="outline" className="text-[10px]">最新</Badge>}
                              {version.isLatestApproved && <Badge variant="outline" className="text-[10px]">已锁版</Badge>}
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
                            <Button size="sm" variant="outline" onClick={() => handleApproveVersion(selectedFile, version.id)}>
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
    </div>
  );
}

/* ---------- Wiki Tab (Enhanced) ---------- */

function WikiTab({ wiki, projectId }: { wiki: WikiDocument | null; projectId: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const [blocks, setBlocks] = useState<WikiBlock[]>(wiki?.blocks || []);
  const [title, setTitle] = useState(wiki?.title || "项目Wiki");
  const [status, setStatus] = useState<WikiStatus>(wiki?.status || "draft");
  const [activePageId, setActivePageId] = useState<string>("project-overview");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBlocks(wiki?.blocks || []);
    setTitle(wiki?.title || "项目Wiki");
    setStatus(wiki?.status || "draft");
  }, [wiki]);

  const getBlockPageId = (block: WikiBlock) =>
    typeof block.data?.pageId === "string" ? block.data.pageId : "project-overview";

  const getPageTitle = (pageId: string) =>
    typeof WIKI_PAGE_TITLES[pageId as WikiPageKey] === "string"
      ? WIKI_PAGE_TITLES[pageId as WikiPageKey]
      : String(blocks.find((block) => getBlockPageId(block) === pageId)?.data?.pageTitle ?? pageId);

  const pageIds = Array.from(new Set([...DEFAULT_WIKI_PAGE_IDS, ...blocks.map(getBlockPageId)]));
  const activePageTitle = getPageTitle(activePageId);
  const activeBlocks = blocks.filter((block) => getBlockPageId(block) === activePageId);

  const handleAddBlock = (type: WikiBlock["type"]) => {
    const newBlock: WikiBlock = {
      id: `block-${Date.now()}`,
      type,
      content: type === "markdown" ? "" : "",
      data: {
        pageId: activePageId,
        pageTitle: activePageTitle,
        ...(type === "table" ? { headers: ["列1", "列2", "列3"], rows: [["", "", ""]] } : {}),
      },
    };
    setBlocks((prev) => [...prev, newBlock]);
  };

  const handleUpdateBlock = (blockId: string, block: WikiBlock) => {
    setBlocks((prev) => prev.map((b) => (b.id === blockId ? block : b)));
  };

  const handleDeleteBlock = (blockId: string) => {
    setBlocks((prev) => prev.filter((block) => block.id !== blockId));
  };

  const handleAddPage = () => {
    const name = `新页面 ${pageIds.filter((id) => id.startsWith("custom-")).length + 1}`;
    const pageId = `custom-${Date.now()}`;
    setActivePageId(pageId);
    setIsEditing(true);
    setBlocks((prev) => [
      ...prev,
      {
        id: `block-${Date.now()}`,
        type: "markdown",
        content: "",
        data: { pageId, pageTitle: name },
      },
    ]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = wiki
        ? await wikiApi.updateWiki(wiki.id, { title, blocks })
        : await wikiApi.createWiki({ projectId, title, blocks, status: "draft" });
      setBlocks(updated.blocks);
      setTitle(updated.title);
      setStatus(updated.status);
      setIsEditing(false);
      toast.success("Wiki已保存");
    } catch (error) {
      toast.error("保存失败: " + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  // Keep the active editor state in sync with the loaded wiki document.
  const displayBlocks = activeBlocks;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6">
      <Card className="lg:col-span-1 h-fit">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-h3">Wiki页面</CardTitle>
        </CardHeader>
        <CardContent className="p-2 pt-0">
          <div className="space-y-0.5">
            {pageIds.map((pageId) => (
              <WikiNavItem
                key={pageId}
                active={activePageId === pageId}
                onClick={() => setActivePageId(pageId)}
              >
                {getPageTitle(pageId)}
              </WikiNavItem>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="w-full mt-2 text-primary-500" onClick={handleAddPage}>
            + 添加页面
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader className="flex flex-row items-center justify-between py-4 border-b">
          <div>
            <CardTitle className="text-h2">{activePageTitle}</CardTitle>
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
                <Input value={activePageTitle} disabled />
              </div>
              {activeBlocks.map((block) => (
                <div key={block.id} className="border border-gray-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px]">
                      {block.type === "markdown" ? "Markdown" : "表格"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-500"
                      onClick={() => handleDeleteBlock(block.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {block.type === "markdown" ? (
                    <Textarea
                      value={block.content}
                      onChange={(e) => handleUpdateBlock(block.id, { ...block, content: e.target.value })}
                      className="min-h-[100px] font-mono text-sm"
                    />
                  ) : (
                    <EditableTableBlock block={block} onChange={(b) => handleUpdateBlock(block.id, b)} />
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

function WikiNavItem({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn("w-full text-left px-3 py-2 rounded-md text-sm transition-colors", active ? "bg-primary-50 text-primary-700 font-medium" : "text-gray-600 hover:bg-gray-50")}
      onClick={onClick}
    >
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

  useEffect(() => {
    announcementApi.getAnnouncements({ type: "project", projectId })
      .then(setAnnouncements)
      .catch(() => {});
  }, [projectId]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    setSubmitting(true);
    try {
      const created = await announcementApi.createAnnouncement({
        type: "project",
        projectId,
        title: newTitle.trim(),
        content: newContent.trim(),
      });
      setAnnouncements((prev) => [created, ...prev]);
      setNewTitle("");
      setNewContent("");
      setIsCreating(false);
      toast.success("公告已发布");
    } catch (error) {
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
  const [users, setUsers] = useState<User[]>([]);
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteRole, setInviteRole] = useState<TaskRole>("translation");
  const [inviting, setInviting] = useState(false);
  const [joinRequests, setJoinRequests] = useState<{ id: string; user: User; role: TaskRole; message?: string }[]>([]);

  useEffect(() => {
    if (!isSupervisor) return;
    const fetchJoinRequests = async () => {
      try {
        const res = await api.get<ApiEnvelope<unknown[]>>(`/projects/${project.id}/join-requests`);
        setJoinRequests(res.data.data.map((request) => {
          const raw = request as Record<string, unknown>;
          return {
            id: String(raw.id),
            user: normalizeUser((raw.user ?? {}) as Record<string, unknown>),
            role: raw.role as TaskRole,
            message: raw.message as string | undefined,
          };
        }));
      } catch {
        setJoinRequests([]);
      }
    };
    fetchJoinRequests();
  }, [isSupervisor, project.id]);

  useEffect(() => {
    if (!isSupervisor || !inviteOpen) return;
    memberApi.getMembers({ pageSize: 100 })
      .then((data) => setUsers(data.items))
      .catch(() => setUsers([]));
  }, [inviteOpen, isSupervisor]);

  const existingMemberIds = new Set(project.members.map((member) => member.user.id));
  const availableUsers = users.filter((user) => !existingMemberIds.has(user.id) && user.status !== "disabled");

  const handleApproveRequest = async (requestId: string) => {
    try {
      await api.post(`/projects/${project.id}/join-requests/${requestId}/approve`);
      toast.success("已批准加入请求");
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      onUpdate();
    } catch (error) {
      toast.error("操作失败: " + getErrorMessage(error));
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      await api.post(`/projects/${project.id}/join-requests/${requestId}/reject`);
      toast.success("已拒绝加入请求");
      setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (error) {
      toast.error("操作失败: " + getErrorMessage(error));
    }
  };

  const handleInviteMember = async () => {
    if (!inviteUserId) {
      toast.error("请选择用户");
      return;
    }

    setInviting(true);
    try {
      await projectApi.addMember(project.id, { userId: inviteUserId, role: inviteRole });
      toast.success("成员已添加");
      setInviteOpen(false);
      setInviteUserId("");
      setInviteRole("translation");
      onUpdate();
    } catch (error) {
      toast.error("添加成员失败: " + getErrorMessage(error));
    } finally {
      setInviting(false);
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
                    <p className="text-sm font-medium text-gray-800">{member.user.nickname || member.user.username}</p>
                    <p className="text-xs text-gray-400">QQ: {member.user.qq || "-"}</p>
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
              <Select value={inviteUserId} onValueChange={setInviteUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择用户" />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.nickname || user.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">分配角色</label>
              <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as TaskRole)}>
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
            <Button onClick={handleInviteMember} disabled={!inviteUserId || inviting}>
              {inviting && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              邀请
            </Button>
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
    } catch (error) {
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedConflict(conflict);
                        }}
                      >
                        选择保留
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedConflict(conflict);
                        }}
                      >
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

type UnitDeletionImpact = {
  unit_id: string;
  season_number: number;
  unit_number: number;
  title?: string | null;
  task_count: number;
  active_task_count: number;
  claim_count: number;
  submission_count: number;
  review_count: number;
  comment_count: number;
  notification_count: number;
  file_count: number;
  merge_job_count: number;
  conflict_count: number;
  is_empty: boolean;
};

function getUnitDeletionErrorDetails(error: unknown): UnitDeletionImpact[] | null {
  const response = (error as { response?: { data?: { error?: { code?: string; details?: { units?: UnitDeletionImpact[] } } } } })?.response;
  const apiError = response?.data?.error;
  if (apiError?.code !== "UNIT_NOT_EMPTY") {
    return null;
  }
  return Array.isArray(apiError.details?.units) ? apiError.details.units : [];
}

function SettingsTab({ project, onUpdate }: { project: Project; onUpdate: () => void }) {
  const currentUser = useAuthStore((s) => s.user);
  const isGlobalSupervisor = useAuthStore((s) => s.isSupervisor());
  const isProjectSupervisor = Boolean(
    currentUser &&
      (project.supervisorId === currentUser.id ||
        project.members?.some((member) => member.user.id === currentUser.id && member.role === "supervisor"))
  );
  const isSupervisor = isGlobalSupervisor || isProjectSupervisor;
  const [name, setName] = useState(project.name);
  const [qqGroupId, setQqGroupId] = useState(project.qqGroupId ?? "");
  const [episodeCount, setEpisodeCount] = useState(project.episodes || project.units?.length || 1);
  const [deliveryChecklist, setDeliveryChecklist] = useState(project.deliveryChecklist ?? []);
  const [downloadLinkTtlSeconds, setDownloadLinkTtlSeconds] = useState(project.downloadLinkTtlSeconds ?? 300);
  const [translationMaxSegmentLength, setTranslationMaxSegmentLength] = useState<number | "">(
    project.translationMaxSegmentLength ?? ""
  );
  const [wikiApprovalRequired, setWikiApprovalRequired] = useState(project.wikiApprovalRequired ?? false);
  const [unitDeleteDialogOpen, setUnitDeleteDialogOpen] = useState(false);
  const [pendingEpisodeCount, setPendingEpisodeCount] = useState<number | null>(null);
  const [selectedUnitDeleteIds, setSelectedUnitDeleteIds] = useState<string[]>([]);
  const [nonEmptyDeleteImpacts, setNonEmptyDeleteImpacts] = useState<UnitDeletionImpact[]>([]);
  const [saving, setSaving] = useState(false);
  const [savingUnits, setSavingUnits] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const sortedUnits = [...(project.units ?? [])].sort((a, b) => a.season - b.season || a.episode - b.episode);
  const currentEpisodeCount = sortedUnits.length || project.episodes || 1;
  const deleteCount = pendingEpisodeCount === null ? 0 : Math.max(0, currentEpisodeCount - pendingEpisodeCount);

  useEffect(() => {
    setName(project.name);
    setQqGroupId(project.qqGroupId ?? "");
    setEpisodeCount(project.episodes || project.units?.length || 1);
    setDeliveryChecklist(project.deliveryChecklist ?? []);
    setDownloadLinkTtlSeconds(project.downloadLinkTtlSeconds ?? 300);
    setTranslationMaxSegmentLength(project.translationMaxSegmentLength ?? "");
    setWikiApprovalRequired(project.wikiApprovalRequired ?? false);
  }, [project]);

  const handleSave = async () => {
    if (translationMaxSegmentLength !== "" && Number(translationMaxSegmentLength) < 1) {
      toast.error("每人最大认领时长必须大于 0 秒");
      return;
    }

    setSaving(true);
    try {
      await projectApi.updateProject(project.id, {
        name,
        qqGroupId: qqGroupId.trim(),
        deliveryChecklist,
        downloadLinkTtlSeconds,
        translationMaxSegmentLength:
          translationMaxSegmentLength === "" ? null : Number(translationMaxSegmentLength),
        wikiApprovalRequired,
      });
      toast.success("设置已保存");
      onUpdate();
    } catch (error) {
      toast.error("保存失败: " + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await projectApi.archiveProject(project.id);
      toast.success("项目已归档");
      onUpdate();
    } catch (error) {
      toast.error("归档失败: " + getErrorMessage(error));
    } finally {
      setArchiving(false);
    }
  };

  const submitUnitUpdate = async (
    targetEpisodeCount: number,
    options: { deleteUnitIds?: string[]; forceDeleteNonEmpty?: boolean } = {}
  ) => {
    setSavingUnits(true);
    try {
      await projectApi.updateUnitCount(project.id, {
        season: project.season || 1,
        episodes: targetEpisodeCount,
        deleteUnitIds: options.deleteUnitIds,
        forceDeleteNonEmpty: options.forceDeleteNonEmpty,
      });
      toast.success("分集数量已更新");
      setUnitDeleteDialogOpen(false);
      setPendingEpisodeCount(null);
      setSelectedUnitDeleteIds([]);
      setNonEmptyDeleteImpacts([]);
      onUpdate();
    } catch (error) {
      const details = getUnitDeletionErrorDetails(error);
      if (details) {
        setNonEmptyDeleteImpacts(details);
        return;
      }
      toast.error("更新分集失败: " + getErrorMessage(error));
    } finally {
      setSavingUnits(false);
    }
  };

  const handleUpdateUnits = async () => {
    const targetEpisodeCount = Math.max(1, Math.min(999, Number(episodeCount) || 1));
    if (targetEpisodeCount < currentEpisodeCount) {
      const countToDelete = currentEpisodeCount - targetEpisodeCount;
      setPendingEpisodeCount(targetEpisodeCount);
      setSelectedUnitDeleteIds(sortedUnits.slice(-countToDelete).map((unit) => unit.id));
      setNonEmptyDeleteImpacts([]);
      setUnitDeleteDialogOpen(true);
      return;
    }

    await submitUnitUpdate(targetEpisodeCount);
  };

  const toggleUnitDeletion = (unitId: string) => {
    setSelectedUnitDeleteIds((current) => {
      if (current.includes(unitId)) {
        return current.filter((id) => id !== unitId);
      }
      if (deleteCount > 0 && current.length >= deleteCount) {
        return [...current.slice(1), unitId];
      }
      return [...current, unitId];
    });
  };

  const confirmSelectedUnitDeletion = async () => {
    if (pendingEpisodeCount === null) return;
    if (selectedUnitDeleteIds.length !== deleteCount) {
      toast.error(`请选择 ${deleteCount} 集进行删除`);
      return;
    }
    await submitUnitUpdate(pendingEpisodeCount, { deleteUnitIds: selectedUnitDeleteIds });
  };

  const confirmForcedUnitDeletion = async () => {
    if (pendingEpisodeCount === null) return;
    await submitUnitUpdate(pendingEpisodeCount, {
      deleteUnitIds: selectedUnitDeleteIds,
      forceDeleteNonEmpty: true,
    });
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
            <label className="text-sm font-medium text-gray-700">项目 QQ 群号</label>
            <Input
              value={qqGroupId}
              onChange={(e) => setQqGroupId(e.target.value)}
              disabled={!isSupervisor}
            />
            <p className="text-xs text-gray-500">需要 QQ at 提醒的项目通知会发送到这个项目群。</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-800">分集配置</h3>
              <p className="mt-1 text-xs text-gray-500">
                开项后仍可增加分集；任务由监制在对应分集中手动创建。删除分集前会检查文件和任务内容。
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">当前季集数</label>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={episodeCount}
                  onChange={(event) => setEpisodeCount(Number(event.target.value))}
                  disabled={!isSupervisor}
                />
              </div>
            </div>
            <p className="text-xs text-gray-500">
              分集时长由片源任务提交时填写，系统会按每一集自己的片源时长校验后续分段任务。
            </p>
            {isSupervisor && (
              <Button variant="outline" onClick={handleUpdateUnits} disabled={savingUnits}>
                {savingUnits && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                <ListOrdered className="w-4 h-4 mr-1.5" />
                更新分集
              </Button>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">交付清单</label>
            <DeliveryChecklistEditor
              items={deliveryChecklist}
              onChange={setDeliveryChecklist}
              readOnly={!isSupervisor}
            />
          </div>
          <div className="rounded-lg border border-gray-200 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-800">翻译认领规则</h3>
              <p className="mt-1 text-xs text-gray-500">
                控制每个翻译在同一集翻译任务中可同时认领的总时长，修改后会立即影响新的认领校验。
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">每人最大认领时长（秒）</label>
              <Input
                type="number"
                min={1}
                value={translationMaxSegmentLength}
                onChange={(event) =>
                  setTranslationMaxSegmentLength(event.target.value === "" ? "" : Number(event.target.value))
                }
                placeholder="留空表示不限制"
                disabled={!isSupervisor}
              />
              <p className="text-xs text-gray-500">
                例如填 900 表示每名翻译最多同时认领 15 分钟片段；留空则不限制认领总时长。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">下载链接有效期（秒）</label>
              <Input
                type="number"
                min={90}
                value={downloadLinkTtlSeconds}
                onChange={(event) => setDownloadLinkTtlSeconds(Number(event.target.value))}
                disabled={!isSupervisor}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Wiki审批</label>
              <Select
                value={wikiApprovalRequired ? "required" : "optional"}
                onValueChange={(value) => setWikiApprovalRequired(value === "required")}
                disabled={!isSupervisor}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="optional">直接生效</SelectItem>
                  <SelectItem value="required">需要监制审批</SelectItem>
                </SelectContent>
              </Select>
            </div>
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

      <Dialog
        open={unitDeleteDialogOpen}
        onOpenChange={(open) => {
          setUnitDeleteDialogOpen(open);
          if (!open) {
            setPendingEpisodeCount(null);
            setSelectedUnitDeleteIds([]);
            setNonEmptyDeleteImpacts([]);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>选择要删除的分集</DialogTitle>
            <DialogDescription>
              需要删除 {deleteCount} 集，已选择 {selectedUnitDeleteIds.length} 集。删除前会检查所选分集是否存在文件、认领、提交、审核、评论或冲突记录。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[52vh] overflow-y-auto rounded-md border border-gray-200">
            {sortedUnits.map((unit) => {
              const selected = selectedUnitDeleteIds.includes(unit.id);
              const taskCount = project.tasks?.filter((task) => task.unitId === unit.id).length ?? unit.taskCount ?? 0;
              return (
                <label
                  key={unit.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0",
                    selected ? "bg-primary-50/60" : "hover:bg-gray-50"
                  )}
                >
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => toggleUnitDeletion(unit.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-800">{getUnitTitle(unit)}</div>
                    <div className="text-xs text-gray-500">第 {unit.season} 季 · 第 {unit.episode} 集 · {taskCount} 个任务</div>
                  </div>
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={savingUnits}
              onClick={() => setUnitDeleteDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={savingUnits || selectedUnitDeleteIds.length !== deleteCount}
              onClick={confirmSelectedUnitDeletion}
            >
              {savingUnits && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              检查并删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={nonEmptyDeleteImpacts.length > 0} onOpenChange={(open) => !open && setNonEmptyDeleteImpacts([])}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>所选分集不是空的</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-gray-600">
                <p>以下分集已经存在文件或任务内容。继续删除会移除分集和任务，并将关联文件移入删除状态。</p>
                <div className="max-h-64 overflow-y-auto rounded-md border border-red-100 bg-red-50/40">
                  {nonEmptyDeleteImpacts.map((impact) => (
                    <div key={impact.unit_id} className="border-b border-red-100 px-3 py-2 last:border-0">
                      <div className="font-medium text-red-800">
                        {impact.title || `第 ${impact.season_number} 季 第 ${impact.unit_number} 集`}
                      </div>
                      <div className="mt-1 text-xs text-red-700">
                        任务 {impact.task_count} 个，活跃任务 {impact.active_task_count} 个，文件 {impact.file_count} 个，
                        认领 {impact.claim_count} 个，提交 {impact.submission_count} 个，审核 {impact.review_count} 个，
                        评论 {impact.comment_count} 条，冲突 {impact.conflict_count} 个
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingUnits}>返回选择</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={savingUnits}
              onClick={(event) => {
                event.preventDefault();
                confirmForcedUnitDeletion();
              }}
            >
              {savingUnits && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              确认删除这些内容
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
