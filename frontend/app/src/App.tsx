import { Routes, Route, Navigate, Outlet } from "react-router";
import { useAuthStore } from "@/stores/authStore";
import { AppShell } from "@/components/AppShell";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProjectListPage } from "@/pages/ProjectListPage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { TemplatePage } from "@/pages/TemplatePage";
import { FileListPage } from "@/pages/FileListPage";
import { NotificationPage } from "@/pages/NotificationPage";
import { MemberPage } from "@/pages/MemberPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { RegistrationSettingsPage } from "@/pages/admin/RegistrationSettingsPage";
import { DataRetentionPage } from "@/pages/admin/DataRetentionPage";

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
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="/files" element={<FileListPage />} />
        <Route path="/notifications" element={<NotificationPage />} />
        <Route path="/templates" element={<TemplatePage />} />
        <Route path="/profile" element={<ProfilePage />} />

        {/* Admin routes */}
        <Route element={<AdminRoute />}>
          <Route path="/members" element={<MemberPage />} />
          <Route path="/admin/settings" element={<RegistrationSettingsPage />} />
          <Route path="/admin/retention" element={<DataRetentionPage />} />
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
