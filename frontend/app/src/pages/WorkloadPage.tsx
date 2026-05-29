import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router";
import { cn, formatRelativeTime, getRoleColor, getRoleLabel, getTaskStatusColor, TASK_STATUS_MAP } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { taskApi, projectApi } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { UserAvatar } from "@/components/UserAvatar";
import type { Task, TaskStatus, User, Project } from "@/types";
import {
  LayoutDashboard,
  Users,
  Shield,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  BarChart3,
} from "lucide-react";

type WorkloadView = "personal" | "supervisor" | "admin";

const STATUS_GROUPS: { id: string; label: string; statuses: TaskStatus[]; color: string }[] = [
  { id: "todo", label: "待处理", statuses: ["pending_publish", "claimable", "assigned"], color: "bg-gray-100" },
  { id: "in_progress", label: "进行中", statuses: ["in_progress", "submitted"], color: "bg-blue-50" },
  { id: "review", label: "审核中", statuses: ["review_approved", "review_rejected"], color: "bg-yellow-50" },
  { id: "done", label: "已完成", statuses: ["completed"], color: "bg-green-50" },
  { id: "overdue", label: "已超期", statuses: ["overdue"], color: "bg-red-50" },
];

export function WorkloadPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin)();
  const isSupervisor = useAuthStore((s) => s.isSupervisor)();
  const navigate = useNavigate();

  // Determine default view based on role
  const defaultView: WorkloadView = isAdmin ? "admin" : isSupervisor ? "supervisor" : "personal";
  const [activeView, setActiveView] = useState<WorkloadView>(defaultView);

  // Filter views available to user
  const availableViews: WorkloadView[] = useMemo(() => {
    const views: WorkloadView[] = ["personal"];
    if (isSupervisor) views.push("supervisor");
    if (isAdmin) views.push("admin");
    return views;
  }, [isSupervisor, isAdmin]);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    Promise.all([
      taskApi.getTasks(),
      projectApi.getProjects(),
    ])
      .then(([tasksData, projectsData]) => {
        setTasks(tasksData);
        setProjects(projectsData.items || []);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display text-gray-800">工作量看板</h1>
          <p className="text-sm text-gray-500 mt-1">查看任务分配和工作进度</p>
        </div>
      </div>

      {/* View selector */}
      {availableViews.length > 1 && (
        <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-0.5 w-fit">
          {availableViews.map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={cn(
                "px-4 py-2 text-sm rounded-md transition-colors flex items-center gap-1.5",
                activeView === view
                  ? "bg-primary-50 text-primary-700 font-medium"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {view === "personal" && <LayoutDashboard className="w-4 h-4" />}
              {view === "supervisor" && <Users className="w-4 h-4" />}
              {view === "admin" && <Shield className="w-4 h-4" />}
              {view === "personal" ? "我的任务" : view === "supervisor" ? "项目监管" : "全局管理"}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {activeView === "personal" && <PersonalView user={user} navigate={navigate} tasks={tasks} />}
      {activeView === "supervisor" && <SupervisorView navigate={navigate} tasks={tasks} projects={projects} user={user} />}
      {activeView === "admin" && <AdminView tasks={tasks} />}
    </div>
  );
}

/* ---------- Personal View ---------- */

function PersonalView({ user, navigate, tasks }: { user: User | null; navigate: ReturnType<typeof useNavigate>; tasks: Task[] }) {
  const myTasks = tasks.filter((t) => t.assigneeId === user?.id);

  const stats = useMemo(() => {
    const total = myTasks.length;
    const inProgress = myTasks.filter((t) => t.status === "in_progress").length;
    const submitted = myTasks.filter((t) => t.status === "submitted").length;
    const overdue = myTasks.filter((t) => t.status === "overdue").length;
    const completed = myTasks.filter((t) => t.status === "completed" || t.status === "review_approved").length;
    return { total, inProgress, submitted, overdue, completed };
  }, [myTasks]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
        <StatCard title="总任务" value={stats.total} icon={<ClipboardList className="w-5 h-5 text-primary-500" />} />
        <StatCard title="进行中" value={stats.inProgress} icon={<Clock className="w-5 h-5 text-blue-500" />} />
        <StatCard title="待审核" value={stats.submitted} icon={<CheckCircle2 className="w-5 h-5 text-yellow-500" />} />
        <StatCard title="已超期" value={stats.overdue} icon={<AlertTriangle className="w-5 h-5 text-red-500" />} color={stats.overdue > 0 ? "warning" : "neutral"} />
        <StatCard title="已完成" value={stats.completed} icon={<CheckCircle2 className="w-5 h-5 text-green-500" />} />
      </div>

      {/* Tasks by status group */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4">
        {STATUS_GROUPS.filter((g) => g.id !== "done").map((group) => {
          const groupTasks = myTasks.filter((t) => group.statuses.includes(t.status));
          return (
            <Card key={group.id} className={cn("border-gray-200/60", group.color)}>
              <CardHeader className="px-4 py-3 pb-0">
                <CardTitle className="text-h3 flex items-center justify-between">
                  <span>{group.label}</span>
                  <span className="text-xs text-gray-400 font-normal bg-white px-2 py-0.5 rounded-full border">
                    {groupTasks.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-3 space-y-2">
                {groupTasks.map((task) => (
                  <TaskMiniCard key={task.id} task={task} onClick={() => navigate(`/projects/${task.projectId}`)} />
                ))}
                {groupTasks.length === 0 && (
                  <div className="text-center py-6 text-xs text-gray-400">暂无任务</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Supervisor View ---------- */

function SupervisorView({ navigate, tasks, projects, user }: { navigate: ReturnType<typeof useNavigate>; tasks: Task[]; projects: Project[]; user: User | null }) {
  // Group tasks by member for supervised projects
  const supervisedProjectIds = projects
    .filter((p) => p.supervisorId === user?.id)
    .map((p) => p.id);

  const supervisedTasks = tasks.filter((t) => supervisedProjectIds.includes(t.projectId));

  // Group by assignee
  const memberTasks = useMemo(() => {
    const map = new Map<string, { user: User; tasks: Task[] }>();
    supervisedTasks.forEach((task) => {
      if (!task.assignee) return;
      const existing = map.get(task.assignee.id);
      if (existing) {
        existing.tasks.push(task);
      } else {
        map.set(task.assignee.id, { user: task.assignee, tasks: [task] });
      }
    });
    return Array.from(map.values());
  }, [supervisedTasks]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard title="监管项目" value={supervisedProjectIds.length} icon={<ClipboardList className="w-5 h-5 text-primary-500" />} />
        <StatCard title="总任务" value={supervisedTasks.length} icon={<BarChart3 className="w-5 h-5 text-blue-500" />} />
        <StatCard title="进行中" value={supervisedTasks.filter((t) => t.status === "in_progress").length} icon={<Clock className="w-5 h-5 text-yellow-500" />} />
        <StatCard
          title="已超期"
          value={supervisedTasks.filter((t) => t.status === "overdue").length}
          icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
          color={supervisedTasks.filter((t) => t.status === "overdue").length > 0 ? "warning" : "neutral"}
        />
      </div>

      {/* Member kanban */}
      <div className="space-y-4">
        {memberTasks.map(({ user, tasks }) => (
          <Card key={user.id}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <UserAvatar user={user} size="sm" />
                  <div>
                    <CardTitle className="text-h3">{user.username}</CardTitle>
                    <p className="text-xs text-gray-400 mt-0.5">{tasks.length} 个任务</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-gray-500">完成度</p>
                    <p className="text-sm font-medium text-gray-700">
                      {Math.round(
                        (tasks.filter((t) => t.status === "completed" || t.status === "review_approved").length /
                          tasks.length) *
                          100
                      )}
                      %
                    </p>
                  </div>
                  <Progress
                    value={
                      (tasks.filter((t) => t.status === "completed" || t.status === "review_approved").length /
                        tasks.length) *
                      100
                    }
                    className="w-24 h-2"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {tasks.map((task) => (
                  <TaskMiniCard key={task.id} task={task} showProject onClick={() => navigate(`/projects/${task.projectId}`)} />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        {memberTasks.length === 0 && (
          <EmptyState icon={<Users className="w-10 h-10 text-gray-300" />} title="暂无监管成员" subtitle="你监管的项目中没有分配任务" />
        )}
      </div>
    </div>
  );
}

/* ---------- Admin View ---------- */

function AdminView({ tasks }: { tasks: Task[] }) {
  // All tasks across all projects
  const allTasks = tasks;

  const stats = useMemo(() => {
    const total = allTasks.length;
    const inProgress = allTasks.filter((t) => t.status === "in_progress").length;
    const submitted = allTasks.filter((t) => t.status === "submitted").length;
    const overdue = allTasks.filter((t) => t.status === "overdue").length;
    const completed = allTasks.filter((t) => t.status === "completed" || t.status === "review_approved").length;
    const frozen = allTasks.filter((t) => t.status === "frozen").length;

    // Member stats
    const memberStats = new Map<string, { user: User; total: number; completed: number; overdue: number }>();
    allTasks.forEach((task) => {
      if (!task.assignee) return;
      const existing = memberStats.get(task.assignee.id);
      if (existing) {
        existing.total++;
        if (task.status === "completed" || task.status === "review_approved") existing.completed++;
        if (task.status === "overdue") existing.overdue++;
      } else {
        memberStats.set(task.assignee.id, {
          user: task.assignee,
          total: 1,
          completed: task.status === "completed" || task.status === "review_approved" ? 1 : 0,
          overdue: task.status === "overdue" ? 1 : 0,
        });
      }
    });

    return { total, inProgress, submitted, overdue, completed, frozen, memberStats: Array.from(memberStats.values()) };
  }, [allTasks]);

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
        <StatCard title="总任务" value={stats.total} icon={<ClipboardList className="w-5 h-5 text-primary-500" />} />
        <StatCard title="进行中" value={stats.inProgress} icon={<Clock className="w-5 h-5 text-blue-500" />} />
        <StatCard title="待审核" value={stats.submitted} icon={<CheckCircle2 className="w-5 h-5 text-yellow-500" />} />
        <StatCard title="已完成" value={stats.completed} icon={<CheckCircle2 className="w-5 h-5 text-green-500" />} />
        <StatCard title="已超期" value={stats.overdue} icon={<AlertTriangle className="w-5 h-5 text-red-500" />} color={stats.overdue > 0 ? "warning" : "neutral"} />
        <StatCard title="已冻结" value={stats.frozen} icon={<BarChart3 className="w-5 h-5 text-gray-500" />} />
      </div>

      {/* Member workload table */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary-500" />
            成员工作量
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-700">成员</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-700">总任务</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-700">已完成</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-700">超期</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-700">完成率</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">进度</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.memberStats.map(({ user, total, completed, overdue }) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <UserAvatar user={user} size="xs" />
                        <span className="text-sm text-gray-700">{user.username}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-700">{total}</td>
                    <td className="px-4 py-3 text-center text-sm text-green-600">{completed}</td>
                    <td className="px-4 py-3 text-center">
                      {overdue > 0 ? (
                        <span className="text-sm text-red-600 font-medium">{overdue}</span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-700">
                      {Math.round((completed / total) * 100)}%
                    </td>
                    <td className="px-4 py-3">
                      <Progress value={(completed / total) * 100} className="w-24 h-2" />
                    </td>
                  </tr>
                ))}
                {stats.memberStats.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-sm text-gray-400">
                      暂无成员任务数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- Shared Components ---------- */

function TaskMiniCard({
  task,
  showProject = false,
  onClick,
}: {
  task: Task;
  showProject?: boolean;
  onClick?: () => void;
}) {
  const isOverdue = task.status === "overdue";
  const deadlineText = task.deadline ? formatRelativeTime(task.deadline) : null;

  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-white rounded-lg border border-gray-200 p-3 cursor-pointer",
        "hover:shadow-sm hover:border-gray-300 transition-all",
        isOverdue && "border-l-2 border-l-red-500"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-800 line-clamp-1 flex-1">{task.name}</p>
        <Badge variant="outline" className={cn("text-[10px] shrink-0", getTaskStatusColor(task.status))}>
          {TASK_STATUS_MAP[task.status]?.label || task.status}
        </Badge>
      </div>
      {showProject && task.project && (
        <p className="text-xs text-gray-500 mt-1">{task.project.name}</p>
      )}
      <div className="flex items-center justify-between mt-2">
        <span className={cn("text-caption px-1.5 py-0.5 rounded border text-[10px]", getRoleColor(task.role))}>
          {getRoleLabel(task.role)}
        </span>
        {deadlineText && (
          <span className={cn("text-xs flex items-center gap-0.5", isOverdue ? "text-red-500" : "text-gray-400")}>
            <Clock className="w-3 h-3" />
            {deadlineText}
          </span>
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  color = "neutral",
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color?: "neutral" | "warning";
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 flex flex-col justify-between h-[88px]">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">{title}</span>
          {icon}
        </div>
        <span className={cn("text-[28px] font-bold leading-none", color === "warning" ? "text-red-600" : "text-gray-800")}>
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-12 text-center">
        {icon}
        <p className="text-sm text-gray-500 mt-3">{title}</p>
        <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  );
}
