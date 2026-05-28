import { create } from 'zustand';
import type { Notification, NotificationPreference } from '@/types';

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  preferences: NotificationPreference;

  setNotifications: (notifications: Notification[]) => void;
  addNotification: (notification: Notification) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  deleteNotification: (id: string) => void;
  setPreferences: (prefs: Partial<NotificationPreference>) => void;
}

const defaultPreferences: NotificationPreference = {
  inSite: true,
  email: true,
  qq: false,
  escalationEnabled: true,
  escalationInterval: 2,
  subscribedTypes: ['task', 'review', 'file', 'mention'],
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  preferences: defaultPreferences,

  setNotifications: (notifications) =>
    set({
      notifications,
      unreadCount: notifications.filter((n) => !n.isRead).length,
    }),

  addNotification: (notification) =>
    set((state) => ({
      notifications: [notification, ...state.notifications],
      unreadCount: state.unreadCount + (notification.isRead ? 0 : 1),
    })),

  markAsRead: (id) => {
    const notifications = get().notifications.map((n) =>
      n.id === id ? { ...n, isRead: true } : n
    );
    set({
      notifications,
      unreadCount: notifications.filter((n) => !n.isRead).length,
    });
  },

  markAllAsRead: () => {
    const notifications = get().notifications.map((n) => ({ ...n, isRead: true }));
    set({ notifications, unreadCount: 0 });
  },

  deleteNotification: (id) => {
    const notifications = get().notifications.filter((n) => n.id !== id);
    set({
      notifications,
      unreadCount: notifications.filter((n) => !n.isRead).length,
    });
  },

  setPreferences: (prefs) =>
    set((state) => ({
      preferences: { ...state.preferences, ...prefs },
    })),
}));
