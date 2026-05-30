import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { getBrandLogoUrl, useBrandingStore } from "@/stores/brandingStore";
import { useUIStore } from "@/stores/uiStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LayoutDashboard,
  FolderKanban,
  FileArchive,
  Bell,
  Layers,
  Users,
  Settings,
  Search,
  Plus,
  LogOut,
  UserCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Award,
  Archive,
  BarChart3,
} from "lucide-react";

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  supervisorPlus?: boolean;
}

const mainNavItems: NavItem[] = [
  { path: "/dashboard", label: "工作台", icon: <LayoutDashboard className="w-5 h-5 md:w-5 md:h-5" /> },
  { path: "/projects", label: "项目", icon: <FolderKanban className="w-5 h-5 md:w-5 md:h-5" /> },
  { path: "/files", label: "文件", icon: <FileArchive className="w-5 h-5 md:w-5 md:h-5" /> },
  { path: "/notifications", label: "通知", icon: <Bell className="w-5 h-5 md:w-5 md:h-5" /> },
];

const memberNavItems: NavItem[] = [
  { path: "/skill-profile", label: "技能档案", icon: <Award className="w-5 h-5 md:w-5 md:h-5" /> },
  { path: "/archive", label: "归档", icon: <Archive className="w-5 h-5 md:w-5 md:h-5" /> },
];

