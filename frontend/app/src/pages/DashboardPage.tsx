import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { cn, formatFullDate, formatRelativeTime } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { useBrandingStore } from "@/stores/brandingStore";
import { taskApi, timelineApi, announcementApi, notificationApi } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskCard } from "@/components/TaskCard";
import { TimelineEventItem } from "@/components/TimelineEvent";
import type { Task, TimelineEvent, Announcement } from "@/types";
import {
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  Bell,
  Plus,
  Layers,
  Megaphone,
  ArrowRight,
} from "lucide-react";

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const branding = useBrandingStore((state) => state.branding);
  const [taskTab, setTaskTab] = useState<"in_progress" | "submitted" | "overdue" | "all">("in_progress");
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem("onboarding-dismissed");
  });

  const [tasks, setTasks] = useState<Task[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [tasksRes, timelineRes, announcementsRes] = await Promise.all([
          taskApi.getTasks(),
          timelineApi.getGlobalEvents(),
          announcementApi.getAnnouncements(),
        ]);
        setTasks(tasksRes);
        // Backend returns { events: [...], meta: {...} }
        const eventList = Array.isArray(timelineRes)
          ? timelineRes
          : (timelineRes as { events?: TimelineEvent[] }).events ?? [];
        setTimelineEvents(eventList);
        // Backend returns { announcements: [...], meta: {...} }
        const announcementList = Array.isArray(announcementsRes)
          ? announcementsRes
          : (announcementsRes as { announcements?: Announcement[] }).announcements ?? [];
        setAnnouncements(announcementList);
      } catch {
        // 保持空数组
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    notificationApi.getUnreadCount()
      .then((data) => setUnreadCount(data.count))
      .catch(() => setUnreadCount(0));
  }, []);

  // Stats
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress");
  const submittedTasks = tasks.filter((t) => t.status === "submitted");
  const overdueTasks = tasks.filter((t) => t.status === "overdue");

  const filteredTasks =
    taskTab === "in_progress"
      ? inProgressTasks
      : taskTab === "submitted"
        ? submittedTasks
        : taskTab === "overdue"
          ? overdueTasks
          : tasks;

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    localStorage.setItem("onboarding-dismissed", "true");
  };

  // Get latest global and project announcements
  const globalAnnouncements = announcements.filter((a) => a.type === "global");
  const projectAnnouncements = announcements.filter((a) => a.type === "project");
  const latestGlobalAnnouncement = [...globalAnnouncements].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  })[0];
  const hiddenGlobalAnnouncementCount = Math.max(globalAnnouncements.length - 1, 0);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Welcome + Quick actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display text-gray-800">
            欢迎回来，{user?.username || "用户"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{formatFullDate(new Date().toISOString())}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => navigate("/projects/new")}>
            <Plus className="w-4 h-4 mr-1.5" />
            新建项目
          </Button>
          <Button variant="outline" onClick={() => navigate("/templates")}>
            <Layers className="w-4 h-4 mr-1.5" />
            从模板创建
          </Button>
        </div>
      </div>

      {/* Global announcement banner */}
      {latestGlobalAnnouncement && (
        <div
          className="bg-primary-50 border border-primary-200 rounded-lg px-4 py-3 cursor-pointer hover:bg-primary-100/50 transition-colors"
          onClick={() => navigate(`/announcements#announcement-${latestGlobalAnnouncement.id}`)}
        >
          <div className="flex items-start gap-3">
            <Megaphone className="w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">
                  {latestGlobalAnnouncement.title}
                </span>
                {latestGlobalAnnouncement.isPinned && (
                  <Badge variant="outline" className="text-[10px] bg-white/70">
                    置顶
                  </Badge>
                )}
              </div>
              <p className="text-xs sm:text-sm text-gray-600 mt-1 line-clamp-2">
                {latestGlobalAnnouncement.content}
              </p>
              {hiddenGlobalAnnouncementCount > 0 && (
                <p className="text-xs text-primary-600 mt-1 font-medium">
                  还有 {hiddenGlobalAnnouncementCount} 条公告待查看，点击进入公告页
                </p>
              )}
            </div>
            <ArrowRight className="w-4 h-4 text-primary-400 shrink-0 mt-0.5" />
          </div>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          title="进行中任务"
          value={inProgressTasks.length}
          icon={<ClipboardList className="w-5 h-5 text-primary-500" />}
          color="primary"
          onClick={() => { setTaskTab("in_progress"); }}
        />
        <StatCard
          title="待审核"
          value={submittedTasks.length}
          icon={<CheckCircle2 className="w-5 h-5 text-gray-400" />}
          color="neutral"
          onClick={() => { setTaskTab("submitted"); }}
        />
        <StatCard
          title="超期任务"
          value={overdueTasks.length}
          icon={<AlertTriangle className="w-5 h-5 text-yellow-500" />}
          color={overdueTasks.length > 0 ? "warning" : "neutral"}
          onClick={() => { setTaskTab("overdue"); }}
        />
        <StatCard
          title="新通知"
          value={unreadCount}
          icon={<Bell className="w-5 h-5 text-primary-500" />}
          color={unreadCount > 0 ? "primary" : "neutral"}
          pulse={unreadCount > 0}
          onClick={() => navigate("/notifications")}
        />
      </div>

      {/* Main content: Task list + Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-4 md:gap-6">
        {/* Task list (left, 5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <Card>
            <CardContent className="p-0">
              <Tabs value={taskTab} onValueChange={(v) => setTaskTab(v as typeof taskTab)}>
                <div className="flex items-center justify-between px-4 pt-4 pb-2">
                  <TabsList>
                    <TabsTrigger value="in_progress">
                      进行中
                      <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                        {inProgressTasks.length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="submitted">
                      待审核
                      <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                        {submittedTasks.length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="overdue">
                      超期
                      <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                        {overdueTasks.length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="all">
                      全部
                      <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                        {tasks.length}
                      </span>
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value={taskTab} className="mt-0">
                  {filteredTasks.length > 0 ? (
                    <div className="divide-y divide-gray-100">
                      {filteredTasks.map((task) => (
                        <div
                          key={task.id}
                          className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => navigate(`/projects/${task.projectId}`)}
                        >
                          <TaskCard task={task} showProject />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={<ClipboardList className="w-10 h-10 text-gray-300" />}
                      title={`暂无${taskTab === "in_progress" ? "进行中" : taskTab === "submitted" ? "待审核" : taskTab === "overdue" ? "超期" : ""}的任务`}
                      subtitle="去项目页面领取或等待指派"
                    />
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Project announcements */}
          {projectAnnouncements.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Megaphone className="w-4 h-4 text-primary-500" />
                  <h2 className="text-h3 text-gray-800">项目公告</h2>
                </div>
                <div className="space-y-3">
                  {projectAnnouncements.map((announcement) => (
                    <div
                      key={announcement.id}
                      className="bg-gray-50 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => navigate(`/projects/${announcement.projectId}`)}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          项目公告
                        </Badge>
                        <span className="text-sm font-medium text-gray-800">
                          {announcement.title}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-1">
                        {announcement.content}
                      </p>
                      <span className="text-caption text-gray-400 mt-1 block">
                        {formatRelativeTime(announcement.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Timeline (right, 2 cols) */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-h2 text-gray-800">最新动态</h2>
                <Button
                  variant="link"
                  size="sm"
                  className="text-primary-500 h-auto p-0"
                  onClick={() => navigate("/projects")}
                >
                  查看全部
                </Button>
              </div>
              <div className="space-y-0">
                {timelineEvents.slice(0, 6).map((event) => (
                  <TimelineEventItem key={event.id} event={event} compact />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Onboarding overlay for first-time users */}
      {showOnboarding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={dismissOnboarding} />
          <Card className="relative w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <CardContent className="p-6 space-y-4">
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-primary-50 flex items-center justify-center mx-auto mb-3">
                  <ClipboardList className="w-7 h-7 text-primary-500" />
                </div>
                <h2 className="text-lg font-semibold text-gray-800">欢迎使用 {branding.appName}</h2>
                <p className="text-sm text-gray-500 mt-1">只需几步即可开始协作</p>
              </div>
              <div className="space-y-3">
                <StepItem number={1} text="完善技能档案" />
                <StepItem number={2} text="浏览项目并加入" />
                <StepItem number={3} text="领取你的首个任务" />
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={dismissOnboarding}>
                  稍后再说
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => {
                    dismissOnboarding();
                    navigate("/profile");
                  }}
                >
                  开始
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

function StatCard({
  title,
  value,
  icon,
  color,
  pulse,
  onClick,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: "primary" | "warning" | "neutral";
  pulse?: boolean;
  onClick?: () => void;
}) {
  const colorClasses = {
    primary: {
      card: "",
      number: "text-primary-600",
    },
    warning: {
      card: "border-yellow-200 bg-yellow-50/50",
      number: "text-red-600",
    },
    neutral: {
      card: "",
      number: "text-gray-600",
    },
  };

  return (
    <Card
      className={cn(
        "cursor-pointer hover:shadow-md transition-shadow",
        colorClasses[color].card
      )}
      onClick={onClick}
    >
      <CardContent className="p-4 flex flex-col justify-between h-[88px]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <span className="text-small text-gray-500">{title}</span>
          <span className="relative">
            {icon}
            {pulse && (
              <span className="absolute inset-0 rounded-full bg-primary-400 animate-pulse-ring" />
            )}
          </span>
        </div>
        <span className={cn("text-[28px] font-bold leading-none", colorClasses[color].number)}>
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
    <div className="flex flex-col items-center py-12 text-center">
      {icon}
      <p className="text-sm text-gray-500 mt-3">{title}</p>
      <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
    </div>
  );
}

function StepItem({ number, text }: { number: number; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center text-sm font-medium shrink-0">
        {number}
      </div>
      <span className="text-sm text-gray-700">{text}</span>
    </div>
  );
}
