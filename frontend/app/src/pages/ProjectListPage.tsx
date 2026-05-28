import { useState } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AvatarGroup } from "@/components/UserAvatar";
import { Progress } from "@/components/ui/progress";
import { mockProjects } from "@/lib/mockData";
import {
  FolderKanban,
  Layers,
  Search,
  ArrowRight,
} from "lucide-react";

type ProjectStatus = "all" | "active" | "completed" | "archived";

export function ProjectListPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus>("all");
  const [scope, setScope] = useState<"mine" | "all">("mine");

  const filteredProjects = mockProjects.filter((p) => {
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (scope === "mine") {
      return p.members.some((m) => m.user.id === "u1");
    }
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display text-gray-800">项目</h1>
          <p className="text-sm text-gray-500 mt-1">共 {filteredProjects.length} 个项目</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => navigate("/templates")}>
            <Layers className="w-4 h-4 mr-1.5" />
            从模板创建
          </Button>
          <Button onClick={() => navigate("/projects/new")}>
            <FolderKanban className="w-4 h-4 mr-1.5" />
            新建项目
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="搜索项目名称..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center bg-white rounded-md border border-gray-200 p-0.5">
          <FilterTab active={scope === "mine"} onClick={() => setScope("mine")}>
            我参与的
          </FilterTab>
          <FilterTab active={scope === "all"} onClick={() => setScope("all")}>
            全部
          </FilterTab>
        </div>

        <div className="flex items-center gap-1">
          {(["all", "active", "completed", "archived"] as ProjectStatus[]).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "ghost"}
              size="sm"
              className={cn(
                "text-xs h-8 px-3",
                statusFilter === s && ""
              )}
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "全部" : s === "active" ? "进行中" : s === "completed" ? "已完成" : "已归档"}
            </Button>
          ))}
        </div>
      </div>

      {/* Project grid */}
      {filteredProjects.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {filteredProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <EmptyProjectState onCreate={() => navigate("/projects/new")} />
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: typeof mockProjects[0] }) {
  const navigate = useNavigate();
  const statusLabels: Record<string, { label: string; className: string }> = {
    active: { label: "进行中", className: "badge-info" },
    completed: { label: "已完成", className: "badge-success" },
    archived: { label: "已归档", className: "badge-neutral" },
  };
  const status = statusLabels[project.status] || statusLabels.active;

  return (
    <Card
      className="group cursor-pointer hover:shadow-lg transition-all duration-200 overflow-hidden"
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      <CardContent className="p-5 space-y-4">
        {/* Top: Title + Status */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-h3 text-gray-800 line-clamp-1 flex-1">{project.name}</h3>
          <span className={cn("shrink-0 text-caption px-2 py-0.5 rounded-md", status.className)}>
            {status.label}
          </span>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5">
          {project.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px] font-normal">
              {tag}
            </Badge>
          ))}
          {project.tags.length > 3 && (
            <Badge variant="outline" className="text-[10px] font-normal">
              +{project.tags.length - 3}
            </Badge>
          )}
        </div>

        {/* Season info */}
        <p className="text-small text-gray-500">
          第{project.season}季 · {project.episodes}集
        </p>

        {/* Progress */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">进度</span>
            <span className="text-gray-700 font-medium">{project.progress}%</span>
          </div>
          <Progress value={project.progress} className="h-1.5" />
        </div>

        {/* Bottom: Members + Time + Arrow */}
        <div className="flex items-center justify-between pt-1">
          <AvatarGroup users={project.members.map((m) => m.user)} max={5} size="xs" />
          <div className="flex items-center gap-2">
            <span className="text-caption text-gray-400">
              {new Date(project.updatedAt).toLocaleDateString("zh-CN")}
            </span>
            <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-primary-500 transition-colors" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 text-xs rounded-md transition-colors",
        active
          ? "bg-primary-50 text-primary-700 font-medium"
          : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
      )}
    >
      {children}
    </button>
  );
}

function EmptyProjectState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-4">
        <FolderKanban className="w-8 h-8 text-gray-300" />
      </div>
      <p className="text-sm text-gray-500">暂无项目</p>
      <p className="text-xs text-gray-400 mt-1">创建你的首个项目开始协作</p>
      <Button className="mt-4" onClick={onCreate}>
        创建项目
      </Button>
    </div>
  );
}
