import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Bot, KeyRound, Loader2, Mail, Save, ShieldCheck } from "lucide-react";
import { systemApi, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { QqBridgeSettings, SmtpSettings } from "@/types";

const defaultSettings: SmtpSettings = {
  enabled: false,
  host: "",
  port: 587,
  secure: false,
  username: "",
  password: "",
  passwordConfigured: false,
  fromAddress: "",
  fromName: "",
  rejectUnauthorized: true,
};

const defaultQqBridgeSettings: QqBridgeSettings = {
  enabled: false,
  endpoint: "",
  secret: "",
  secretConfigured: false,
};

export function SmtpSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SmtpSettings>(defaultSettings);
  const [qqBridge, setQqBridge] = useState<QqBridgeSettings>(defaultQqBridgeSettings);

  useEffect(() => {
    Promise.all([systemApi.getSmtpSettings(), systemApi.getQqBridgeSettings()])
      .then(([data, bridge]) => {
        setSettings({
          ...defaultSettings,
          ...data,
          password: data.passwordConfigured ? "********" : "",
        });
        setQqBridge({
          ...defaultQqBridgeSettings,
          ...bridge,
          endpoint: bridge.endpoint ?? "",
          secret: bridge.secretConfigured ? "********" : "",
        });
      })
      .catch((error) => toast.error("获取通知渠道设置失败: " + getErrorMessage(error)))
      .finally(() => setLoading(false));
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const [saved, savedBridge] = await Promise.all([
        systemApi.updateSmtpSettings(settings),
        systemApi.updateQqBridgeSettings(qqBridge),
      ]);
      setSettings({
        ...defaultSettings,
        ...saved,
        password: saved.passwordConfigured ? "********" : "",
      });
      setQqBridge({
        ...defaultQqBridgeSettings,
        ...savedBridge,
        endpoint: savedBridge.endpoint ?? "",
        secret: savedBridge.secretConfigured ? "********" : "",
      });
      toast.success("通知渠道设置已保存");
    } catch (error) {
      toast.error("保存失败: " + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-display text-gray-800 flex items-center gap-2">
          <Bell className="h-6 w-6 text-gray-400" />
          通知渠道
        </h1>
        <p className="mt-1 text-sm text-gray-500">配置系统邮件投递和 QQ 机器人桥接器交互参数。</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-h2 flex items-center gap-2">
              <Mail className="h-5 w-5 text-gray-400" />
              邮件服务
            </CardTitle>
            <CardDescription>启用后，邮件通知会通过这里配置的 SMTP 服务器发送。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-lg border bg-gray-50 p-4">
              <div>
                <Label>启用邮件发送</Label>
                <p className="mt-1 text-xs text-gray-500">关闭时系统仍会记录邮件投递，但不会真实发送。</p>
              </div>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(enabled) => setSettings((prev) => ({ ...prev, enabled }))}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
              <div className="space-y-2">
                <Label htmlFor="smtp-host">SMTP 主机</Label>
                <Input
                  id="smtp-host"
                  value={settings.host}
                  placeholder="smtp.example.com"
                  onChange={(event) => setSettings((prev) => ({ ...prev, host: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-port">端口</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={settings.port}
                  onChange={(event) => {
                    const port = Number(event.target.value);
                    setSettings((prev) => ({ ...prev, port, secure: port === 465 ? true : prev.secure }));
                  }}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="smtp-user">SMTP 用户名</Label>
                <Input
                  id="smtp-user"
                  value={settings.username ?? ""}
                  placeholder="通常为邮箱账号"
                  onChange={(event) => setSettings((prev) => ({ ...prev, username: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-password">SMTP 密码或授权码</Label>
                <Input
                  id="smtp-password"
                  type="password"
                  value={settings.password ?? ""}
                  placeholder={settings.passwordConfigured ? "已保存，留空则不修改" : "填写 SMTP 密码或授权码"}
                  onChange={(event) => setSettings((prev) => ({ ...prev, password: event.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="smtp-from-address">发件邮箱</Label>
                <Input
                  id="smtp-from-address"
                  type="email"
                  value={settings.fromAddress}
                  placeholder="noreply@example.com"
                  onChange={(event) => setSettings((prev) => ({ ...prev, fromAddress: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-from-name">发件人名称</Label>
                <Input
                  id="smtp-from-name"
                  value={settings.fromName ?? ""}
                  placeholder="字幕组协作平台"
                  onChange={(event) => setSettings((prev) => ({ ...prev, fromName: event.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>SSL/TLS 加密连接</Label>
                  <p className="mt-1 text-xs text-gray-500">465 端口通常需要开启。</p>
                </div>
                <Switch
                  checked={settings.secure}
                  onCheckedChange={(secure) => setSettings((prev) => ({ ...prev, secure }))}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>校验证书</Label>
                  <p className="mt-1 text-xs text-gray-500">生产环境建议保持开启。</p>
                </div>
                <Switch
                  checked={settings.rejectUnauthorized}
                  onCheckedChange={(rejectUnauthorized) => setSettings((prev) => ({ ...prev, rejectUnauthorized }))}
                />
              </div>
            </div>

            {settings.passwordConfigured && (
              <div className="flex items-start gap-2 rounded-lg bg-primary-50 px-3 py-2 text-xs text-primary-700">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                已保存 SMTP 密码。再次保存时保留星号会继续使用原密码，填写新内容则会覆盖。
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-h2 flex items-center gap-2">
              <Bot className="h-5 w-5 text-gray-400" />
              QQ 机器人桥接器
            </CardTitle>
            <CardDescription>配置后端与 NoneBot HTTP 接口交互使用的地址和密钥。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-lg border bg-gray-50 p-4">
              <div>
                <Label>启用 QQ 桥接器</Label>
                <p className="mt-1 text-xs text-gray-500">关闭时健康检查显示未配置，QQ 通知不会真实发送。</p>
              </div>
              <Switch
                checked={qqBridge.enabled}
                onCheckedChange={(enabled) => setQqBridge((prev) => ({ ...prev, enabled }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="qq-bridge-endpoint">NoneBot HTTP API 地址</Label>
              <Input
                id="qq-bridge-endpoint"
                value={qqBridge.endpoint ?? ""}
                placeholder="http://127.0.0.1:8095"
                onChange={(event) => setQqBridge((prev) => ({ ...prev, endpoint: event.target.value }))}
              />
              <p className="text-xs text-gray-500">示例：NoneBot 反向或 HTTP 插件暴露的本机服务地址。</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="qq-bridge-secret">交互密钥</Label>
              <Input
                id="qq-bridge-secret"
                type="password"
                value={qqBridge.secret ?? ""}
                placeholder={qqBridge.secretConfigured ? "已保存，留空则不修改" : "填写后端与机器人共用的 secret"}
                onChange={(event) => setQqBridge((prev) => ({ ...prev, secret: event.target.value }))}
              />
            </div>

            <div className="flex items-start gap-2 rounded-lg border bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              这个密钥会用于 QQ 机器人回调验证和后端调用机器人接口。机器人侧需要使用同一个值作为 Authorization Bearer Token。
            </div>

            {qqBridge.secretConfigured && (
              <div className="flex items-start gap-2 rounded-lg bg-primary-50 px-3 py-2 text-xs text-primary-700">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                已保存 QQ 桥接器密钥。再次保存时保留星号会继续使用原密钥，填写新内容则会覆盖。
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
          保存设置
        </Button>
      </div>
    </div>
  );
}
