import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, UserRole, VerificationStatus } from '@/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  verificationStatus: VerificationStatus | null;
  login: (user: User) => void;
  updateUser: (user: Partial<User>) => void;
  logout: () => void;
  setVerificationStatus: (status: VerificationStatus | null) => void;
  hasRole: (roles: UserRole[]) => boolean;
  isAdmin: () => boolean;
  isSupervisor: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      verificationStatus: null,

      login: (user) =>
        set({
          user,
          isAuthenticated: true,
          verificationStatus: null,
        }),

      updateUser: (user) =>
        set((state) => {
          if (!state.user) {
            const nextUser = user as User;
            return {
              user: nextUser,
              isAuthenticated: Boolean(nextUser.token),
              verificationStatus: state.verificationStatus,
            };
          }

          const nextUser: User = {
            ...state.user,
            ...user,
            token: user.token ?? state.user.token,
            refreshToken: user.refreshToken ?? state.user.refreshToken,
            role: user.role ?? state.user.role,
            status: user.status ?? state.user.status,
            createdAt: user.createdAt ?? state.user.createdAt,
          };

          return {
            user: nextUser,
            isAuthenticated: state.isAuthenticated,
            verificationStatus: state.verificationStatus,
          };
        }),

      logout: () =>
        set({
          user: null,
          isAuthenticated: false,
          verificationStatus: null,
        }),

      setVerificationStatus: (status) =>
        set({ verificationStatus: status }),

      hasRole: (roles) => {
        const user = get().user;
        return user ? roles.includes(user.role) : false;
      },

      isAdmin: () => {
        const user = get().user;
        return user ? ['super_admin', 'group_admin'].includes(user.role) : false;
      },

      isSupervisor: () => {
        const user = get().user;
        return user
          ? ['super_admin', 'group_admin', 'supervisor'].includes(user.role)
          : false;
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
