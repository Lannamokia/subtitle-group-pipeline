import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PasswordRuleHint } from "@/components/PasswordRuleHint";
import { UserAvatar } from "@/components/UserAvatar";
import { AvatarCropDialog } from "@/components/AvatarCropDialog";
import { getErrorMessage, memberApi, roleTagApi, storageApi } from "@/lib/api";
import { PASSWORD_RULE_MESSAGE, validatePassword } from "@/lib/passwordPolicy";
import { useAuthStore } from "@/stores/authStore";
import type { RoleTagDefinition, User, UserRole, UserRoleTagStatus, UserStatus } from "@/types";
import { Camera, KeyRound, Loader2, Pencil, Search, ShieldCheck, Tags, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

const roleLabels: Record<UserRole, string> = {
  super_admin: "超级管理员",
  group_admin: "组管理员",
  supervisor: "监制",
  member: "成员",
};

const statusLabels: Record<UserStatus, string> = {
  active: "正常",
  pending_verification: "待验证",
  disabled: "已禁用",
};

const tagStatusLabels: Record<UserRoleTagStatus["status"], string> = {
  not_applied: "未申请",
  pending: "待审核",
  granted: "已授予",
  rejected: "已拒绝",
};

interface MemberFormState {
  username: string;
  password: string;
  nickname: string;
  qq: string;
  role: UserRole;
  status: "active" | "disabled";
  tagIds: string[];
}

interface EditMemberFormState {
  username: string;
  nickname: string;
  qq: string;
}

const initialMemberForm: MemberFormState = {
  username: "",
  password: "",
  nickname: "",
  qq: "",
  role: "member",
  status: "active",
  tagIds: [],
};

export function MemberPage() {
  const currentUser = useAuthStore((state) => state.user);
  const updateCurrentUser = useAuthStore((state) => state.updateUser);
  const [users, setUsers] = useState<User[]>([]);
  const [tags, setTags] = useState<RoleTagDefinition[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [memberForm, setMemberForm] = useState<MemberFormState>(initialMemberForm);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [profileTarget, setProfileTarget] = useState<User | null>(null);
  const [profileForm, setProfileForm] = useState<EditMemberFormState>({
    username: "",
    nickname: "",
    qq: "",
  });
  const [profileAvatarPreview, setProfileAvatarPreview] = useState("");
  const [profileAvatarFile, setProfileAvatarFile] = useState<File | null>(null);
  const [profileCropImageUrl, setProfileCropImageUrl] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [tagResetTarget, setTagResetTarget] = useState<User | null>(null);
  const [tagResetStatuses, setTagResetStatuses] = useState<UserRoleTagStatus[]>([]);
  const [isLoadingTagStatuses, setIsLoadingTagStatuses] = useState(false);
  const [selectedTagResetIds, setSelectedTagResetIds] = useState<string[]>([]);
  const [selectedTagGrantIds, setSelectedTagGrantIds] = useState<string[]>([]);
  const [isResettingTags, setIsResettingTags] = useState(false);
  const [isGrantingTags, setIsGrantingTags] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const profileAvatarInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [membersData, tagsData] = await Promise.all([
        memberApi.getMembers(),
        roleTagApi.getAllTags(),
      ]);
      setUsers(membersData.items || []);
      setTags(tagsData);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return users;
    return users.filter((user) =>
      [user.username, user.nickname, user.qq]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    );
  }, [query, users]);

  const isProtectedOwnSuperAdmin = (user: User) =>
    currentUser?.id === user.id && currentUser.role === "super_admin";

  const openCreateDialog = () => {
    setMemberForm(initialMemberForm);
    setIsCreateOpen(true);
  };

  const toggleTag = (tagId: string, checked: boolean) => {
    setMemberForm((prev) => ({
      ...prev,
      tagIds: checked
        ? [...prev.tagIds, tagId]
        : prev.tagIds.filter((id) => id !== tagId),
    }));
  };

  const handleCreateMember = async () => {
    const passwordCheck = validatePassword(memberForm.password);
    if (!passwordCheck.valid) {
      toast.error(PASSWORD_RULE_MESSAGE);
      return;
    }

    setIsCreating(true);
    try {
      const created = await memberApi.createMember(memberForm);
      setUsers((prev) => [created, ...prev]);
      setIsCreateOpen(false);
      toast.success("成员账号已创建");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  };

  const updateUserInList = (updated: User) => {
    setUsers((prev) => prev.map((user) => (user.id === updated.id ? { ...user, ...updated } : user)));
  };

  const closeProfileCropDialog = () => {
    setProfileCropImageUrl((current) => {
      if (current?.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
  };

  const closeProfileDialog = () => {
    setProfileAvatarPreview((current) => {
      if (current.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }
      return "";
    });
    setProfileAvatarFile(null);
    closeProfileCropDialog();
    setProfileTarget(null);
  };

  const openProfileDialog = (user: User) => {
    setProfileTarget(user);
    setProfileForm({
      username: user.username || "",
      nickname: user.nickname || "",
      qq: user.qq || "",
    });
    setProfileAvatarPreview(user.avatar || "");
    setProfileAvatarFile(null);
  };

  const handleProfileAvatarFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("请上传图片文件");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("图片大小不能超过5MB");
      return;
    }

    closeProfileCropDialog();
    setProfileCropImageUrl(URL.createObjectURL(file));
    event.currentTarget.value = "";
  };

  const handleProfileAvatarCropped = async (file: File) => {
    setProfileAvatarPreview((current) => {
      if (current.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }
      return URL.createObjectURL(file);
    });
    setProfileAvatarFile(file);
    closeProfileCropDialog();
  };

  const handleUpdateMemberProfile = async () => {
    if (!profileTarget) return;
    const username = profileForm.username.trim();
    if (username.length < 3) {
      toast.error("用户名至少需要 3 个字符");
      return;
    }

    setIsSavingProfile(true);
    try {
      const uploadedAvatar = profileAvatarFile
        ? await storageApi.uploadAvatar(profileAvatarFile, profileTarget.id)
        : null;
      const updated = await memberApi.updateMemberProfile(profileTarget.id, {
        username,
        nickname: profileForm.nickname.trim() || null,
        qq: profileForm.qq.trim() || null,
        avatarUrl: uploadedAvatar?.storageUrl,
      });
      updateUserInList(updated);
      if (currentUser?.id === updated.id) {
        updateCurrentUser(updated);
      }
      closeProfileDialog();
      toast.success("成员资料已更新");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleRoleChange = async (user: User, role: UserRole) => {
    setBusyUserId(user.id);
    try {
      updateUserInList(await memberApi.updateMemberRole(user.id, role));
      toast.success("成员角色已更新");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleStatusToggle = async (user: User) => {
    const nextStatus: UserStatus = user.status === "disabled" ? "active" : "disabled";
    setBusyUserId(user.id);
    try {
      updateUserInList(await memberApi.updateMemberStatus(user.id, nextStatus));
      toast.success(nextStatus === "active" ? "账号已启用" : "账号已禁用");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleApproveVerification = async (user: User) => {
    setBusyUserId(user.id);
    try {
      updateUserInList(await memberApi.approveVerification(user.id));
      toast.success("账号已通过验证");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleResetPassword = async () => {
    if (!passwordTarget) return;
    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.valid) {
      toast.error(PASSWORD_RULE_MESSAGE);
      return;
    }

    setIsResettingPassword(true);
    try {
      await memberApi.resetPassword(passwordTarget.id, newPassword);
      setPasswordTarget(null);
      setNewPassword("");
      toast.success("密码已重置");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleDeleteMember = async (user: User) => {
    setBusyUserId(user.id);
    try {
      await memberApi.deleteMember(user.id);
      setUsers((prev) => prev.filter((item) => item.id !== user.id));
      toast.success("账号已删除");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  };

  const openTagResetDialog = async (user: User) => {
    setTagResetTarget(user);
    setTagResetStatuses([]);
    setSelectedTagResetIds([]);
    setSelectedTagGrantIds([]);
    setIsLoadingTagStatuses(true);
    try {
      const statuses = await memberApi.getMemberTagStatuses(user.id);
      setTagResetStatuses(statuses);
    } catch (error) {
      toast.error(getErrorMessage(error));
      setTagResetTarget(null);
    } finally {
      setIsLoadingTagStatuses(false);
    }
  };

  const toggleTagReset = (tagId: string, checked: boolean) => {
    setSelectedTagResetIds((prev) =>
      checked ? [...prev, tagId] : prev.filter((id) => id !== tagId)
    );
  };

  const toggleTagGrant = (tagId: string, checked: boolean) => {
    setSelectedTagGrantIds((prev) =>
      checked ? [...prev, tagId] : prev.filter((id) => id !== tagId)
    );
  };

  const handleGrantMemberTags = async () => {
    if (!tagResetTarget || selectedTagGrantIds.length === 0) {
      toast.error("请先选择要授予的标签");
      return;
    }

    setIsGrantingTags(true);
    try {
      const updated = await memberApi.grantMemberTags(tagResetTarget.id, selectedTagGrantIds);
      updateUserInList(updated);
      setTagResetTarget(null);
      setTagResetStatuses([]);
      setSelectedTagGrantIds([]);
      setSelectedTagResetIds([]);
      toast.success("成员标签已授予");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsGrantingTags(false);
    }
  };

  const handleResetMemberTags = async () => {
    if (!tagResetTarget || selectedTagResetIds.length === 0) {
      toast.error("请先选择要重置的标签");
      return;
    }
    setIsResettingTags(true);
    try {
      const updatedUsers = await memberApi.resetMemberTagStatuses(tagResetTarget.id, selectedTagResetIds);
      setUsers(updatedUsers);
      setTagResetTarget(null);
      setTagResetStatuses([]);
      setSelectedTagResetIds([]);
      setSelectedTagGrantIds([]);
      toast.success("成员标签状态已重置");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsResettingTags(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display text-gray-800">成员管理</h1>
          <p className="text-sm text-gray-500 mt-1">共 {users.length} 名成员</p>
        </div>
        <Button onClick={openCreateDialog}>
          <UserPlus className="w-4 h-4 mr-1.5" />
          添加成员
        </Button>
      </div>

      <Card>
        <CardHeader className="py-4">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="搜索成员..."
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-gray-500">加载中...</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredUsers.map((user) => (
                <div key={user.id} className="px-4 py-4 hover:bg-gray-50 sm:px-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <UserAvatar user={user} size="md" />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{user.username}</p>
                      <p className="text-xs text-gray-400">QQ: {user.qq || "-"}</p>
                      {user.roleTags && user.roleTags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {user.roleTags.map((tag) => (
                            <Badge key={tag.id} variant="secondary" className="text-[10px]">
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Select
                      value={user.role}
                      onValueChange={(value) => handleRoleChange(user, value as UserRole)}
                      disabled={busyUserId === user.id || isProtectedOwnSuperAdmin(user)}
                    >
                      <SelectTrigger className="h-8 w-[132px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(roleLabels) as UserRole[]).map((role) => (
                          <SelectItem key={role} value={role}>
                            {roleLabels[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Badge
                      variant={user.status === "active" ? "default" : "outline"}
                      className="text-xs"
                    >
                      {statusLabels[user.status]}
                    </Badge>
                    {user.status === "pending_verification" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyUserId === user.id}
                        onClick={() => handleApproveVerification(user)}
                      >
                        通过验证
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyUserId === user.id}
                        onClick={() => handleStatusToggle(user)}
                      >
                        {user.status === "disabled" ? "启用" : "禁用"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => openProfileDialog(user)}
                      title="编辑资料"
                    >
                      <Pencil className="h-4 w-4 text-gray-500" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => openTagResetDialog(user)}
                      title="管理标签状态"
                    >
                      <Tags className="h-4 w-4 text-gray-500" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => {
                        setPasswordTarget(user);
                        setNewPassword("");
                      }}
                    >
                      <KeyRound className="h-4 w-4 text-gray-500" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          disabled={busyUserId === user.id || user.role === "super_admin"}
                          title={user.role === "super_admin" ? "超级管理员账号不能删除" : "删除账号"}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>删除账号</AlertDialogTitle>
                          <AlertDialogDescription>
                            确定要删除账号「{user.username}」吗？此操作会直接从数据库删除账号，历史项目记录会转交给当前管理员保留。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700"
                            onClick={() => handleDeleteMember(user)}
                          >
                            确认删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  {user.role === "super_admin" && (
                    <p className="text-xs text-gray-400 sm:text-right">受保护账号，不能删除</p>
                  )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>添加成员账号</DialogTitle>
            <DialogDescription>直接创建账号并授予标签，标签会立即生效。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  value={memberForm.username}
                  onChange={(event) => setMemberForm((prev) => ({ ...prev, username: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">初始密码</Label>
                <Input
                  id="password"
                  type="password"
                  value={memberForm.password}
                  onChange={(event) => setMemberForm((prev) => ({ ...prev, password: event.target.value }))}
                />
                <PasswordRuleHint password={memberForm.password} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nickname">昵称</Label>
                <Input
                  id="nickname"
                  value={memberForm.nickname}
                  onChange={(event) => setMemberForm((prev) => ({ ...prev, nickname: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qq">QQ</Label>
                <Input
                  id="qq"
                  value={memberForm.qq}
                  onChange={(event) => setMemberForm((prev) => ({ ...prev, qq: event.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>系统角色</Label>
                <Select
                  value={memberForm.role}
                  onValueChange={(value) => setMemberForm((prev) => ({ ...prev, role: value as UserRole }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(roleLabels) as UserRole[]).map((role) => (
                      <SelectItem key={role} value={role}>
                        {roleLabels[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>账号状态</Label>
                <Select
                  value={memberForm.status}
                  onValueChange={(value) =>
                    setMemberForm((prev) => ({ ...prev, status: value as "active" | "disabled" }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">正常启用</SelectItem>
                    <SelectItem value="disabled">先禁用</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>岗位标签</Label>
              <div className="grid max-h-40 grid-cols-1 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
                {tags.length === 0 ? (
                  <p className="text-sm text-gray-500">暂无可分配标签</p>
                ) : (
                  tags.map((tag) => (
                    <label key={tag.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={memberForm.tagIds.includes(tag.id)}
                        onCheckedChange={(checked) => toggleTag(tag.id, checked === true)}
                      />
                      <span>{tag.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateMember} disabled={isCreating}>
              {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              创建账号
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(profileTarget)}
        onOpenChange={(open) => {
          if (!open) closeProfileDialog();
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>编辑成员资料</DialogTitle>
            <DialogDescription>更新账号基础资料和绑定 QQ。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="flex items-center gap-4">
              {profileTarget && (
                <UserAvatar
                  user={{ ...profileTarget, avatar: profileAvatarPreview }}
                  size="lg"
                />
              )}
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => profileAvatarInputRef.current?.click()}
                  disabled={isSavingProfile}
                >
                  <Camera className="mr-1.5 h-4 w-4" />
                  更换头像
                </Button>
                <input
                  ref={profileAvatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleProfileAvatarFileChange}
                />
                <p className="text-xs text-gray-500">上传后会先裁剪为 1:1 方形头像。</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-username">用户名</Label>
                <Input
                  id="edit-username"
                  value={profileForm.username}
                  onChange={(event) =>
                    setProfileForm((prev) => ({ ...prev, username: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-nickname">昵称</Label>
                <Input
                  id="edit-nickname"
                  value={profileForm.nickname}
                  onChange={(event) =>
                    setProfileForm((prev) => ({ ...prev, nickname: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit-qq">绑定 QQ</Label>
                <Input
                  id="edit-qq"
                  value={profileForm.qq}
                  onChange={(event) =>
                    setProfileForm((prev) => ({ ...prev, qq: event.target.value }))
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeProfileDialog} disabled={isSavingProfile}>
              取消
            </Button>
            <Button onClick={handleUpdateMemberProfile} disabled={isSavingProfile}>
              {isSavingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存资料
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(passwordTarget)} onOpenChange={(open) => !open && setPasswordTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>更改密码</DialogTitle>
            <DialogDescription>为 {passwordTarget?.username} 设置新的登录密码。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-password">新密码</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <PasswordRuleHint password={newPassword} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPasswordTarget(null)}>
              取消
            </Button>
            <Button onClick={handleResetPassword} disabled={isResettingPassword}>
              {isResettingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存密码
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AvatarCropDialog
        open={Boolean(profileCropImageUrl)}
        imageUrl={profileCropImageUrl}
        uploading={isSavingProfile}
        onCancel={closeProfileCropDialog}
        onConfirm={handleProfileAvatarCropped}
      />

      <Dialog
        open={Boolean(tagResetTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setTagResetTarget(null);
            setTagResetStatuses([]);
            setSelectedTagResetIds([]);
            setSelectedTagGrantIds([]);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>管理标签状态</DialogTitle>
            <DialogDescription>
              为 {tagResetTarget?.username} 直接授予标签，或把已有状态重置为未申请。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-3">
              <Label>可直接授予标签</Label>
              <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
                {isLoadingTagStatuses ? (
                  <div className="col-span-full flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在加载标签状态...
                  </div>
                ) : tagResetStatuses.some((item) => item.status !== "granted") ? (
                  tagResetStatuses
                    .filter((item) => item.status !== "granted")
                    .map((item) => (
                      <label key={item.tag.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedTagGrantIds.includes(item.tag.id)}
                          onCheckedChange={(checked) => toggleTagGrant(item.tag.id, checked === true)}
                        />
                        <span>{item.tag.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {tagStatusLabels[item.status]}
                        </Badge>
                      </label>
                    ))
                ) : (
                  <p className="text-sm text-gray-500">该成员已经拥有所有标签。</p>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                onClick={handleGrantMemberTags}
                disabled={selectedTagGrantIds.length === 0 || isGrantingTags}
              >
                {isGrantingTags && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                授予所选标签
              </Button>
            </div>

            <div className="space-y-3">
              <Label>可重置标签</Label>
            <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
              {isLoadingTagStatuses ? (
                <div className="col-span-full flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载标签状态...
                </div>
              ) : tagResetStatuses.some((item) => item.status !== "not_applied") ? (
                tagResetStatuses
                  .filter((item) => item.status !== "not_applied")
                  .map((item) => (
                  <label key={item.tag.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedTagResetIds.includes(item.tag.id)}
                      onCheckedChange={(checked) => toggleTagReset(item.tag.id, checked === true)}
                    />
                    <span>{item.tag.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {tagStatusLabels[item.status]}
                    </Badge>
                  </label>
                  ))
              ) : (
                <p className="text-sm text-gray-500">该成员当前没有待审核、已授予或已拒绝的标签。</p>
              )}
            </div>
            <p className="text-xs text-gray-500">
              重置会删除对应标签申请记录；如果成员需要该标签，需要重新申请或由管理员重新授予。
            </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTagResetTarget(null);
                setSelectedTagResetIds([]);
                setSelectedTagGrantIds([]);
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleResetMemberTags}
              disabled={selectedTagResetIds.length === 0 || isResettingTags}
            >
              {isResettingTags && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              重置所选
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