const adminNavItems: NavItem[] = [
  { path: "/workload", label: "工作量", icon: <BarChart3 className="w-5 h-5" />, supervisorPlus: true },
  { path: "/members", label: "成员管理", icon: <Users className="w-5 h-5" />, adminOnly: true },
  { path: "/admin/settings", label: "系统设置", icon: <Settings className="w-5 h-5" />, supervisorPlus: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isAdmin } = useAuthStore();
  const branding = useBrandingStore((state) => state.branding);
  const logoUrl = getBrandLogoUrl(branding);
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const { unreadCount } = useNotificationStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openNavTooltip, setOpenNavTooltip] = useState<string | null>(null);

  useEffect(() => {
    setOpenNavTooltip(null);
  }, [sidebarCollapsed]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const isActive = (path: string) => {
    if (path === "/dashboard") return location.pathname === "/dashboard";
    return location.pathname.startsWith(path);
  };

  const filteredNavItems = [
    ...mainNavItems,
    ...memberNavItems,
    ...adminNavItems.filter((item) => {
      if (item.adminOnly) return isAdmin();
      if (item.supervisorPlus) return useAuthStore.getState().isSupervisor();
      return true;
    }),
  ];

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-screen bg-gray-50">
        {/* Desktop Sidebar - hidden on mobile */}
        <aside
          className={cn(
            "hidden md:flex flex-col bg-white border-r border-gray-200 transition-all duration-300 shrink-0",
            sidebarCollapsed ? "w-16" : "w-52"
          )}
        >
          {/* Logo */}
          <div className="h-14 flex items-center px-4 border-b border-gray-100">
            <Link to="/dashboard" className="flex items-center gap-2.5">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={branding.appName}
                  className="w-8 h-8 rounded-lg object-cover shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-primary-500 flex items-center justify-center shrink-0">
                  <span className="text-white font-bold text-sm">{branding.appName.charAt(0)}</span>
                </div>
              )}
              {!sidebarCollapsed && (
                <span className="font-semibold text-gray-800 text-sm tracking-tight">
                  {branding.appName}
                </span>
              )}
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto scrollbar-thin">
            {filteredNavItems.map((item) => (
              <Tooltip
                key={item.path}
                open={sidebarCollapsed && openNavTooltip === item.path}
                onOpenChange={(open) => setOpenNavTooltip(open ? item.path : null)}
              >
                <TooltipTrigger asChild>
                  <Link
                    to={item.path}
                    onMouseEnter={() => setOpenNavTooltip(item.path)}
                    onMouseLeave={() => setOpenNavTooltip(null)}
                    onFocus={() => setOpenNavTooltip(item.path)}
                    onBlur={() => setOpenNavTooltip(null)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors relative",
                      isActive(item.path)
                        ? "bg-primary-50 text-primary-700 font-medium"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    )}
                  >
                    {isActive(item.path) && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary-500 rounded-r" />
                    )}
                    <span className="shrink-0">{item.icon}</span>
                    {!sidebarCollapsed && (
                      <span className="truncate">{item.label}</span>
                    )}
                    {!sidebarCollapsed && item.path === "/notifications" && unreadCount > 0 && (
                      <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 bg-primary-500 text-white text-[10px] font-medium rounded-full flex items-center justify-center">
                        {unreadCount}
                      </span>
                    )}
                  </Link>
                </TooltipTrigger>
                {sidebarCollapsed && (
                  <TooltipContent side="right" sideOffset={8}>
                    <div className="flex items-center gap-2">
                      {item.label}
                      {item.path === "/notifications" && unreadCount > 0 && (
                        <span className="text-primary-600 font-medium">({unreadCount})</span>
                      )}
                    </div>
                  </TooltipContent>
                )}
              </Tooltip>
            ))}
          </nav>

          {/* Bottom area */}
          <div className="p-2 border-t border-gray-100 space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "w-full justify-start text-gray-500 hover:text-gray-700",
                sidebarCollapsed && "justify-center px-0"
              )}
              onClick={toggleSidebar}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-5 h-5" />
              ) : (
                <>
                  <PanelLeftClose className="w-5 h-5 mr-2" />
                  <span className="text-sm">收起侧边栏</span>
                </>
              )}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-start h-auto py-2 hover:bg-gray-50",
                    sidebarCollapsed && "justify-center px-0"
                  )}
                >
                  <Avatar className="w-7 h-7 shrink-0">
                    <AvatarFallback className="bg-primary-100 text-primary-700 text-xs font-medium">
                      {user?.username?.charAt(0).toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  {!sidebarCollapsed && (
                    <div className="ml-2 text-left overflow-hidden">
                      <p className="text-sm text-gray-700 truncate">{user?.username}</p>
                      <p className="text-xs text-gray-400 truncate">{user?.role === "supervisor" ? "监制" : "成员"}</p>
                    </div>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => navigate("/profile")}>
                  <UserCircle className="w-4 h-4 mr-2" />
                  个人设置
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className="w-4 h-4 mr-2" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Top bar - Desktop */}
          <header className="hidden md:flex h-14 bg-white border-b border-gray-200 items-center px-4 gap-4 shrink-0">
            <div className="flex-1 min-w-0" />

            <Button
              variant="outline"
              className="w-64 justify-start text-gray-400 text-sm h-8 px-3"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="w-4 h-4 mr-2" />
              搜索项目、任务...
              <kbd className="ml-auto text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-400">
                ⌘K
              </kbd>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8 px-3">
                  <Plus className="w-4 h-4 mr-1" />
                  新建
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate("/projects/new")}>
                  <FolderKanban className="w-4 h-4 mr-2" />
                  新建项目
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/templates")}>
                  <Layers className="w-4 h-4 mr-2" />
                  从模板创建
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 relative"
                  onClick={() => navigate("/notifications")}
                >
                  <Bell className="w-5 h-5 text-gray-500" />
                  {unreadCount > 0 && (
                    <>
                      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary-500 rounded-full flex items-center justify-center">
                        <span className="text-[10px] text-white font-medium">{unreadCount}</span>
                      </span>
                      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary-500 rounded-full animate-pulse-ring opacity-50" />
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>通知</TooltipContent>
            </Tooltip>
          </header>

          {/* Mobile Top Bar */}
          <header className="md:hidden h-12 bg-white border-b border-gray-200 flex items-center px-3 gap-2 shrink-0">
            <Link to="/dashboard" className="flex items-center gap-2 mr-auto">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={branding.appName}
                  className="w-7 h-7 rounded-lg object-cover shrink-0"
                />
              ) : (
                <div className="w-7 h-7 rounded-lg bg-primary-500 flex items-center justify-center shrink-0">
                  <span className="text-white font-bold text-xs">{branding.appName.charAt(0)}</span>
                </div>
              )}
              <span className="font-semibold text-gray-800 text-sm">{branding.appName}</span>
            </Link>

            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 relative" onClick={() => navigate("/notifications")}>
              <Bell className="w-5 h-5 text-gray-500" />
              {unreadCount > 0 && (
                <span className="absolute -top-0 -right-0 w-3.5 h-3.5 bg-primary-500 rounded-full flex items-center justify-center">
                  <span className="text-[8px] text-white font-medium">{unreadCount}</span>
                </span>
              )}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Avatar className="w-7 h-7">
                    <AvatarFallback className="bg-primary-100 text-primary-700 text-xs">
                      {user?.username?.charAt(0).toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => navigate("/profile")}>
                  <UserCircle className="w-4 h-4 mr-2" />个人设置
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className="w-4 h-4 mr-2" />退出
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 pb-20 md:pb-6">
            {children}
          </main>
        </div>

        {/* Mobile Bottom Tab Bar */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-200 flex items-center justify-around z-40 px-2 safe-area-pb">
          {mainNavItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg transition-colors min-w-[48px]",
                isActive(item.path)
                  ? "text-primary-600"
                  : "text-gray-400"
              )}
            >
              <span className="relative">
                {item.icon}
                {item.path === "/notifications" && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 bg-primary-500 rounded-full flex items-center justify-center">
                    <span className="text-[7px] text-white font-bold">{unreadCount}</span>
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-auto flex flex-col items-center gap-0.5 py-1 px-2 text-gray-400 min-w-[48px]"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] font-medium">更多</span>
          </Button>
        </nav>

        {/* Mobile "More" Menu Overlay */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50" onClick={() => setMobileMenuOpen(false)}>
            <div className="absolute inset-0 bg-black/20" />
            <div className="absolute bottom-20 right-4 w-48 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden py-1">
              {filteredNavItems.filter(i => !mainNavItems.find(m => m.path === i.path)).map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 text-sm",
                    isActive(item.path)
                      ? "text-primary-700 bg-primary-50 font-medium"
                      : "text-gray-600"
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Search Modal */}
        {searchOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4" onClick={() => setSearchOpen(false)}>
            <div className="absolute inset-0 bg-black/30" />
            <div
              className="relative w-full max-w-xl bg-white rounded-xl shadow-xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                <Search className="w-5 h-5 text-gray-400" />
                <Input
                  autoFocus
                  placeholder="搜索项目、任务、文件..."
                  className="border-0 shadow-none focus-visible:ring-0 text-base"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <kbd className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-400 hidden sm:inline">ESC</kbd>
              </div>
              <div className="py-2">
                {searchQuery ? (
                  <div className="px-4 py-8 text-center text-gray-400">
                    搜索功能需要后端支持，当前为演示模式
                  </div>
                ) : (
                  <div className="px-4 py-6 text-center text-sm text-gray-400">
                    输入关键词开始搜索项目、任务和文件
                  </div>
                )}
              </div>
              <div className="hidden sm:flex items-center gap-4 px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
                <span className="flex items-center gap-1"><kbd className="bg-white px-1.5 py-0.5 rounded border">↑↓</kbd>导航</span>
                <span className="flex items-center gap-1"><kbd className="bg-white px-1.5 py-0.5 rounded border">Enter</kbd>选择</span>
                <span className="flex items-center gap-1"><kbd className="bg-white px-1.5 py-0.5 rounded border">ESC</kbd>关闭</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
