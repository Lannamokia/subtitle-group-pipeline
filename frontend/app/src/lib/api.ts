import axios, { AxiosError, type AxiosInstance } from 'axios';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import type {
  User,
  LoginCredentials,
  RegisterData,
  LoginResponse,
  RegisterResponse,
  RegistrationSettings,
  RoleTagDefinition,
  RoleTagApplication,
  UserRoleTagStatus,
  StorageBackend,
  StorageBackendInput,
  Project,
  Task,
  FileEntity,
  Notification,
  ProjectTemplate,
  TimelineEvent,
  ApiResponse,
  PaginatedResponse,
} from '@/types';

// Create axios instance
export const api: AxiosInstance = axios.create({
  baseURL: 'http://localhost:3000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor: add JWT token
api.interceptors.request.use(
  (config) => {
    try {
      const storage = localStorage.getItem('auth-storage');
      if (storage) {
        const parsed = JSON.parse(storage);
        const token = parsed.state?.user?.token;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch {
      // ignore parse error
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle 401 and errors
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      toast.error('登录已过期，请重新登录');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Helper to extract data from response
function extractData<T>(response: { data: ApiResponse<T> }): T {
  return response.data.data;
}

// Helper for error messages
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || error.message || '请求失败';
  }
  return '未知错误';
}

// ========== Auth API ==========

export const authApi = {
  login: (credentials: LoginCredentials) =>
    api.post<ApiResponse<LoginResponse>>('/auth/login', credentials).then(extractData),

  register: (data: RegisterData) =>
    api.post<ApiResponse<RegisterResponse>>('/auth/register', data).then(extractData),

  logout: () =>
    api.post<ApiResponse<void>>('/auth/logout').then(extractData),

  me: () =>
    api.get<ApiResponse<User>>('/auth/me').then(extractData),

  updateProfile: (data: { username?: string; nickname?: string; avatar?: string }) =>
    api.put<ApiResponse<User>>('/auth/profile', data).then(extractData),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post<ApiResponse<void>>('/auth/change-password', data).then(extractData),

  getRegistrationPolicy: () =>
    api.get<ApiResponse<RegistrationSettings>>('/auth/registration-policy').then(extractData),

  updateRegistrationPolicy: (data: RegistrationSettings) =>
    api.put<ApiResponse<RegistrationSettings>>('/auth/registration-policy', data).then(extractData),

  refreshToken: () =>
    api.post<ApiResponse<{ token: string }>>('/auth/refresh').then(extractData),
};

// ========== Role Tag API ==========

export const roleTagApi = {
  getAllTags: () =>
    api.get<ApiResponse<RoleTagDefinition[]>>('/auth/role-tags').then(extractData),

  createTag: (data: { name: string; roleType: string; description?: string }) =>
    api.post<ApiResponse<RoleTagDefinition>>('/auth/role-tags', data).then(extractData),

  updateTag: (id: string, data: { name?: string; roleType?: string; description?: string }) =>
    api.put<ApiResponse<RoleTagDefinition>>(`/auth/role-tags/${id}`, data).then(extractData),

  deleteTag: (id: string) =>
    api.delete<ApiResponse<void>>(`/auth/role-tags/${id}`).then(extractData),

  getMyTagStatuses: () =>
    api.get<ApiResponse<UserRoleTagStatus[]>>('/auth/role-tags/my-status').then(extractData),

  applyForTag: (tagId: string, reason: string) =>
    api.post<ApiResponse<RoleTagApplication>>('/auth/tag-applications', { tag_id: tagId, reason }).then(extractData),

  getApplications: (params?: { status?: string; page?: number; pageSize?: number }) => {
    const url = params?.status === 'pending' ? '/auth/tag-applications/pending' : '/auth/tag-applications/my';
    return api.get<ApiResponse<RoleTagApplication[]>>(url, { params }).then(extractData);
  },

  reviewApplication: (id: string, data: { status: 'approved' | 'rejected'; comment?: string }) =>
    api.post<ApiResponse<RoleTagApplication>>('/auth/tag-applications/review', {
      application_id: id,
      approved: data.status === 'approved',
      rejection_reason: data.status === 'rejected' ? data.comment : undefined,
    }).then(extractData),
};

// ========== Storage API ==========

export const storageApi = {
  getBackends: () =>
    api.get<ApiResponse<StorageBackend[]>>('/storage/backends').then(extractData),

  getBackend: (id: string) =>
    api.get<ApiResponse<StorageBackend>>(`/storage/backends/${id}`).then(extractData),

  createBackend: (data: StorageBackendInput) =>
    api.post<ApiResponse<StorageBackend>>('/storage/backends', data).then(extractData),

  updateBackend: (id: string, data: Partial<StorageBackendInput>) =>
    api.put<ApiResponse<StorageBackend>>(`/storage/backends/${id}`, data).then(extractData),

  deleteBackend: (id: string) =>
    api.delete<ApiResponse<void>>(`/storage/backends/${id}`).then(extractData),

  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<ApiResponse<{ url: string }>>('/storage/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(extractData);
  },

  getStats: () =>
    api.get<ApiResponse<{ totalQuota: number; totalUsed: number; backendCount: number }>>('/storage/stats').then(extractData),
};

// ========== Project API ==========

export const projectApi = {
  getProjects: (params?: { status?: string; page?: number; pageSize?: number }) =>
    api.get<ApiResponse<PaginatedResponse<Project>>>('/projects', { params }).then(extractData),

  getProject: (id: string) =>
    api.get<ApiResponse<Project>>(`/projects/${id}`).then(extractData),

  createProject: (data: Partial<Project>) =>
    api.post<ApiResponse<Project>>('/projects', data).then(extractData),

  updateProject: (id: string, data: Partial<Project>) =>
    api.put<ApiResponse<Project>>(`/projects/${id}`, data).then(extractData),

  deleteProject: (id: string) =>
    api.delete<ApiResponse<void>>(`/projects/${id}`).then(extractData),
};

// ========== Task API ==========

export const taskApi = {
  getTasks: (params?: { projectId?: string; status?: string; assigneeId?: string }) =>
    api.get<ApiResponse<Task[]>>('/tasks', { params }).then(extractData),

  getTask: (id: string) =>
    api.get<ApiResponse<Task>>(`/tasks/${id}`).then(extractData),

  createTask: (data: Partial<Task>) =>
    api.post<ApiResponse<Task>>('/tasks', data).then(extractData),

  updateTask: (id: string, data: Partial<Task>) =>
    api.put<ApiResponse<Task>>(`/tasks/${id}`, data).then(extractData),

  claimTask: (id: string) =>
    api.post<ApiResponse<Task>>(`/tasks/${id}/claim`).then(extractData),

  submitTask: (id: string) =>
    api.post<ApiResponse<Task>>(`/tasks/${id}/submit`).then(extractData),
};

// ========== File API ==========

export const fileApi = {
  getFiles: (params?: { projectId?: string; taskId?: string; type?: string }) =>
    api.get<ApiResponse<PaginatedResponse<FileEntity>>>('/files', { params }).then(extractData),

  getFile: (id: string) =>
    api.get<ApiResponse<FileEntity>>(`/files/${id}`).then(extractData),

  uploadFile: (file: File, data: { projectId: string; taskId?: string; type?: string }) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('projectId', data.projectId);
    if (data.taskId) formData.append('taskId', data.taskId);
    if (data.type) formData.append('type', data.type);
    return api.post<ApiResponse<FileEntity>>('/files', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(extractData);
  },

  deleteFile: (id: string) =>
    api.delete<ApiResponse<void>>(`/files/${id}`).then(extractData),
};

// ========== Notification API ==========

export const notificationApi = {
  getNotifications: (params?: { isRead?: boolean; page?: number; pageSize?: number }) =>
    api.get<ApiResponse<PaginatedResponse<Notification>>>('/notifications', { params }).then(extractData),

  markAsRead: (id: string) =>
    api.post<ApiResponse<void>>(`/notifications/${id}/read`).then(extractData),

  markAllAsRead: () =>
    api.post<ApiResponse<void>>('/notifications/read-all').then(extractData),

  getUnreadCount: () =>
    api.get<ApiResponse<{ count: number }>>('/notifications/unread-count').then(extractData),
};

// ========== Template API ==========

export const templateApi = {
  getTemplates: () =>
    api.get<ApiResponse<ProjectTemplate[]>>('/templates').then(extractData),

  getTemplate: (id: string) =>
    api.get<ApiResponse<ProjectTemplate>>(`/templates/${id}`).then(extractData),

  createTemplate: (data: Partial<ProjectTemplate>) =>
    api.post<ApiResponse<ProjectTemplate>>('/templates', data).then(extractData),

  updateTemplate: (id: string, data: Partial<ProjectTemplate>) =>
    api.put<ApiResponse<ProjectTemplate>>(`/templates/${id}`, data).then(extractData),

  deleteTemplate: (id: string) =>
    api.delete<ApiResponse<void>>(`/templates/${id}`).then(extractData),
};

// ========== Timeline API ==========

export const timelineApi = {
  getEvents: (params?: { projectId?: string; limit?: number }) =>
    api.get<ApiResponse<TimelineEvent[]>>('/timeline', { params }).then(extractData),

  getGlobalEvents: () =>
    api.get<ApiResponse<TimelineEvent[]>>('/timeline/global').then(extractData),
};

// ========== Wiki API ==========

export const wikiApi = {
  getWiki: (projectId: string) =>
    api.get<ApiResponse<WikiDocument>>(`/wiki/${projectId}`).then(extractData),
};

// ========== Announcement API ==========

export const announcementApi = {
  getAnnouncements: (params?: { type?: string }) =>
    api.get<ApiResponse<Announcement[]>>(`/announcements`, { params }).then(extractData),

  createAnnouncement: (data: Partial<Announcement>) =>
    api.post<ApiResponse<Announcement>>(`/announcements`, data).then(extractData),

  updateAnnouncement: (id: string, data: Partial<Announcement>) =>
    api.put<ApiResponse<Announcement>>(`/announcements/${id}`, data).then(extractData),

  deleteAnnouncement: (id: string) =>
    api.delete<ApiResponse<void>>(`/announcements/${id}`).then(extractData),
};

// ========== Member API ==========

export const memberApi = {
  getMembers: (params?: { status?: string; role?: string; page?: number; pageSize?: number }) =>
    api.get<ApiResponse<PaginatedResponse<User>>>('/members', { params }).then(extractData),

  updateMemberRole: (id: string, role: string) =>
    api.put<ApiResponse<User>>(`/members/${id}/role`, { role }).then(extractData),

  updateMemberStatus: (id: string, status: string) =>
    api.put<ApiResponse<User>>(`/members/${id}/status`, { status }).then(extractData),
};
