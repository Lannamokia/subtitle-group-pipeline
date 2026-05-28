import { Routes, Route, Navigate, Outlet } from "react-router";
import { useAuthStore } from "@/stores/authStore";
import { AppShell } from "@/components/AppShell";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProjectListPage } from "@/pages/ProjectListPage";
import { ProjectCreatePage } from "@/pages/ProjectCreatePage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { DedupPage } from "@/pages/DedupPage";
import { TemplatePage } from "@/pages/TemplatePage";
import { FileListPage } from "@/pages/FileListPage";
import { NotificationPage } from "@/pages/NotificationPage";
import { NotificationSettingsPage } from "@/pages/NotificationSettingsPage";
import { MemberPage } from "@/pages/MemberPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { SkillProfilePage } from "@/pages/SkillProfilePage";
import { ArchivePage } from "@/pages/ArchivePage";
import { WorkloadPage } from "@/pages/WorkloadPage";
import { WikiPage } from "@/pages/WikiPage";
import { RegistrationSettingsPage } from "@/pages/admin/RegistrationSettingsPage";
import { DataRetentionPage } from "@/pages/admin/DataRetentionPage";
import { StorageBackendPage } from "@/pages/admin/StorageBackendPage";
import { AnnouncementAdminPage } from "@/pages/admin/AnnouncementAdminPage";

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

export default function App() {
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
        <Route path="/notifications/settings" element={<NotificationSettingsPage />} />
        <Route path="/templates" element={<TemplatePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/skill-profile" element={<SkillProfilePage />} />
        <Route path="/archive" element={<ArchivePage />} />
        <Route path="/workload" element={<WorkloadPage />} />

        {/* Admin routes */}
        <Route element={<AdminRoute />}>
          <Route path="/members" element={<MemberPage />} />
          <Route path="/admin/settings" element={<RegistrationSettingsPage />} />
          <Route path="/admin/retention" element={<DataRetentionPage />} />
          <Route path="/admin/storage" element={<StorageBackendPage />} />
          <Route path="/admin/announcements" element={<AnnouncementAdminPage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
