import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { storageApi, getErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { Clock, Archive, Trash2, Download, ShieldCheck, Loader2 } from "lucide-react";

export function DataRetentionPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    archiveCleanupDays: 365,
    recycleBinDays: 30,
    downloadLinkTtl: 300,
    wikiApprovalRequired: false,
  });

  useEffect(() => {
    storageApi.getRetentionSettings()
      .then((data) => {
        setSettings({
          archiveCleanupDays: data.archiveCleanupDays,
          recycleBinDays: data.recycleBinDays,
          downloadLinkTtl: data.downloadLinkTtl,
          wikiApprovalRequired: Boolean(data.wikiApprovalRequired),
        });
      })
      .catch((error) => toast.error("获取保留策略失败: " + getErrorMessage(error)))
      .finally(() => setLoading(false));
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const saved = await storageApi.updateRetentionSettings(settings);
      setSettings({
        archiveCleanupDays: saved.archiveCleanupDays,
        recycleBinDays: saved.recycleBinDays,
        downloadLinkTtl: saved.downloadLinkTtl,
        wikiApprovalRequired: Boolean(saved.wikiApprovalRequired),
      });
      toast.success("保留策略已保存");
    } catch (error) {
      toast.error("保存失败: " + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="max-w-full md:max-w-3xl mx-auto space-y-6 px-0">
      <div>
        <h1 className="text-display text-gray-800 flex items-center gap-2">
          <Clock className="w-6 h-6 text-gray-400" />
          数据保留策略
        </h1>
        <p className="text-sm text-gray-500 mt-1">配置归档清理、回收站和下载链接保留策略</p>
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2 flex items-center gap-2">
            <Archive className="w-5 h-5 text-gray-400" />
            归档清理
          </CardTitle>
          <CardDescription>归档项目满指定天数后自动清理旧版本</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>归档版本清理天数</Label>
            <Input
              type="number"
              value={settings.archiveCleanupDays}
              min={1}
              onChange={(e) => setSettings((prev) => ({ ...prev, archiveCleanupDays: Number(e.target.value) }))}
            />
            <p className="text-xs text-gray-500">归档满N天后自动清理旧版本，仅保留终稿</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2 flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-gray-400" />
            回收站
          </CardTitle>
          <CardDescription>回收站中项目的保留时间</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>回收站保留天数</Label>
            <Input
              type="number"
              value={settings.recycleBinDays}
              min={1}
              onChange={(e) => setSettings((prev) => ({ ...prev, recycleBinDays: Number(e.target.value) }))}
            />
            <p className="text-xs text-gray-500">超过保留天数的项目将被永久删除</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2 flex items-center gap-2">
            <Download className="w-5 h-5 text-gray-400" />
            下载链接
          </CardTitle>
          <CardDescription>临时下载链接的有效期设置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>链接有效期（秒）</Label>
            <Input
              type="number"
              value={settings.downloadLinkTtl}
              min={90}
              onChange={(e) => setSettings((prev) => ({ ...prev, downloadLinkTtl: Number(e.target.value) }))}
            />
            <p className="text-xs text-gray-500">最小90秒，建议300秒（5分钟）</p>
          </div>
          <div className="space-y-2">
            <Label>清理间隔（秒）</Label>
            <Input type="number" value={30} min={10} disabled />
            <p className="text-xs text-gray-500">后台任务扫描过期链接的间隔</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-gray-400" />
            Wiki 审批
          </CardTitle>
          <CardDescription>配置项目 Wiki 是否默认需要监制审批</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>默认开启 Wiki 审批流</Label>
              <p className="text-xs text-gray-500 mt-1">项目监制仍可在项目设置中覆盖此默认值</p>
            </div>
            <Switch
              checked={settings.wikiApprovalRequired}
              onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, wikiApprovalRequired: checked }))}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={saveSettings} disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
          保存设置
        </Button>
      </div>
    </div>
  );
}
