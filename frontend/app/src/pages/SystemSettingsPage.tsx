import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  Bot,
  Brush,
  Database,
  HardDrive,
  Layers,
  Megaphone,
  MonitorCheck,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { NotificationSettingsPage } from "@/pages/NotificationSettingsPage";
import { TemplatePage } from "@/pages/TemplatePage";
import { AnnouncementAdminPage } from "@/pages/admin/AnnouncementAdminPage";
import { DataRetentionPage } from "@/pages/admin/DataRetentionPage";
import { RegistrationSettingsPage } from "@/pages/admin/RegistrationSettingsPage";
import { StorageBackendPage } from "@/pages/admin/StorageBackendPage";
import { BrandingSettingsPage } from "@/pages/admin/BrandingSettingsPage";
import { SmtpSettingsPage } from "@/pages/admin/SmtpSettingsPage";
import { GlobalHealthPage } from "@/pages/admin/GlobalHealthPage";

type SettingsSection =
  | "branding"
  | "registration"
  | "storage"
  | "retention"
  | "templates"
  | "announcements"
  | "smtp"
  | "health"
  | "notifications";

interface SettingsCardConfig {
  id: SettingsSection;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  supervisorPlus?: boolean;
}

const SETTINGS_SECTIONS: SettingsCardConfig[] = [
  {
    id: "branding",
    title: "系统标识",
    description: "系统名称、Logo 和浏览器标题",
    icon: Brush,
    superAdminOnly: true,
  },
  {
    id: "registration",
    title: "注册与标签",
    description: "注册策略、QQ 验证和岗位标签",
    icon: ShieldCheck,
    adminOnly: true,
  },
  {
    id: "storage",
    title: "存储后端",
    description: "本地与 S3 存储、容量和默认后端",
    icon: HardDrive,
    adminOnly: true,
  },
  {
    id: "retention",
    title: "保留策略",
    description: "归档清理、回收站和临时链接",
    icon: Database,
    adminOnly: true,
  },
  {
    id: "templates",
    title: "项目模板",
    description: "流程角色、上传策略和交付清单",
    icon: Layers,
    supervisorPlus: true,
  },
  {
    id: "announcements",
    title: "公告管理",
    description: "全局公告和项目公告",
    icon: Megaphone,
    adminOnly: true,
  },
  {
    id: "notifications",
    title: "通知偏好",
    description: "站内、邮件、QQ 和升级规则",
    icon: Bell,
  },
  {
    id: "smtp",
    title: "通知渠道",
    description: "SMTP 邮件、QQ 桥接器和交互密钥",
    icon: Bot,
    adminOnly: true,
  },
  {
    id: "health",
    title: "全局健康检查",
    description: "数据库和 QQ 桥接器连接状态",
    icon: MonitorCheck,
    adminOnly: true,
  },
];

export function SystemSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const isAdmin = useAuthStore((state) => state.isAdmin());
  const isSupervisor = useAuthStore((state) => state.isSupervisor());

  const sections = useMemo(
    () =>
      SETTINGS_SECTIONS.filter((section) => {
        if (section.superAdminOnly) return user?.role === "super_admin";
        if (section.adminOnly) return isAdmin;
        if (section.supervisorPlus) return isSupervisor;
        return true;
      }),
    [isAdmin, isSupervisor, user?.role]
  );

  const requestedSection = searchParams.get("section") as SettingsSection | null;
  const activeSection =
    sections.find((section) => section.id === requestedSection)?.id ?? sections[0]?.id ?? "notifications";

  useEffect(() => {
    if (requestedSection !== activeSection) {
      setSearchParams({ section: activeSection }, { replace: true });
    }
  }, [activeSection, requestedSection, setSearchParams]);

  const activeConfig = sections.find((section) => section.id === activeSection);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Settings className="h-6 w-6 text-gray-500" />
            <h1 className="text-display text-gray-800">系统设置</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">集中管理系统、模板、通知和运维策略。</p>
        </div>
        {activeConfig && (
          <Badge variant="outline" className="w-fit text-xs">
            当前：{activeConfig.title}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-2">
          {sections.map((section) => {
            const Icon = section.icon;
            const active = section.id === activeSection;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setSearchParams({ section: section.id })}
                className={cn(
                  "w-full rounded-lg border bg-white p-4 text-left shadow-sm transition-colors",
                  active
                    ? "border-primary-200 bg-primary-50/70"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                      active ? "bg-primary-100 text-primary-700" : "bg-gray-100 text-gray-500"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800">{section.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-gray-500">{section.description}</span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="min-w-0">
          {activeSection === "registration" && <RegistrationSettingsPage />}
          {activeSection === "branding" && <BrandingSettingsPage />}
          {activeSection === "storage" && <StorageBackendPage />}
          {activeSection === "retention" && <DataRetentionPage />}
          {activeSection === "templates" && <TemplatePage />}
          {activeSection === "announcements" && <AnnouncementAdminPage />}
          {activeSection === "notifications" && <NotificationSettingsPage />}
          {activeSection === "smtp" && <SmtpSettingsPage />}
          {activeSection === "health" && <GlobalHealthPage />}
        </div>
      </div>
    </div>
  );
}
