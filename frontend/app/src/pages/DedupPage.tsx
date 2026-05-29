import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router";
import { api, getErrorMessage, normalizeConflict, normalizeProject } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import type { SubtitleConflict, Project } from "@/types";
import {
  ArrowLeft,
  Loader2,
  GitMerge,
  Check,
  Clock,
  AlertTriangle,
  Eye,
  ChevronRight,
} from "lucide-react";

type ApiEnvelope<T> = { data: T };

export function DedupPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const isSupervisor = useAuthStore((s) => s.isSupervisor());
  const [project, setProject] = useState<Project | null>(null);
  const [conflicts, setConflicts] = useState<SubtitleConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConflict, setSelectedConflict] = useState<SubtitleConflict | null>(null);
  const [resolving, setResolving] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "resolved" | "deferred">("all");
  const [leftVersion, setLeftVersion] = useState("");
  const [rightVersion, setRightVersion] = useState("");

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [projectRes, conflictsRes] = await Promise.all([
        api.get<ApiEnvelope<unknown>>(`/projects/${projectId}`),
        api.get<ApiEnvelope<unknown[]>>(`/projects/${projectId}/conflicts`),
      ]);
      setProject(normalizeProject(projectRes.data.data as Record<string, unknown>));
      setConflicts(conflictsRes.data.data.map((conflict) => normalizeConflict(conflict as Record<string, unknown>)));
    } catch (error) {
      toast.error("获取数据失败: " + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleResolve = async (
    conflictId: string,
    resolution: { keepTranslationId?: string; mergedText?: string; status?: "resolved" | "deferred" }
  ) => {
    setResolving(true);
    try {
      await api.post(`/projects/${projectId}/conflicts/${conflictId}/resolve`, resolution);
      toast.success(resolution.status === "deferred" ? "已标记为延后处理" : "冲突已解决");
      setSelectedConflict(null);
      fetchData();
    } catch (error) {
      toast.error("操作失败: " + getErrorMessage(error));
    } finally {
      setResolving(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  const filteredConflicts = conflicts.filter((c) => {
    if (filter === "all") return true;
    return c.resolution?.status === filter;
  });

  const pendingCount = conflicts.filter((c) => !c.resolution || c.resolution.status === "pending").length;
  const resolvedCount = conflicts.filter((c) => c.resolution?.status === "resolved").length;
  const deferredCount = conflicts.filter((c) => c.resolution?.status === "deferred").length;
  const versionOptions = Array.from(
    new Map(
      conflicts.flatMap((conflict) =>
        conflict.translations.map((translation) => [
          translation.translatorId,
          `${translation.translatorName} / ${translation.translatorId}`,
        ])
      )
    ).entries()
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          to={`/projects/${projectId}`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-3"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回项目
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-display text-gray-800">字幕去重与冲突解决</h1>
            <p className="text-sm text-gray-500 mt-1">
              {project?.name} · 共 {conflicts.length} 个冲突
            </p>
          </div>
          <Badge
            variant={pendingCount > 0 ? "destructive" : "default"}
            className="text-xs"
          >
            {pendingCount > 0 ? `${pendingCount} 待处理` : "全部完成"}
          </Badge>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="总冲突" value={conflicts.length} icon={<GitMerge className="w-4 h-4" />} />
        <StatCard
          label="待处理"
          value={pendingCount}
          icon={<AlertTriangle className="w-4 h-4 text-yellow-500" />}
          highlight={pendingCount > 0}
        />
        <StatCard
          label="已解决"
          value={resolvedCount}
          icon={<Check className="w-4 h-4 text-green-500" />}
        />
        <StatCard
          label="已延后"
          value={deferredCount}
          icon={<Clock className="w-4 h-4 text-gray-400" />}
        />
      </div>

      {/* Timeline Visualization */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-h3">版本对比与时间轴可视化</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3">
            <Select value={leftVersion} onValueChange={setLeftVersion}>
              <SelectTrigger>
                <SelectValue placeholder="选择版本 A" />
              </SelectTrigger>
              <SelectContent>
                {versionOptions.map(([id, label]) => (
                  <SelectItem key={id} value={id}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={rightVersion} onValueChange={setRightVersion}>
              <SelectTrigger>
                <SelectValue placeholder="选择版本 B" />
              </SelectTrigger>
              <SelectContent>
                {versionOptions.map(([id, label]) => (
                  <SelectItem key={id} value={id}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!leftVersion || !rightVersion}
              onClick={() => {
                const matched = conflicts.find((conflict) =>
                  conflict.translations.some((item) => item.translatorId === leftVersion) &&
                  conflict.translations.some((item) => item.translatorId === rightVersion)
                );
                if (matched) setSelectedConflict(matched);
              }}
            >
              <GitMerge className="w-4 h-4 mr-1.5" />
              对比
            </Button>
          </div>
          <div className="h-20 bg-gray-50 rounded-lg relative overflow-hidden">
            {/* Timeline track */}
            <div className="absolute inset-x-4 top-1/2 h-1 bg-gray-200 rounded -translate-y-1/2" />
            <div className="absolute left-4 right-4 top-1/2 h-3 -translate-y-1/2 rounded bg-gray-300/70" />
            {/* Conflict markers */}
            {conflicts.map((conflict) => {
              const isResolved = conflict.resolution?.status === "resolved";
              const isDeferred = conflict.resolution?.status === "deferred";
              const leftPercent = Math.min((conflict.startTime / 1800) * 100, 98);
              const widthPercent = Math.max(((conflict.endTime - conflict.startTime) / 1800) * 100, 0.6);
              return (
                <button
                  key={conflict.id}
                  className={cn(
                    "absolute top-1/2 -translate-y-1/2 h-5 rounded-sm border border-white shadow-sm hover:scale-y-125 transition-transform cursor-pointer",
                    isResolved
                      ? "bg-green-400"
                      : isDeferred
                        ? "bg-gray-400"
                        : conflict.conflictType === "text_conflict"
                          ? "bg-red-400"
                          : conflict.conflictType === "exact_duplicate"
                            ? "bg-red-300"
                            : "bg-red-500"
                  )}
                  style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                  onClick={() => setSelectedConflict(conflict)}
                  title={`${formatTime(conflict.startTime)} - ${formatTime(conflict.endTime)}`}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
            <span>00:00</span>
            <span>15:00</span>
            <span>30:00</span>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 text-xs">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />文本冲突</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" />完全重复</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" />时间轴重叠</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" />已解决</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400" />已延后</span>
          </div>
        </CardContent>
      </Card>

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {(["all", "pending", "resolved", "deferred"] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "全部" : f === "pending" ? "待处理" : f === "resolved" ? "已解决" : "已延后"}
          </Button>
        ))}
      </div>

      {/* Conflict list */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-h3">冲突列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-100">
            {filteredConflicts.map((conflict) => (
              <div
                key={conflict.id}
                className="px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => setSelectedConflict(conflict)}
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
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
                      {conflict.resolution?.status && (
                        <Badge
                          variant={
                            conflict.resolution.status === "resolved"
                              ? "default"
                              : "outline"
                          }
                          className="text-[10px]"
                        >
                          {conflict.resolution.status === "resolved"
                            ? "已解决"
                            : "已延后"}
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1 mt-2">
                      {conflict.translations.map((t) => (
                        <p key={t.translatorId} className="text-xs text-gray-500">
                          <span className="font-medium text-gray-600">{t.translatorName}:</span>{" "}
                          <span className="line-clamp-1">{t.text}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                      <Eye className="w-4 h-4" />
                    </Button>
                    <ChevronRight className="w-4 h-4 text-gray-300" />
                  </div>
                </div>
              </div>
            ))}
            {filteredConflicts.length === 0 && (
              <div className="text-center py-12 text-sm text-gray-400">
                暂无冲突
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Conflict Detail Sheet */}
      <Sheet open={!!selectedConflict} onOpenChange={() => setSelectedConflict(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>冲突详情</SheetTitle>
          </SheetHeader>
          {selectedConflict && (
            <div className="mt-6 space-y-6">
              {/* Time info */}
              <div className="flex items-center gap-3">
                <div className="bg-gray-100 rounded-lg px-3 py-2 text-sm font-mono">
                  {formatTime(selectedConflict.startTime)} - {formatTime(selectedConflict.endTime)}
                </div>
                <Badge
                  variant={
                    selectedConflict.conflictType === "exact_duplicate"
                      ? "default"
                      : selectedConflict.conflictType === "text_conflict"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {selectedConflict.conflictType === "exact_duplicate"
                    ? "完全重复"
                    : selectedConflict.conflictType === "text_conflict"
                      ? "文本冲突"
                      : "时间轴重叠"}
                </Badge>
              </div>

              {/* Side-by-side comparison */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-700">版本对比</h3>
                <div className="grid grid-cols-1 gap-3">
                  {selectedConflict.translations.map((t, i) => (
                    <Card key={t.translatorId}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-medium">
                            {t.translatorName.charAt(0)}
                          </div>
                          <span className="text-sm font-medium">{t.translatorName}</span>
                          <span className="text-xs text-gray-400 ml-auto">版本 {i + 1}</span>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 font-mono leading-relaxed">
                          {t.text}
                        </div>
                        <div className="text-xs text-gray-400 mt-2">Style: {t.style}</div>
                        {isSupervisor && (!selectedConflict.resolution || selectedConflict.resolution.status === "pending") && (
                          <Button
                            size="sm"
                            className="mt-3 w-full"
                            onClick={() =>
                              handleResolve(selectedConflict.id, {
                                keepTranslationId: t.translatorId,
                                status: "resolved",
                              })
                            }
                            disabled={resolving}
                          >
                            <Check className="w-3.5 h-3.5 mr-1" />
                            保留此版本
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Manual merge */}
              {isSupervisor &&
                selectedConflict.conflictType === "text_conflict" &&
                (!selectedConflict.resolution || selectedConflict.resolution.status === "pending") && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-gray-700">手动合并</h3>
                    <Textarea
                      placeholder="输入合并后的文本..."
                      className="min-h-[100px] font-mono text-sm"
                      id="merged-text"
                    />
                    <Button
                      className="w-full"
                      onClick={() => {
                        const text = (document.getElementById("merged-text") as HTMLTextAreaElement)?.value;
                        if (text) {
                          handleResolve(selectedConflict.id, {
                            mergedText: text,
                            status: "resolved",
                          });
                        }
                      }}
                      disabled={resolving}
                    >
                      <GitMerge className="w-3.5 h-3.5 mr-1" />
                      提交合并结果
                    </Button>
                  </div>
                )}

              {/* Defer option */}
              {isSupervisor &&
                (!selectedConflict.resolution || selectedConflict.resolution.status === "pending") && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      handleResolve(selectedConflict.id, { status: "deferred" })
                    }
                    disabled={resolving}
                  >
                    <Clock className="w-3.5 h-3.5 mr-1" />
                    标记为延后处理
                  </Button>
                )}

              {/* Resolution info */}
              {selectedConflict.resolution?.status === "resolved" && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-green-700">
                    <Check className="w-4 h-4" />
                    <span className="text-sm font-medium">此冲突已解决</span>
                  </div>
                  {selectedConflict.resolution.mergedText && (
                    <p className="text-sm text-green-600 mt-2 font-mono">
                      合并结果: {selectedConflict.resolution.mergedText}
                    </p>
                  )}
                  {selectedConflict.resolution.keepTranslationId && (
                    <p className="text-sm text-green-600 mt-2">
                      保留版本: {
                        selectedConflict.translations.find(
                          (t) => t.translatorId === selectedConflict.resolution?.keepTranslationId
                        )?.translatorName
                      }
                    </p>
                  )}
                </div>
              )}

              {selectedConflict.resolution?.status === "deferred" && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Clock className="w-4 h-4" />
                    <span className="text-sm font-medium">此冲突已标记为延后处理</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card className={cn(highlight && "border-yellow-300")}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="shrink-0">{icon}</div>
        <div>
          <p className="text-2xl font-semibold text-gray-800">{value}</p>
          <p className="text-xs text-gray-500">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
