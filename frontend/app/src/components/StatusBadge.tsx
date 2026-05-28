import { cn, getTaskStatusColor } from "@/lib/utils";
import type { TaskStatus } from "@/types";
import { CheckCircle2, XCircle, AlertTriangle, Snowflake, ArrowRight } from "lucide-react";

interface StatusBadgeProps {
  status: TaskStatus | string;
  size?: "sm" | "md";
  showIcon?: boolean;
  className?: string;
}

const statusIcons: Record<string, React.ReactNode> = {
  overdue: <AlertTriangle className="w-3 h-3" />,
  frozen: <Snowflake className="w-3 h-3" />,
  review_approved: <CheckCircle2 className="w-3 h-3" />,
  review_rejected: <XCircle className="w-3 h-3" />,
  submitted: <ArrowRight className="w-3 h-3" />,
};

const statusLabels: Record<string, string> = {
  pending_publish: "待发布",
  claimable: "可领取",
  assigned: "已指派",
  in_progress: "进行中",
  submitted: "已提交",
  review_approved: "审核通过",
  review_rejected: "已驳回",
  completed: "已完成",
  overdue: "超期",
  frozen: "已冻结",
};

export function StatusBadge({ status, size = "sm", showIcon = false, className }: StatusBadgeProps) {
  const label = statusLabels[status] || status;
  const icon = showIcon ? statusIcons[status] : null;

  const sizeClasses = size === "md"
    ? "px-2.5 py-1 text-xs"
    : "px-2 py-0.5 text-caption";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md font-medium whitespace-nowrap",
        getTaskStatusColor(status as TaskStatus),
        sizeClasses,
        className
      )}
    >
      {icon}
      {label}
    </span>
  );
}
