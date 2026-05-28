import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  sidebarCollapsed: boolean;
  sidebarOpen: boolean;
  searchOpen: boolean;
  activeProjectId: string | null;
  breadcrumbs: { label: string; path?: string }[];

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setActiveProjectId: (id: string | null) => void;
  setBreadcrumbs: (crumbs: { label: string; path?: string }[]) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      sidebarOpen: true,
      searchOpen: false,
      activeProjectId: null,
      breadcrumbs: [],

      toggleSidebar: () =>
        set((state) => ({
          sidebarCollapsed: !state.sidebarCollapsed,
        })),

      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      setSearchOpen: (open) => set({ searchOpen: open }),

      setActiveProjectId: (id) => set({ activeProjectId: id }),

      setBreadcrumbs: (crumbs) => set({ breadcrumbs: crumbs }),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);
