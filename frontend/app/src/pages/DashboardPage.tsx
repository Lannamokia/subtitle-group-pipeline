import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { formatFullDate, formatRelativeTime } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { useBrandingStore } from "@/stores/brandingStore";
import { taskApi, timelineApi, announcementApi, notificationApi } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PersonalTaskBoard } from "@/components/PersonalTaskBoard";
import { TimelineEventItem } from "@/components/TimelineEvent";
import type { Task, TimelineEvent, Announcement } from "@/types";
import {
  ClipboardList,
  Plus,
  Layers,
  Megaphone,
  ArrowRight,
} from "lucide-react";

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canCreateProject = useAuthStore((s) => s.isSupervisor());
  const branding = useBrandingStore((state) => state.branding);
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
        {canCreateProject && (
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
        )}
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

      <PersonalTaskBoard tasks={tasks} />

      <div className="grid grid-cols-1 lg:grid-cols-7 gap-4 md:gap-6">
        <div className="lg:col-span-5 space-y-4">
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
