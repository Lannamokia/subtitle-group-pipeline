import { useEffect, useState } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Form,
} from "@/components/ui/form";
import { useNotificationStore } from "@/stores/notificationStore";
import { getErrorMessage, notificationApi } from "@/lib/api";
import { toast } from "sonner";
import type { Notification, NotificationType } from "@/types";
import {
  Bell,
  Mail,
  MessageCircle,
  TrendingUp,
  ClipboardList,
  Check,
  CheckCircle2,
  FileText,
  AtSign,
  Info,
  Save,
  Loader2,
} from "lucide-react";

const settingsSchema = z.object({
  inSite: z.boolean(),
  email: z.boolean(),
  qq: z.boolean(),
  escalationEnabled: z.boolean(),
  escalationInterval: z.number().min(1).max(72),
  subscribedTypes: z.array(z.string()),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

const typeIcons: Record<NotificationType, React.ReactNode> = {
  task: <ClipboardList className="w-4 h-4 text-blue-500" />,
  review: <CheckCircle2 className="w-4 h-4 text-green-500" />,
  file: <FileText className="w-4 h-4 text-purple-500" />,
  system: <Info className="w-4 h-4 text-gray-500" />,
  mention: <AtSign className="w-4 h-4 text-orange-500" />,
};

const typeLabels: Record<NotificationType, string> = {
  task: "任务",
  review: "审核",
  file: "文件",
  system: "系统",
  mention: "@提及",
};


export function NotificationSettingsPage() {
  const { preferences, setPreferences } = useNotificationStore();
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<"preferences" | "delivery">("preferences");

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      inSite: preferences.inSite,
      email: preferences.email,
      qq: preferences.qq,
      escalationEnabled: preferences.escalationEnabled,
      escalationInterval: preferences.escalationInterval,
      subscribedTypes: preferences.subscribedTypes,
    },
  });

  useEffect(() => {
    notificationApi.getPreferences()
      .then((data) => {
        setPreferences(data);
        form.reset(data);
      })
      .catch((error) => toast.error("获取通知偏好失败: " + getErrorMessage(error)))
      .finally(() => setLoading(false));
  }, [form, setPreferences]);

  const onSubmit = async (data: SettingsFormValues) => {
    setSaving(true);
    try {
      const updated = await notificationApi.updatePreferences({
        ...data,
        subscribedTypes: data.subscribedTypes as import("@/types").NotificationType[],
      });
      setPreferences(updated);
      form.reset(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      toast.error("保存失败: " + getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const watchedSubscribedTypes = useWatch({
    control: form.control,
    name: "subscribedTypes",
    defaultValue: [],
  }) as string[];

  const escalationEnabled = useWatch({
    control: form.control,
    name: "escalationEnabled",
    defaultValue: false,
  }) as boolean;

  const toggleType = (type: NotificationType) => {
    const current = form.getValues("subscribedTypes");
    const updated = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    form.setValue("subscribedTypes", updated, { shouldDirty: true });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display text-gray-800">通知设置</h1>
          <p className="text-sm text-gray-500 mt-1">管理通知渠道、升级策略和事件订阅</p>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-0.5 w-fit">
        <button
          onClick={() => setActiveSection("preferences")}
          className={cn(
            "px-4 py-2 text-sm rounded-md transition-colors",
            activeSection === "preferences"
              ? "bg-primary-50 text-primary-700 font-medium"
              : "text-gray-500 hover:text-gray-700"
          )}
        >
          偏好设置
        </button>
        <button
          onClick={() => setActiveSection("delivery")}
          className={cn(
            "px-4 py-2 text-sm rounded-md transition-colors",
            activeSection === "delivery"
              ? "bg-primary-50 text-primary-700 font-medium"
              : "text-gray-500 hover:text-gray-700"
          )}
        >
          投递状态
        </button>
      </div>

      {activeSection === "preferences" ? (
        loading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
            </CardContent>
          </Card>
        ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Channel Preferences */}
            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-h2 flex items-center gap-2">
                  <Bell className="w-5 h-5 text-primary-500" />
                  通知渠道
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ChannelPreferenceRow
                  icon={<Bell className="w-5 h-5 text-blue-500" />}
                  label="站内通知"
                  description="在网站内接收通知提醒"
                  control={
                    <Controller
                      name="inSite"
                      control={form.control}
                      render={({ field }) => (
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      )}
                    />
                  }
                />
                <Separator />
                <ChannelPreferenceRow
                  icon={<Mail className="w-5 h-5 text-green-500" />}
                  label="邮件通知"
                  description="通过邮件接收重要通知"
                  control={
                    <Controller
                      name="email"
                      control={form.control}
                      render={({ field }) => (
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      )}
                    />
                  }
                />
                <Separator />
                <ChannelPreferenceRow
                  icon={<MessageCircle className="w-5 h-5 text-purple-500" />}
                  label="QQ 通知"
                  description="通过 QQ 接收紧急通知"
                  control={
                    <Controller
                      name="qq"
                      control={form.control}
                      render={({ field }) => (
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      )}
                    />
                  }
                />
              </CardContent>
            </Card>

            {/* Escalation Settings */}
            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-h2 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary-500" />
                  渠道升级
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-700">启用渠道升级</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      当低优先级渠道未读时，自动升级到高优先级渠道
                    </p>
                  </div>
                  <Controller
                    name="escalationEnabled"
                    control={form.control}
                    render={({ field }) => (
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    )}
                  />
                </div>

                {escalationEnabled && (
                  <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                    <p className="text-sm text-gray-600">升级路径：</p>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded-md">
                        <Bell className="w-3.5 h-3.5 text-blue-500" />
                        <span className="text-xs text-blue-700">站内</span>
                      </div>
                      <TrendingUp className="w-4 h-4 text-gray-400" />
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 rounded-md">
                        <Mail className="w-3.5 h-3.5 text-green-500" />
                        <span className="text-xs text-green-700">邮件</span>
                      </div>
                      <TrendingUp className="w-4 h-4 text-gray-400" />
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 rounded-md">
                        <MessageCircle className="w-3.5 h-3.5 text-purple-500" />
                        <span className="text-xs text-purple-700">QQ</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-600">升级间隔：</span>
                      <Controller
                        name="escalationInterval"
                        control={form.control}
                        render={({ field }) => (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              max={72}
                              className="w-20 h-8 text-sm"
                              {...field}
                              onChange={(e) => field.onChange(Number(e.target.value))}
                            />
                            <span className="text-sm text-gray-500">小时</span>
                          </div>
                        )}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Event Type Subscriptions */}
            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-h2 flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-primary-500" />
                  事件订阅
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(["task", "review", "file", "mention", "system"] as NotificationType[]).map(
                    (type) => {
                      const isSubscribed = watchedSubscribedTypes.includes(type);
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => toggleType(type)}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                            isSubscribed
                              ? "border-primary-300 bg-primary-50/50"
                              : "border-gray-200 hover:border-gray-300"
                          )}
                        >
                          <div
                            className={cn(
                              "w-5 h-5 rounded border flex items-center justify-center transition-colors",
                              isSubscribed
                                ? "bg-primary-500 border-primary-500"
                                : "border-gray-300"
                            )}
                          >
                            {isSubscribed && <Check className="w-3.5 h-3.5 text-white" />}
                          </div>
                          <div className="flex items-center gap-2">
                            {typeIcons[type]}
                            <span className="text-sm text-gray-700">{typeLabels[type]}</span>
                          </div>
                        </button>
                      );
                    }
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Submit */}
            <div className="flex items-center justify-end gap-3">
              {saved && (
                <span className="text-sm text-green-600 flex items-center gap-1">
                  <Check className="w-4 h-4" />
                  已保存
                </span>
              )}
              <Button type="submit" disabled={!form.formState.isDirty || saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                保存设置
              </Button>
            </div>
          </form>
        </Form>
        )
      ) : (
        <DeliveryStatusView />
      )}
    </div>
  );
}

