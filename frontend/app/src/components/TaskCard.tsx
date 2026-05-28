import { cn, getRoleColor, getRoleLabel, formatRelativeTime } from "@/lib/utils";
import type { Task } from "@/types";
import { StatusBadge } from "./StatusBadge";
import { UserAvatar } from "./UserAvatar";
import { FileText, Clock } from "lucide-react";

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
  draggable?: boolean;
  showProject?: boolean;
  className?: string;
}

export function TaskCard({ task, onClick, draggable = false, showProject = false, className }: TaskCardProps) {
  const isOverdue = task.status === "overdue";

  return (
    <div
      onClick={onClick}
      draggable={draggable}
      className={cn(
        "bg-white rounded-lg border border-gray-200 p-3 shadow-sm cursor-pointer",
        "hover:shadow-md hover:border-gray-300 transition-all duration-200",
        "border-l-[3px]",
        isOverdue ? "border-l-yellow-500" : "border-l-blue-500",
        draggable && "cursor-grab active:cursor-grabbing",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-gray-800 line-clamp-2 flex-1 min-w-0">
          {task.name}
        </h4>
        <StatusBadge status={task.status} size="sm" />
      </div>

      {showProject && task.project && (
        <p className="text-xs text-gray-500 mt-1.5">
          {task.project.name} · 第{task.project.season}季
        </p>
      )}

      <div className="flex items-center justify-between mt-2.5">
        <div className="flex items-center gap-2">
          <span className={cn("text-caption px-1.5 py-0.5 rounded border", getRoleColor(task.role))}>
            {getRoleLabel(task.role)}
          </span>
          {task.fileCount ? (
            <span className="flex items-center gap-0.5 text-xs text-gray-400">
              <FileText className="w-3 h-3" />
              {task.fileCount}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          {task.assignee ? (
            <>
              <UserAvatar user={task.assignee} size="xs" />
              <span className="text-xs text-gray-500">{task.assignee.username}</span>
            </>
          ) : (
            <span className="text-xs text-gray-400 italic">待认领</span>
          )}
        </div>
        {task.deadline && (
          <span className={cn("flex items-center gap-0.5 text-xs", isOverdue ? "text-red-500" : "text-gray-400")}>
            <Clock className="w-3 h-3" />
            {formatRelativeTime(task.deadline)}
          </span>
        )}
      </div>
    </div>
  );
}
