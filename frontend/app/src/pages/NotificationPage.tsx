import { useState, useEffect } from "react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useNotificationStore } from "@/stores/notificationStore";
import { notificationApi } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { Notification, NotificationType } from "@/types";
import {
  Bell,
  CheckCheck,
  ClipboardList,
  CheckCircle2,
  FileText,
  Info,
  AtSign,
  Trash2,
  Settings,
  ArrowRight,
} from "lucide-react";
import { Link } from "react-router";

const typeIcons: Record<NotificationType, React.ReactNode> = {
  task: <ClipboardList className="w-4 h-4 text-blue-500" />,
  review: <CheckCircle2 className="w-4 h-4 text-green-500" />,
  file: <FileText className="w-4 h-4 text-purple-500" />,
  system: <Info className="w-4 h-4 text-gray-500" />,
  mention: <AtSign className="w-4 h-4 text-orange-500" />,
};

const typeLabels: Record<string, string> = {
  all: "全部",
  unread: "未读",
  task: "任务",
  review: "审核",
  system: "系统",
};

export function NotificationPage() {
  const {
    markAsRead,
    markAllAsRead,
    preferences,
    setPreferences,
  } = useNotificationStore();
  const [showPrefs, setShowPrefs] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    notificationApi.getNotifications()
      .then((data) => setNotifications(data.items || []))
      .catch(() => {});
  }, []);

  const filtered =
    activeTab === "all"
      ? notifications
      : activeTab === "unread"
        ? notifications.filter((n) => !n.isRead)
        : notifications.filter((n) => n.type === activeTab);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-display text-gray-800">通知</h1>
          {notifications.filter((n) => !n.isRead).length > 0 && (
            <Badge variant="default" className="text-xs">
              {notifications.filter((n) => !n.isRead).length} 未读
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={markAllAsRead}>
            <CheckCheck className="w-4 h-4 mr-1.5" />
            全部已读
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowPrefs(!showPrefs)}>
            <Settings className="w-4 h-4 mr-1.5" />
            快速设置
          </Button>
          <Link to="/notifications/settings">
            <Button variant="outline" size="sm">
              <ArrowRight className="w-4 h-4 mr-1.5" />
              详细设置
            </Button>
          </Link>
        </div>
      </div>

      {/* Preferences Panel */}
      {showPrefs && (
        <Card className="bg-gray-50/50">
          <CardContent className="p-5">
            <h3 className="text-h3 text-gray-800 mb-4">通知偏好</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700">通知渠道</h4>
                <div className="space-y-2">
                  <PrefSwitch
                    label="站内通知"
                    checked={preferences.inSite}
                    onChange={(v) => setPreferences({ inSite: v })}
                  />
                  <PrefSwitch
                    label="邮件通知"
                    checked={preferences.email}
                    onChange={(v) => setPreferences({ email: v })}
                  />
                  <PrefSwitch
                    label="QQ通知"
                    checked={preferences.qq}
                    onChange={(v) => setPreferences({ qq: v })}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700">渠道升级</h4>
                <PrefSwitch
                  label="启用渠道升级"
                  checked={preferences.escalationEnabled}
                  onChange={(v) => setPreferences({ escalationEnabled: v })}
                />
                <p className="text-xs text-gray-400">
                  站内未读 {preferences.escalationInterval} 小时后升级邮件，邮件未读后升级QQ
                </p>
              </div>
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700">关注类型</h4>
                <div className="space-y-2">
                  {(["task", "review", "file", "mention"] as NotificationType[]).map((type) => (
                    <PrefSwitch
                      key={type}
                      label={type === "task" ? "任务" : type === "review" ? "审核" : type === "file" ? "文件" : "@提及"}
                      checked={preferences.subscribedTypes.includes(type)}
                      onChange={(v) => {
                        const types = new Set(preferences.subscribedTypes);
                        if (v) types.add(type);
                        else types.delete(type);
                        setPreferences({ subscribedTypes: Array.from(types) });
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notification tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {Object.entries(typeLabels).map(([key, label]) => (
            <TabsTrigger key={key} value={key} className="text-xs">
              {label}
              {key === "unread" && (
                <span className="ml-1 text-[10px] text-primary-500">
                  ({notifications.filter((n) => !n.isRead).length})
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          <Card>
            {filtered.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {filtered.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onRead={() => markAsRead(notification.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState />
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NotificationItem({
  notification,
  onRead,
}: {
  notification: Notification;
  onRead: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 md:gap-4 px-4 md:px-6 py-3 md:py-4 hover:bg-gray-50 transition-colors cursor-pointer group",
        !notification.isRead && "bg-blue-50/30"
      )}
      onClick={onRead}
    >
      {/* Unread indicator */}
      <div className="shrink-0 mt-1">
        {!notification.isRead && <div className="w-2 h-2 rounded-full bg-primary-500" />}
        {notification.isRead && <div className="w-2 h-2 rounded-full bg-gray-200" />}
      </div>

      {/* Icon */}
      <div className="shrink-0 mt-0.5">{typeIcons[notification.type]}</div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={cn("text-sm", !notification.isRead ? "font-medium text-gray-800" : "text-gray-700")}>
            {notification.title}
          </p>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{notification.content}</p>
        <span className="text-caption text-gray-400 mt-1 block">
          {formatRelativeTime(notification.createdAt)}
        </span>
      </div>

      {/* Actions */}
      <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
        {!notification.isRead && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); onRead(); }}>
            <CheckCheck className="w-4 h-4 text-gray-400" />
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
          <Trash2 className="w-4 h-4 text-gray-400" />
        </Button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <Bell className="w-10 h-10 text-gray-300" />
      <p className="text-sm text-gray-500 mt-3">暂无通知</p>
    </div>
  );
}

function PrefSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm text-gray-600 cursor-pointer">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
