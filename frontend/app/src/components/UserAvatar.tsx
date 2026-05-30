import { cn } from "@/lib/utils";
import { normalizeAvatarUrl } from "@/lib/api";
import type { User } from "@/types";

interface UserAvatarProps {
  user?: User | null;
  size?: "xs" | "sm" | "md" | "lg";
  showName?: boolean;
  className?: string;
}

const sizeMap = {
  xs: "w-5 h-5 text-[10px]",
  sm: "w-7 h-7 text-xs",
  md: "w-9 h-9 text-sm",
  lg: "w-12 h-12 text-base",
};

export function UserAvatar({ user, size = "md", showName = false, className }: UserAvatarProps) {
  const initials = user?.username?.charAt(0).toUpperCase() || "?";
  const rawAvatar =
    user?.avatar ??
    (user as (User & { avatarUrl?: string; avatar_url?: string }) | null | undefined)?.avatarUrl ??
    (user as (User & { avatarUrl?: string; avatar_url?: string }) | null | undefined)?.avatar_url;
  const avatarUrl = normalizeAvatarUrl(rawAvatar, user?.id);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "rounded-full flex items-center justify-center bg-primary-100 text-primary-700 font-medium shrink-0",
          sizeMap[size]
        )}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={user?.username || "用户头像"}
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <span>{initials}</span>
        )}
      </div>
      {showName && user && (
        <span className="text-sm text-gray-700 truncate">{user.username}</span>
      )}
    </div>
  );
}

export function AvatarGroup({ users, max = 5, size = "sm" }: { users: User[]; max?: number; size?: "xs" | "sm" | "md" | "lg" }) {
  const displayUsers = users.slice(0, max);
  const remaining = users.length - max;

  return (
    <div className="flex items-center -space-x-2">
      {displayUsers.map((user) => (
        <div key={user.id} className="ring-2 ring-white rounded-full">
          <UserAvatar user={user} size={size} />
        </div>
      ))}
      {remaining > 0 && (
        <div
          className={cn(
            "rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-xs font-medium ring-2 ring-white",
            size === "xs" ? "w-5 h-5" : size === "sm" ? "w-7 h-7" : size === "md" ? "w-9 h-9" : "w-12 h-12"
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}