function ChannelPreferenceRow({
  icon,
  label,
  description,
  control,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700">{label}</p>
          <p className="text-xs text-gray-400">{description}</p>
        </div>
      </div>
      {control}
    </div>
  );
}

function DeliveryStatusView() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    notificationApi.getNotifications({ pageSize: 20 })
      .then((data) => setNotifications(data.items))
      .catch((error) => toast.error("获取投递记录失败: " + getErrorMessage(error)))
      .finally(() => setLoading(false));
  }, []);

  const deliveryRows = notifications.flatMap((notification) =>
    (notification.deliveries ?? []).map((delivery) => ({
      notification,
      delivery,
    }))
  );

  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-h2">最近投递记录</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
          </div>
        ) : deliveryRows.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {deliveryRows.map(({ notification, delivery }) => (
              <div key={`${notification.id}-${delivery.id}`} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{notification.title}</p>
                  <p className="text-xs text-gray-500">
                    {delivery.channel.toUpperCase()} · {delivery.sentAt ? new Date(delivery.sentAt).toLocaleString("zh-CN") : "等待发送"}
                  </p>
                </div>
                <span
                  className={cn(
                    "text-xs px-2 py-1 rounded-full",
                    delivery.status === "failed"
                      ? "bg-red-50 text-red-600"
                      : delivery.status === "pending"
                        ? "bg-yellow-50 text-yellow-700"
                        : "bg-green-50 text-green-700"
                  )}
                >
                  {delivery.status === "failed" ? "失败" : delivery.status === "pending" ? "等待" : "已发送"}
                </span>
              </div>
            ))}
          </div>
        ) : (
        <div className="flex flex-col items-center py-16 text-center">
          <Info className="w-10 h-10 text-gray-300" />
          <p className="text-sm text-gray-500 mt-3">暂无投递记录</p>
        </div>
        )}
      </CardContent>
    </Card>
  );
}
