import { Routes, Route, Navigate, Outlet } from "react-router";
import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useBrandingStore } from "@/stores/brandingStore";
import { AppShell } from "@/components/AppShell";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProjectListPage } from "@/pages/ProjectListPage";
import { ProjectCreatePage } from "@/pages/ProjectCreatePage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { DedupPage } from "@/pages/DedupPage";
import { FileListPage } from "@/pages/FileListPage";
import { NotificationPage } from "@/pages/NotificationPage";
import { AnnouncementPage } from "@/pages/AnnouncementPage";
import { MemberPage } from "@/pages/MemberPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { SkillProfilePage } from "@/pages/SkillProfilePage";
import { ArchivePage } from "@/pages/ArchivePage";
import { WorkloadPage } from "@/pages/WorkloadPage";
import { WikiPage } from "@/pages/WikiPage";
import { SystemSettingsPage } from "@/pages/SystemSettingsPage";

// Protected route wrapper
function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <AppShell><Outlet /></AppShell> : <Navigate to="/login" replace />;
}

// Admin route wrapper
function AdminRoute() {
  const { isAdmin } = useAuthStore();
  return isAdmin() ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

function SupervisorRoute() {
  const { isSupervisor } = useAuthStore();
  return isSupervisor() ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

export default function App() {
  const loadBranding = useBrandingStore((state) => state.loadBranding);

  useEffect(() => {
    void loadBranding();
  }, [loadBranding]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/projects" element={<ProjectListPage />} />
        <Route path="/projects/new" element={<ProjectCreatePage />} />
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="/projects/:projectId/dedup" element={<DedupPage />} />
        <Route path="/projects/:projectId/wiki" element={<WikiPage />} />
        <Route path="/files" element={<FileListPage />} />
        <Route path="/notifications" element={<NotificationPage />} />
        <Route path="/announcements" element={<AnnouncementPage />} />
        <Route path="/notifications/settings" element={<Navigate to="/admin/settings?section=notifications" replace />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/skill-profile" element={<SkillProfilePage />} />
        <Route path="/archive" element={<ArchivePage />} />
        <Route path="/workload" element={<WorkloadPage />} />
        <Route path="/admin/settings" element={<SystemSettingsPage />} />

        <Route element={<SupervisorRoute />}>
          <Route path="/templates" element={<Navigate to="/admin/settings?section=templates" replace />} />
        </Route>

        {/* Admin routes */}
        <Route element={<AdminRoute />}>
          <Route path="/members" element={<MemberPage />} />
          <Route path="/admin/retention" element={<Navigate to="/admin/settings?section=retention" replace />} />
          <Route path="/admin/storage" element={<Navigate to="/admin/settings?section=storage" replace />} />
          <Route path="/admin/announcements" element={<Navigate to="/admin/settings?section=announcements" replace />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
