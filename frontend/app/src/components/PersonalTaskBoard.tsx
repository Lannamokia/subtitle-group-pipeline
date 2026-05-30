import { useMemo } from "react";
import { useNavigate } from "react-router";
import { cn, formatRelativeTime, getRoleColor, getRoleLabel, getTaskStatusColor, TASK_STATUS_MAP } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Task, TaskStatus } from "@/types";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock,
} from "lucide-react";

const STATUS_GROUPS: { id: string; label: string; statuses: TaskStatus[]; color: string }[] = [
  { id: "todo", label: "待处理", statuses: ["pending_publish", "claimable", "assigned"], color: "bg-gray-100" },
  { id: "in_progress", label: "进行中", statuses: ["in_progress", "submitted"], color: "bg-blue-50" },
  { id: "review", label: "审核中", statuses: ["review_approved", "review_rejected"], color: "bg-yellow-50" },
  { id: "done", label: "已完成", statuses: ["completed"], color: "bg-green-50" },
  { id: "overdue", label: "已超期", statuses: ["overdue"], color: "bg-red-50" },
];

export function PersonalTaskBoard({ tasks }: { tasks: Task[] }) {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const myTasks = tasks.filter((task) => task.assigneeId === user?.id);

  const stats = useMemo(() => {
    const total = myTasks.length;
    const inProgress = myTasks.filter((task) => task.status === "in_progress").length;
    const submitted = myTasks.filter((task) => task.status === "submitted").length;
    const overdue = myTasks.filter((task) => task.status === "overdue").length;
    const completed = myTasks.filter((task) => task.status === "completed" || task.status === "review_approved").length;
    return { total, inProgress, submitted, overdue, completed };
  }, [myTasks]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-h2 text-gray-800">我的任务看板</h2>
        <p className="mt-1 text-sm text-gray-500">查看你自己的任务分配和处理进度</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
        <StatCard title="总任务" value={stats.total} icon={<ClipboardList className="h-5 w-5 text-primary-500" />} />
        <StatCard title="进行中" value={stats.inProgress} icon={<Clock className="h-5 w-5 text-blue-500" />} />
        <StatCard title="待审核" value={stats.submitted} icon={<CheckCircle2 className="h-5 w-5 text-yellow-500" />} />
        <StatCard
          title="已超期"
          value={stats.overdue}
          icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
          color={stats.overdue > 0 ? "warning" : "neutral"}
        />
        <StatCard title="已完成" value={stats.completed} icon={<CheckCircle2 className="h-5 w-5 text-green-500" />} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-3">
        {STATUS_GROUPS.filter((group) => group.id !== "done").map((group) => {
          const groupTasks = myTasks.filter((task) => group.statuses.includes(task.status));
          return (
            <Card key={group.id} className={cn("border-gray-200/60", group.color)}>
              <CardHeader className="px-4 py-3 pb-0">
                <CardTitle className="text-h3 flex items-center justify-between">
                  <span>{group.label}</span>
                  <span className="rounded-full border bg-white px-2 py-0.5 text-xs font-normal text-gray-400">
                    {groupTasks.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-3 pt-3">
                {groupTasks.map((task) => (
                  <TaskMiniCard
                    key={task.id}
                    task={task}
                    onClick={() => navigate(`/projects/${task.projectId}`)}
                  />
                ))}
                {groupTasks.length === 0 && (
                  <div className="py-6 text-center text-xs text-gray-400">暂无任务</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

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
        "cursor-pointer rounded-lg border border-gray-200 bg-white p-3",
        "transition-all hover:border-gray-300 hover:shadow-sm",
        isOverdue && "border-l-2 border-l-red-500"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-1 min-w-0 flex-1 text-sm font-medium text-gray-800">{task.name}</p>
        <Badge variant="outline" className={cn("shrink-0 text-[10px]", getTaskStatusColor(task.status))}>
          {TASK_STATUS_MAP[task.status]?.label || task.status}
        </Badge>
      </div>
      {showProject && task.project && (
        <p className="mt-1 text-xs text-gray-500">{task.project.name}</p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className={cn("text-caption rounded border px-1.5 py-0.5 text-[10px]", getRoleColor(task.role))}>
          {getRoleLabel(task.role)}
        </span>
        {deadlineText && (
          <span className={cn("flex items-center gap-0.5 text-xs", isOverdue ? "text-red-500" : "text-gray-400")}>
            <Clock className="h-3 w-3" />
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
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex h-[88px] flex-col justify-between p-4">
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
