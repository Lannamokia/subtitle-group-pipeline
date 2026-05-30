import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { announcementApi } from "@/lib/api";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Announcement } from "@/types";
import {
  ArrowLeft,
  Calendar,
  FolderKanban,
  Globe,
  Megaphone,
  Pin,
} from "lucide-react";

type AnnouncementTab = "all" | "global" | "project";

export function AnnouncementPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [activeTab, setActiveTab] = useState<AnnouncementTab>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    announcementApi.getAnnouncements({ pageSize: 100 })
      .then(setAnnouncements)
      .catch(() => setAnnouncements([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!location.hash || loading) return;

    window.requestAnimationFrame(() => {
      const target = document.querySelector(location.hash);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [loading, location.hash]);

  const sortedAnnouncements = useMemo(() => {
    return [...announcements].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [announcements]);

  const filteredAnnouncements = sortedAnnouncements.filter((announcement) => {
    if (activeTab === "all") return true;
    return announcement.type === activeTab;
  });

  const globalCount = announcements.filter((announcement) => announcement.type === "global").length;
  const projectCount = announcements.filter((announcement) => announcement.type === "project").length;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-0 text-gray-500 hover:text-gray-800"
            onClick={() => navigate("/dashboard")}
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            返回工作台
          </Button>
          <h1 className="text-display text-gray-800 flex items-center gap-2 mt-2">
            <Megaphone className="w-6 h-6 text-primary-500" />
            公告
          </h1>
          <p className="text-sm text-gray-500 mt-1">查看全站公告和项目公告</p>
        </div>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AnnouncementTab)}>
          <TabsList>
            <TabsTrigger value="all">全部 {announcements.length}</TabsTrigger>
            <TabsTrigger value="global">全站 {globalCount}</TabsTrigger>
            <TabsTrigger value="project">项目 {projectCount}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-gray-400">
            正在加载公告...
          </CardContent>
        </Card>
      ) : filteredAnnouncements.length > 0 ? (
        <div className="space-y-3">
          {filteredAnnouncements.map((announcement) => (
            <AnnouncementCard key={announcement.id} announcement={announcement} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Megaphone className="w-10 h-10 text-gray-300" />
            <p className="text-sm text-gray-500 mt-3">暂无公告</p>
            <p className="text-xs text-gray-400 mt-1">当前分类下没有可查看的公告</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AnnouncementCard({ announcement }: { announcement: Announcement }) {
  const isProject = announcement.type === "project";

  return (
    <Card
      id={`announcement-${announcement.id}`}
      className={cn(
        "scroll-mt-6 transition-shadow",
        announcement.isPinned && "border-primary-200 bg-primary-50/30"
      )}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0">
            {isProject ? (
              <FolderKanban className="w-4 h-4 text-sky-500" />
            ) : (
              <Globe className="w-4 h-4 text-primary-500" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900 leading-snug">
                {announcement.title}
              </h2>
              <Badge variant="outline" className="text-[10px] bg-white">
                {isProject ? "项目公告" : "全站公告"}
              </Badge>
              {announcement.isPinned && (
                <Badge className="text-[10px]">
                  <Pin className="w-3 h-3 mr-1" />
                  置顶
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatRelativeTime(announcement.createdAt)}
              </span>
              <span>发布者: {announcement.createdBy.username}</span>
              {announcement.projectName && <span>项目: {announcement.projectName}</span>}
            </div>
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap mt-3">
              {announcement.content}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
