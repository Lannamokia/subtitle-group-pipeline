import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mockTemplates } from "@/lib/mockData";
import {
  Plus,
  Search,
  ArrowRight,
  Film,
  Monitor,
  FolderOpen,
} from "lucide-react";

type TemplateType = "all" | "anime" | "movie" | "collection";

const typeIcons: Record<string, React.ReactNode> = {
  anime: <Monitor className="w-4 h-4" />,
  movie: <Film className="w-4 h-4" />,
  collection: <FolderOpen className="w-4 h-4" />,
};

const typeLabels: Record<string, string> = {
  anime: "番剧",
  movie: "电影",
  collection: "合集",
};

export function TemplatePage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TemplateType>("all");

  const filtered = mockTemplates.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display text-gray-800">项目模板</h1>
          <p className="text-sm text-gray-500 mt-1">管理和创建项目模板，快速启动标准化工作流</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-1.5" />
          新建模板
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input placeholder="搜索模板..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Tabs value={typeFilter} onValueChange={(v) => setTypeFilter(v as TemplateType)}>
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="anime">番剧</TabsTrigger>
            <TabsTrigger value="movie">电影</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {filtered.map((template) => (
          <Card key={template.id} className="group hover:shadow-lg transition-all cursor-pointer overflow-hidden">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">{typeIcons[template.type]}</span>
                  <h3 className="text-h3 text-gray-800">{template.name}</h3>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {typeLabels[template.type]}
                </Badge>
              </div>
              <p className="text-sm text-gray-500 line-clamp-2">{template.description}</p>

              {/* Role chain visualization */}
              <div className="flex items-center gap-1 flex-wrap">
                {template.roles
                  .filter((r) => r.enabled)
                  .map((role, i, arr) => (
                    <div key={role.role} className="flex items-center">
                      <span className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-600">
                        {role.role === "source"
                          ? "片源"
                          : role.role === "timing"
                            ? "时轴"
                            : role.role === "translation"
                              ? "翻译"
                              : role.role === "post_production"
                                ? "后期"
                                : role.role === "encoding"
                                  ? "压制"
                                  : "发布"}
                      </span>
                      {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-gray-300 mx-0.5" />}
                    </div>
                  ))}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <span className="text-xs text-gray-400">已使用 {template.useCount} 次</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigate("/projects/new")}>
                    快速开项
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs">
                    编辑
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
