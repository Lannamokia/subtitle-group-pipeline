import { cn, formatRelativeTime, TIMELINE_EVENT_MAP } from "@/lib/utils";
import type { TimelineEvent as TimelineEventType } from "@/types";
import {
  ArrowRightCircle,
  Upload,
  CheckCircle,
  UserPlus,
  Info,
} from "lucide-react";

interface TimelineEventProps {
  event: TimelineEventType;
  compact?: boolean;
}

const eventIcons: Record<string, React.ReactNode> = {
  task_status: <ArrowRightCircle className="w-3.5 h-3.5 text-white" />,
  file_upload: <Upload className="w-3.5 h-3.5 text-white" />,
  review: <CheckCircle className="w-3.5 h-3.5 text-white" />,
  member_join: <UserPlus className="w-3.5 h-3.5 text-white" />,
  system: <Info className="w-3.5 h-3.5 text-white" />,
};

export function TimelineEventItem({ event, compact = false }: TimelineEventProps) {
  const eventConfig = TIMELINE_EVENT_MAP[event.type];
  const icon = eventIcons[event.type];

  return (
    <div className="flex gap-3 group">
      {/* Timeline line + dot */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className={cn(
            "rounded-full flex items-center justify-center shrink-0 z-10",
            eventConfig.color,
            compact ? "w-6 h-6" : "w-7 h-7"
          )}
        >
          {icon}
        </div>
        <div className="w-0.5 flex-1 bg-gray-200 min-h-[20px]" />
      </div>

      {/* Content */}
      <div className={cn("flex-1 min-w-0 pb-3", compact && "pb-2")}>
        <p className={cn("text-gray-700", compact ? "text-xs" : "text-sm")}>
          {event.description}
        </p>
        <div className="flex items-center gap-2 mt-1">
          {event.user && (
            <span className="text-xs text-gray-500">{event.user.username}</span>
          )}
          <span className="text-xs text-gray-400">
            {formatRelativeTime(event.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
