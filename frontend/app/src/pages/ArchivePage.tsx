import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { getErrorMessage, projectApi } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { AvatarGroup } from "@/components/UserAvatar";
import type { Project } from "@/types";
import {
  Archive,
  Trash2,
  RotateCcw,
  AlertTriangle,
  Search,
  Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type ArchiveTab = "archived" | "recycle";

// Extended project with deletion info
interface ProjectWithDeleteInfo extends Project {
  deletedAt?: string;
  deletedBy?: string;
}

export function ArchivePage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ArchiveTab>("archived");
  const [searchQuery, setSearchQuery] = useState("");
  const [archivedProjects, setArchivedProjects] = useState<ProjectWithDeleteInfo[]>([]);
  const [recycledProjects, setRecycledProjects] = useState<ProjectWithDeleteInfo[]>([]);
  const [isProcessing, setIsProcessing] = useState<string | null>(null);

  const fetchArchiveState = async () => {
    try {
      const data = await projectApi.getProjects({
        include_archived: true,
        include_deleted: true,
        pageSize: 100,
      });
      setArchivedProjects(
        data.items.filter((project) => project.archivedAt && !project.deletedAt)
      );
      setRecycledProjects(
        data.items.filter((project) => Boolean(project.deletedAt))
      );
    } catch (error) {
      toast.error("获取归档项目失败: " + getErrorMessage(error));
    }
  };

  useEffect(() => {
    fetchArchiveState();
  }, []);

  const filteredArchived = archivedProjects.filter(
    (p) =>
      !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredRecycled = recycledProjects.filter(
    (p) =>
      !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleUnarchive = async (projectId: string) => {
    setIsProcessing(projectId);
    try {
      await projectApi.unarchiveProject(projectId);
      await fetchArchiveState();
      toast.success("项目已取消归档");
    } catch (error) {
      toast.error("恢复失败: " + getErrorMessage(error));
    } finally {
      setIsProcessing(null);
    }
  };

  const handleSoftDelete = async (projectId: string) => {
    setIsProcessing(projectId);
    try {
      await projectApi.deleteProject(projectId);
      await fetchArchiveState();
      toast.success("项目已移入回收站");
    } catch (error) {
      toast.error("删除失败: " + getErrorMessage(error));
    } finally {
      setIsProcessing(null);
    }
  };

  const handleRestoreFromRecycle = async (projectId: string) => {
    setIsProcessing(projectId);
    try {
      await projectApi.restoreProject(projectId);
      await fetchArchiveState();
      toast.success("项目已从回收站还原");
    } catch (error) {
      toast.error("还原失败: " + getErrorMessage(error));
    } finally {
      setIsProcessing(null);
    }
  };

  const handlePermanentDelete = async (projectId: string) => {
    setIsProcessing(projectId);
    try {
      toast.info("物理清理由后台回收站保留任务执行");
    } finally {
      setIsProcessing(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
      >
        <div>
          <h1 className="text-display text-gray-800 flex items-center gap-2">
            <Archive className="w-6 h-6 text-gray-500" />
            归档与回收站
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            管理已归档项目和回收站中的项目
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="搜索项目..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:gap-4">
        <StatCard
          title="已归档"
          value={archivedProjects.length}
          icon={<Archive className="w-5 h-5 text-gray-500" />}
        />
        <StatCard
          title="回收站"
          value={recycledProjects.length}
          icon={<Trash2 className="w-5 h-5 text-red-400" />}
          highlight={recycledProjects.length > 0}
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ArchiveTab)}>
        <TabsList>
          <TabsTrigger value="archived" className="text-sm"
          >
            <Archive className="w-4 h-4 mr-1.5" />
            已归档
            <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
              {archivedProjects.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="recycle" className="text-sm"
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            回收站
            <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
              {recycledProjects.length}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="archived" className="mt-4"
        >
          {filteredArchived.length > 0 ? (
            <div className="space-y-3">
              {filteredArchived.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  mode="archived"
                  isProcessing={isProcessing === project.id}
                  onUnarchive={() => handleUnarchive(project.id)}
                  onDelete={() => handleSoftDelete(project.id)}
                  onClick={() => navigate(`/projects/${project.id}`)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Archive className="w-10 h-10 text-gray-300" />}
              title="暂无归档项目"
              subtitle="归档的项目将显示在这里"
            />
          )}
        </TabsContent>

        <TabsContent value="recycle" className="mt-4"
        >
          {filteredRecycled.length > 0 ? (
            <div className="space-y-3">
              {filteredRecycled.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  mode="recycled"
                  isProcessing={isProcessing === project.id}
                  onRestore={() => handleRestoreFromRecycle(project.id)}
                  onPermanentDelete={() => handlePermanentDelete(project.id)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Trash2 className="w-10 h-10 text-gray-300" />}
              title="回收站为空"
              subtitle="删除的项目将在这里保留30天"
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProjectCard({
  project,
  mode,
  isProcessing,
  onUnarchive,
  onDelete,
  onRestore,
  onPermanentDelete,
  onClick,
}: {
  project: ProjectWithDeleteInfo;
  mode: "archived" | "recycled";
  isProcessing: boolean;
  onUnarchive?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onPermanentDelete?: () => void;
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn(
        "transition-all",
        mode === "recycled" && "border-red-200 bg-red-50/20",
        onClick && "cursor-pointer hover:shadow-md"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div className="flex-1 min-w-0"
          >
            <div className="flex items-center gap-2"
            >
              <h3 className="text-sm font-medium text-gray-800"
              >
                {project.name}
              </h3>
              <Badge variant="outline" className="text-[10px]"
              >
                {project.type === "anime"
                  ? "番剧"
                  : project.type === "movie"
                    ? "电影"
                    : "合集"}
              </Badge>
              {mode === "recycled" && (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-red-100 text-red-700 border-red-300"
                >
                  待删除
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap"
            >
              <span className="text-xs text-gray-500"
              >
                第{project.season}季 · {project.episodes}集
              </span>
              <span className="text-xs text-gray-400"
              >
                进度 {project.progress}%
              </span>
              {project.deletedAt && (
                <span className="text-xs text-red-500 flex items-center gap-0.5"
                >
                  <Clock className="w-3 h-3" />
                  删除于{" "}
                  {new Date(project.deletedAt).toLocaleDateString("zh-CN")}
                </span>
              )}
            </div>
            <div className="mt-2"
            >
              <Progress value={project.progress} className="h-1.5 w-48" />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0"
          >
            <AvatarGroup
              users={project.members.map((m) => m.user)}
              max={4}
              size="xs"
            />

            {mode === "archived" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnarchive?.();
                  }}
                  disabled={isProcessing}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  恢复
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete?.();
                  }}
                  disabled={isProcessing}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  删除
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore?.();
                  }}
                  disabled={isProcessing}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  还原
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      onClick={(e) => e.stopPropagation()}
                      disabled={isProcessing}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      彻底删除
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="flex items-center gap-2"
                      >
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                        确认永久删除
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        此操作不可撤销。项目「{project.name}」及其所有关联数据将被永久删除。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => onPermanentDelete?.()}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        确认删除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({
  title,
  value,
  icon,
  highlight,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card
      className={cn(
        "transition-shadow hover:shadow-md",
        highlight && "border-red-200"
      )}
    >
      <CardContent className="p-4 flex items-center justify-between"
      >
        <div>
          <p className="text-sm text-gray-500"
          >{title}</p>
          <p
            className={cn(
              "text-2xl font-bold mt-1",
              highlight ? "text-red-600" : "text-gray-800"
            )}
          >
            {value}
          </p>
        </div>
        <div
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center",
            highlight ? "bg-red-50" : "bg-gray-50"
          )}
        >
          {icon}
        </div>
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
      <CardContent className="flex flex-col items-center py-16 text-center"
      >
        {icon}
        <p className="text-sm text-gray-500 mt-3"
        >{title}</p>
        <p className="text-xs text-gray-400 mt-1"
        >{subtitle}</p>
      </CardContent>
    </Card>
  );
}
