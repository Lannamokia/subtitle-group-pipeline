import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Activity, Bot, CheckCircle2, Database, Loader2, RefreshCw, XCircle } from "lucide-react";
import { systemApi, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { GlobalHealthStatus } from "@/types";

function StatusBadge({ healthy, unavailableLabel = "异常" }: { healthy: boolean; unavailableLabel?: string }) {
  return healthy ? (
    <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
      正常
    </Badge>
  ) : (
    <Badge variant="destructive">
      <XCircle className="mr-1 h-3.5 w-3.5" />
      {unavailableLabel}
    </Badge>
  );
}

function QQBridgeStatusBadge({ configured, connected }: { configured: boolean; connected: boolean }) {
  if (!configured) {
    return (
      <Badge variant="outline" className="text-gray-600">
        未配置
      </Badge>
    );
  }

  return <StatusBadge healthy={connected} unavailableLabel="未连接" />;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-3 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="max-w-[70%] break-words text-right text-sm font-medium text-gray-800">{value || "-"}</span>
    </div>
  );
}

export function GlobalHealthPage() {
  const [health, setHealth] = useState<GlobalHealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadHealth = async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setHealth(await systemApi.getGlobalHealth());
    } catch (error) {
      toast.error("获取健康检查失败: " + getErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadHealth();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-display text-gray-800 flex items-center gap-2">
            <Activity className="h-6 w-6 text-gray-400" />
            全局健康检查
          </h1>
          <p className="mt-1 text-sm text-gray-500">查看数据库和 QQ 机器人桥接器的当前连接状态。</p>
        </div>
        <Button variant="outline" onClick={() => loadHealth(true)} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          刷新
        </Button>
      </div>

      {health && (
        <>
          <div className="text-xs text-gray-500">
            检查时间：{new Date(health.checkedAt).toLocaleString()}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <CardTitle className="text-h2 flex items-center gap-2">
                    <Database className="h-5 w-5 text-gray-400" />
                    数据库
                  </CardTitle>
                  <StatusBadge healthy={health.database.connected} />
                </div>
                <CardDescription>当前 Prisma 数据源连接状态。</CardDescription>
              </CardHeader>
              <CardContent>
                <InfoRow label="连接状态" value={health.database.connected ? "已连接" : "未连接"} />
                <InfoRow label="数据库类型" value={health.database.type} />
                <InfoRow label="数据库版本" value={health.database.version ?? "-"} />
                {health.database.error && <InfoRow label="错误信息" value={health.database.error} />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <CardTitle className="text-h2 flex items-center gap-2">
                    <Bot className="h-5 w-5 text-gray-400" />
                    QQ 机器人桥接器
                  </CardTitle>
                  <QQBridgeStatusBadge
                    configured={health.qqBridge.configured}
                    connected={health.qqBridge.connected}
                  />
                </div>
                <CardDescription>NoneBot HTTP 桥接器访问状态。</CardDescription>
              </CardHeader>
              <CardContent>
                <InfoRow label="配置状态" value={health.qqBridge.configured ? "已配置" : "未配置"} />
                <InfoRow
                  label="连接状态"
                  value={!health.qqBridge.configured ? "未配置" : health.qqBridge.connected ? "已连接" : "未连接"}
                />
                <InfoRow label="桥接地址" value={health.qqBridge.endpoint ?? "-"} />
                <InfoRow label="访问令牌" value={health.qqBridge.tokenConfigured ? "已配置" : "未配置"} />
                {health.qqBridge.error && <InfoRow label="错误信息" value={health.qqBridge.error} />}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
