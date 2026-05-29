import { useState, useRef, useCallback, useEffect } from "react";
import { cn, formatRelativeTime, TIMELINE_EVENT_MAP } from "@/lib/utils";
import type { TimelineEvent as TimelineEventType, TimelineEventType as EventType } from "@/types";
import {
  ArrowRightCircle,
  Upload,
  CheckCircle,
  UserPlus,
  Info,
  Filter,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { mockTimelineEvents, mockUsers } from "@/lib/mockData";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { User } from "@/types";

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
          {event.projectName && (
            <Badge variant="outline" className="text-[10px]">
              {event.projectName}
            </Badge>
          )}
          <span className="text-xs text-gray-400">
            {formatRelativeTime(event.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Enhanced Timeline with Filtering ---------- */

interface EnhancedTimelineProps {
  events: TimelineEventType[];
  title?: string;
  showFilters?: boolean;
  compact?: boolean;
  maxHeight?: string;
}

const ALL_EVENT_TYPES: EventType[] = ["task_status", "file_upload", "review", "member_join", "system"];

const typeLabels: Record<EventType, string> = {
  task_status: "任务变更",
  file_upload: "文件上传",
  review: "审核",
  member_join: "成员变动",
  system: "系统",
};

export function EnhancedTimeline({
  events,
  title = "动态",
  showFilters = true,
  compact = false,
  maxHeight,
}: EnhancedTimelineProps) {
  const [selectedTypes, setSelectedTypes] = useState<EventType[]>(ALL_EVENT_TYPES);
  const [showTypeFilter, setShowTypeFilter] = useState(false);
  const [displayCount, setDisplayCount] = useState(10);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const filteredEvents = events.filter((e) => selectedTypes.includes(e.type));
  const displayedEvents = filteredEvents.slice(0, displayCount);
  const hasMore = displayCount < filteredEvents.length;

  const toggleType = (type: EventType) => {
    setSelectedTypes((prev) =>
      prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type]
    );
    setDisplayCount(10); // Reset pagination on filter change
  };

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    // Simulate API delay
    await new Promise((r) => setTimeout(r, 300));
    setDisplayCount((prev) => prev + 10);
    setIsLoadingMore(false);
  }, [isLoadingMore, hasMore]);

  // Infinite scroll with IntersectionObserver
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  return (
    <Card>
      <CardHeader className="py-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-h2">{title}</CardTitle>
          {showFilters && (
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTypeFilter(!showTypeFilter)}
                className={cn(
                  "text-xs",
                  selectedTypes.length !== ALL_EVENT_TYPES.length && "border-primary-300 text-primary-700"
                )}
              >
                <Filter className="w-3.5 h-3.5 mr-1" />
                筛选
                {selectedTypes.length !== ALL_EVENT_TYPES.length && (
                  <Badge variant="default" className="ml-1 text-[10px] h-4 px-1">
                    {selectedTypes.length}
                  </Badge>
                )}
              </Button>
              {showTypeFilter && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-20 w-40">
                  {ALL_EVENT_TYPES.map((type) => (
                    <button
                      key={type}
                      onClick={() => toggleType(type)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-gray-50 transition-colors"
                    >
                      <div
                        className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                          selectedTypes.includes(type)
                            ? "bg-primary-500 border-primary-500"
                            : "border-gray-300"
                        )}
                      >
                        {selectedTypes.includes(type) && (
                          <CheckCircle className="w-3 h-3 text-white" />
                        )}
                      </div>
                      <span className="text-gray-700">{typeLabels[type]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent
        className={cn("p-4 pt-0", maxHeight && "overflow-y-auto")}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {displayedEvents.length > 0 ? (
          <div className="space-y-0">
            {displayedEvents.map((event) => (
              <TimelineEventItem key={event.id} event={event} compact={compact} />
            ))}
            {/* Load more sentinel */}
            {hasMore && (
              <div ref={loadMoreRef} className="flex items-center justify-center py-4">
                {isLoadingMore ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    加载中...
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" onClick={loadMore} className="text-xs text-gray-400">
                    <ChevronDown className="w-4 h-4 mr-1" />
                    加载更多
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center py-12 text-center">
            <Info className="w-10 h-10 text-gray-300" />
            <p className="text-sm text-gray-500 mt-3">暂无动态</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Global Timeline Page Component ---------- */

export function GlobalTimelinePage() {
  const [events] = useState<TimelineEventType[]>([
    ...mockTimelineEvents,
    // Add more mock events for pagination demo
    ...Array.from({ length: 25 }, (_, i) => ({
      id: `e-extra-${i}`,
      type: (["task_status", "file_upload", "review", "member_join", "system"] as EventType[])[i % 5],
      projectId: i % 2 === 0 ? "p1" : "p2",
      projectName: i % 2 === 0 ? "夏日重现" : "进击的巨人 最终季",
      description: `示例动态事件 ${i + 1}`,
      user: mockUsers[i % mockUsers.length] as User,
      createdAt: new Date(new Date().getTime() - (i + 1) * 3600000).toISOString(),
    })),
  ]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-display text-gray-800">全局动态</h1>
        <p className="text-sm text-gray-500 mt-1">你参与的所有项目的最新动态</p>
      </div>
      <EnhancedTimeline
        events={events}
        title="全部动态"
        showFilters={true}
        maxHeight="600px"
      />
    </div>
  );
}
