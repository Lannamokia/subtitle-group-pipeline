import { useState } from "react";
import { useParams } from "react-router";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AvatarGroup, UserAvatar } from "@/components/UserAvatar";
import { TaskCard } from "@/components/TaskCard";
import { FileListItem } from "@/components/FileListItem";
import { TimelineEventItem } from "@/components/TimelineEvent";
import {
  mockProjects,
  mockTasks,
  mockFiles,
  mockTimelineEvents,
  mockWiki,
  mockConflicts,
} from "@/lib/mockData";
import type { TaskStatus } from "@/types";
import {
  FolderKanban,
  FileArchive,
  BookOpen,
  Users,
  Settings,
  Activity,
  GitMerge,
  ArrowLeft,
} from "lucide-react";
import { Link } from "react-router";

type ProjectTab = "tasks" | "files" | "wiki" | "members" | "settings" | "activity" | "dedup";

const KANBAN_COLUMNS: { id: string; title: string; statuses: TaskStatus[] }[] = [
  { id: "todo", title: "待处理", statuses: ["pending_publish", "claimable", "assigned"] },
  { id: "in_progress", title: "进行中", statuses: ["in_progress", "submitted"] },
  { id: "done", title: "已完成", statuses: ["review_approved", "completed"] },
];

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [activeTab, setActiveTab] = useState<ProjectTab>("tasks");

  const project = mockProjects.find((p) => p.id === projectId);
  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-gray-500">项目不存在</p>
        <Link to="/projects" className="text-primary-500 text-sm mt-2">
          返回项目列表
        </Link>
      </div>
    );
  }

  const projectTasks = mockTasks.filter((t) => t.projectId === projectId);
  const projectFiles = mockFiles.filter((f) => f.projectId === projectId);
  const projectEvents = mockTimelineEvents.filter((e) => e.projectId === projectId);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Breadcrumb + Header */}
      <div>
        <Link
          to="/projects"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-3"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          项目
        </Link>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-display text-gray-800">{project.name}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {project.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
              <span className="text-sm text-gray-500">
                第{project.season}季 · {project.episodes}集
              </span>
              <span className="text-sm text-gray-400">
                创建于 {new Date(project.createdAt).toLocaleDateString("zh-CN")}
              </span>
            </div>
          </div>
          <AvatarGroup users={project.members.map((m) => m.user)} max={5} />
        </div>

        {/* Progress bar */}
        <div className="mt-4 flex items-center gap-4">
          <div className="flex-1">
            <Progress value={project.progress} className="h-2" />
          </div>
          <span className="text-sm font-medium text-gray-700 shrink-0">{project.progress}%</span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ProjectTab)}>
        <TabsList className="bg-transparent border-b border-gray-200 w-full justify-start rounded-none h-auto p-0 gap-0 overflow-x-auto scrollbar-thin">
          <ProjectTabTrigger value="tasks" icon={<FolderKanban className="w-4 h-4" />} active={activeTab === "tasks"}>
            任务
          </ProjectTabTrigger>
          <ProjectTabTrigger value="files" icon={<FileArchive className="w-4 h-4" />} active={activeTab === "files"}>
            文件
          </ProjectTabTrigger>
          <ProjectTabTrigger value="wiki" icon={<BookOpen className="w-4 h-4" />} active={activeTab === "wiki"}>
            Wiki
          </ProjectTabTrigger>
          <ProjectTabTrigger value="members" icon={<Users className="w-4 h-4" />} active={activeTab === "members"}>
            成员
          </ProjectTabTrigger>
          <ProjectTabTrigger value="dedup" icon={<GitMerge className="w-4 h-4" />} active={activeTab === "dedup"}>
            去重
          </ProjectTabTrigger>
          <ProjectTabTrigger value="activity" icon={<Activity className="w-4 h-4" />} active={activeTab === "activity"}>
            动态
          </ProjectTabTrigger>
          <ProjectTabTrigger value="settings" icon={<Settings className="w-4 h-4" />} active={activeTab === "settings"}>
            设置
          </ProjectTabTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-6">
          <TasksKanban tasks={projectTasks} />
        </TabsContent>

        <TabsContent value="files" className="mt-6">
          <ProjectFiles files={projectFiles} />
        </TabsContent>

        <TabsContent value="wiki" className="mt-6">
          <ProjectWiki />
        </TabsContent>

        <TabsContent value="members" className="mt-6">
          <ProjectMembers project={project} />
        </TabsContent>

        <TabsContent value="dedup" className="mt-6">
          <DedupView />
        </TabsContent>

        <TabsContent value="activity" className="mt-6">
          <ProjectActivity events={projectEvents} />
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <ProjectSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------- Tab Trigger ---------- */

function ProjectTabTrigger({
  value,
  icon,
  children,
  active,
}: {
  value: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  active: boolean;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        "rounded-none border-b-2 border-transparent px-3 md:px-4 py-3 text-sm gap-1.5 data-[state=active]:shadow-none",
        active
          ? "border-primary-500 text-primary-700 font-medium data-[state=active]:bg-transparent"
          : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
      )}
    >
      {icon}
      {children}
    </TabsTrigger>
  );
}

/* ---------- Tasks Kanban ---------- */

function TasksKanban({ tasks }: { tasks: typeof mockTasks }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4">
      {KANBAN_COLUMNS.map((column) => {
        const columnTasks = tasks.filter((t) => column.statuses.includes(t.status));
        return (
          <Card key={column.id} className="bg-gray-50/50 border-gray-200/60">
            <CardHeader className="px-4 py-3 pb-0">
              <CardTitle className="text-h3 flex items-center justify-between">
                <span>{column.title}</span>
                <span className="text-xs text-gray-400 font-normal bg-gray-100 px-2 py-0.5 rounded-full">
                  {columnTasks.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-3 space-y-2">
              {columnTasks.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
              {columnTasks.length === 0 && (
                <div className="text-center py-8 text-xs text-gray-400">暂无任务</div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------- Project Files ---------- */

function ProjectFiles({ files }: { files: typeof mockFiles }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <CardTitle className="text-h2">项目文件</CardTitle>
        <Button size="sm">
          <FileArchive className="w-4 h-4 mr-1.5" />
          上传文件
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {files.length > 0 ? (
          <div>
            {files.map((file) => (
              <FileListItem
                key={file.id}
                file={file}
                onDownload={() => {}}
                onViewHistory={() => {}}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-sm text-gray-400">暂无文件</div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Project Wiki ---------- */

function ProjectWiki() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6">
      {/* Left sidebar - page nav */}
      <Card className="lg:col-span-1 h-fit">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-h3">Wiki页面</CardTitle>
        </CardHeader>
        <CardContent className="p-2 pt-0">
          <div className="space-y-0.5">
            <WikiNavItem active>项目说明</WikiNavItem>
            <WikiNavItem>角色译名表</WikiNavItem>
            <WikiNavItem>制作规范</WikiNavItem>
            <WikiNavItem>术语对照</WikiNavItem>
          </div>
          <Button variant="ghost" size="sm" className="w-full mt-2 text-primary-500">
            + 添加页面
          </Button>
        </CardContent>
      </Card>

      {/* Right content */}
      <Card className="lg:col-span-3">
        <CardHeader className="flex flex-row items-center justify-between py-4 border-b">
          <div>
            <CardTitle className="text-h2">{mockWiki.title}</CardTitle>
            <p className="text-xs text-gray-400 mt-1">
              最后更新：{mockWiki.updatedBy.username} ·{" "}
              {new Date(mockWiki.updatedAt).toLocaleDateString("zh-CN")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={mockWiki.status === "approved" ? "default" : "outline"}
              className="text-xs"
            >
              {mockWiki.status === "approved" ? "已批准" : mockWiki.status === "pending" ? "待审核" : "草稿"}
            </Badge>
            <Button size="sm" variant="outline">
              编辑
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {mockWiki.blocks.map((block) =>
            block.type === "markdown" ? (
              <div
                key={block.id}
                className="prose prose-sm max-w-none prose-headings:text-gray-800 prose-p:text-gray-600"
              >
                {block.content.split("\n").map((line, i) => {
                  if (line.startsWith("# ")) {
                    return <h1 key={i} className="text-xl font-semibold text-gray-800 mt-4 mb-2">{line.slice(2)}</h1>;
                  }
                  if (line.startsWith("## ")) {
                    return <h2 key={i} className="text-lg font-medium text-gray-700 mt-3 mb-2">{line.slice(3)}</h2>;
                  }
                  if (line.startsWith("- ")) {
                    return <li key={i} className="text-sm text-gray-600 ml-4">{line.slice(2)}</li>;
                  }
                  if (line.trim() === "") {
                    return <div key={i} className="h-2" />;
                  }
                  return <p key={i} className="text-sm text-gray-600 leading-relaxed">{line}</p>;
                })}
              </div>
            ) : (
              <div key={block.id}>
                {block.data && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-50">
                          {(block.data as Record<string, string[]>).headers.map((h: string) => (
                            <th key={h} className="text-left px-3 py-2 font-medium text-gray-700 border border-gray-200">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(block.data as Record<string, string[][]>).rows.map((row: string[], i: number) => (
                          <tr key={i} className="hover:bg-gray-50">
                            {row.map((cell, j) => (
                              <td key={j} className="px-3 py-2 text-gray-600 border border-gray-200">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WikiNavItem({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button
      className={cn(
        "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
        active
          ? "bg-primary-50 text-primary-700 font-medium"
          : "text-gray-600 hover:bg-gray-50"
      )}
    >
      {children}
    </button>
  );
}

/* ---------- Project Members ---------- */

function ProjectMembers({ project }: { project: typeof mockProjects[0] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <CardTitle className="text-h2">项目成员</CardTitle>
        <Button size="sm">邀请成员</Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-gray-100">
          {project.members.map((member) => (
            <div key={member.user.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-6 py-3 sm:py-4 hover:bg-gray-50 gap-2">
              <div className="flex items-center gap-3">
                <UserAvatar user={member.user} size="md" />
                <div>
                  <p className="text-sm font-medium text-gray-800">{member.user.username}</p>
                  <p className="text-xs text-gray-400">QQ: {member.user.qq}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Badge variant="outline" className="text-xs">
                  {member.role === "supervisor"
                    ? "监制"
                    : member.role === "translation"
                      ? "翻译"
                      : member.role === "timing"
                        ? "时轴"
                        : member.role === "post_production"
                          ? "后期"
                          : member.role === "encoding"
                            ? "压制"
                            : member.role === "source"
                              ? "片源"
                              : "发布"}
                </Badge>
                <span className="text-xs text-gray-400">
                  {new Date(member.joinedAt).toLocaleDateString("zh-CN")} 加入
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Dedup View ---------- */

function DedupView() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h2 text-gray-800">字幕去重与冲突解决</h2>
          <p className="text-sm text-gray-500 mt-1">当前合并任务：夏日重现 第3集</p>
        </div>
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300 text-xs">
          处理中
        </Badge>
      </div>

      {/* Timeline visualization placeholder */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-h3">时间轴可视化</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="h-24 bg-gray-50 rounded-lg flex items-center justify-center text-sm text-gray-400">
            时间轴重叠可视化（需要后端ASS解析数据支持）
          </div>
        </CardContent>
      </Card>

      {/* Conflict list */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-h3">冲突列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-100">
            {mockConflicts.map((conflict) => (
              <div key={conflict.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">
                        {formatTime(conflict.startTime)} - {formatTime(conflict.endTime)}
                      </span>
                      <Badge
                        variant={
                          conflict.conflictType === "exact_duplicate"
                            ? "default"
                            : conflict.conflictType === "text_conflict"
                              ? "destructive"
                              : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {conflict.conflictType === "exact_duplicate"
                          ? "完全重复"
                          : conflict.conflictType === "text_conflict"
                            ? "文本冲突"
                            : "时间轴重叠"}
                      </Badge>
                    </div>
                    <div className="space-y-1 mt-2">
                      {conflict.translations.map((t) => (
                        <p key={t.translatorId} className="text-xs text-gray-500">
                          <span className="font-medium text-gray-600">{t.translatorName}:</span>{" "}
                          {t.text}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline">
                      选择保留
                    </Button>
                    <Button size="sm" variant="outline">
                      合并
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

/* ---------- Project Activity ---------- */

function ProjectActivity({ events }: { events: typeof mockTimelineEvents }) {
  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-h2">项目动态</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {events.length > 0 ? (
          <div className="space-y-0">
            {events.map((event) => (
              <TimelineEventItem key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-sm text-gray-400">暂无动态</div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Project Settings ---------- */

function ProjectSettings() {
  return (
    <div className="max-w-full md:max-w-2xl space-y-6 px-0">
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2">项目设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">项目名称</label>
            <input
              type="text"
              defaultValue="夏日重现"
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">项目类型</label>
            <select className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option>番剧</option>
              <option>电影</option>
              <option>合集</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">标签</label>
            <input
              type="text"
              defaultValue="科幻, 悬疑"
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="pt-4 flex items-center gap-3">
            <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50">
              归档项目
            </Button>
            <Button>保存设置</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
