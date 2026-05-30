import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuthStore } from "@/stores/authStore";
import { authApi, storageApi, roleTagApi, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { AvatarCropDialog } from "@/components/AvatarCropDialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import { UserCircle, Camera, Save, Loader2, Shield, Clock, XCircle } from "lucide-react";
import type { UserRoleTagStatus } from "@/types";

const profileSchema = z.object({
  username: z.string().min(2, "用户名至少2个字符").max(20, "用户名最多20个字符"),
  nickname: z.string().max(20, "昵称最多20个字符").optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  granted: { label: "已授予", variant: "default", icon: <Shield className="w-3 h-3" /> },
  pending: { label: "申请中", variant: "secondary", icon: <Clock className="w-3 h-3" /> },
  rejected: { label: "已驳回", variant: "destructive", icon: <XCircle className="w-3 h-3" /> },
  not_applied: { label: "未申请", variant: "outline", icon: <UserCircle className="w-3 h-3" /> },
};

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar || "");
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);
  const [tagStatuses, setTagStatuses] = useState<UserRoleTagStatus[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      username: user?.username || "",
      nickname: "",
    },
  });

  // Fetch current user data and tag statuses
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setTagsLoading(true);
      try {
        const [meData, tagData] = await Promise.all([
          authApi.me(),
          roleTagApi.getMyTagStatuses().catch(() => [] as UserRoleTagStatus[]),
        ]);
        updateUser(meData);
        setAvatarUrl(meData.avatar || "");
        form.reset({
          username: meData.username,
          nickname: meData.nickname || "",
        });
        setTagStatuses(tagData);
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setIsLoading(false);
        setTagsLoading(false);
      }
    };
    fetchData();
  }, [form, updateUser]);

  const handleSave = async (data: ProfileFormData) => {
    setIsSaving(true);
    try {
      const updated = await authApi.updateProfile({
        nickname: data.nickname,
      });
      updateUser(updated);
      setAvatarUrl(updated.avatar || avatarUrl || "");
      toast.success("保存成功");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const closeCropDialog = () => {
    setCropImageUrl((current) => {
      if (current?.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
  };

  const uploadAvatarFile = async (file: File) => {
    setIsAvatarUploading(true);
    try {
      const result = await storageApi.uploadAvatar(file);
      setAvatarUrl(result.url);
      const updated = await authApi.updateProfile({ avatarUrl: result.storageUrl });
      updateUser(updated);
      setAvatarUrl(updated.avatar || result.url);
      toast.success("头像上传成功");
      closeCropDialog();
    } catch (error) {
      setAvatarUrl(user?.avatar || "");
      toast.error(getErrorMessage(error));
    } finally {
      setIsAvatarUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("请上传图片文件");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("图片大小不能超过5MB");
      return;
    }

    closeCropDialog();
    setCropImageUrl(URL.createObjectURL(file));
    e.currentTarget.value = "";
  };

  return (
    <div className="max-w-full md:max-w-2xl mx-auto space-y-6 px-0">
      <h1 className="text-display text-gray-800">个人设置</h1>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2">基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Skeleton className="w-16 h-16 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="w-24 h-4" />
                  <Skeleton className="w-16 h-3" />
                </div>
              </div>
              <Skeleton className="w-full h-10" />
              <Skeleton className="w-full h-10" />
            </div>
          ) : (
            <>
              {/* Avatar */}
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Avatar className="w-16 h-16">
                    <AvatarImage src={avatarUrl} alt={user?.username} />
                    <AvatarFallback className="bg-primary-100 text-primary-700 text-lg font-medium">
                      {user?.username?.charAt(0).toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <button
                    type="button"
                    onClick={handleAvatarClick}
                    disabled={isAvatarUploading}
                    className="absolute -bottom-1 -right-1 w-7 h-7 bg-primary-500 text-white rounded-full flex items-center justify-center shadow-sm hover:bg-primary-600 transition-colors"
                  >
                    {isAvatarUploading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Camera className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{user?.username}</p>
                  <p className="text-xs text-gray-400">
                    {user?.role === "supervisor"
                      ? "监制"
                      : user?.role === "super_admin"
                        ? "超级管理员"
                        : user?.role === "group_admin"
                          ? "组管理员"
                          : "成员"}
                  </p>
                </div>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSave)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>用户名</FormLabel>
                        <FormControl>
                          <Input {...field} disabled className="bg-gray-50" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="nickname"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>昵称</FormLabel>
                        <FormControl>
                          <Input placeholder="设置昵称" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-2">
                    <Label>QQ号</Label>
                    <Input value={user?.qq || ""} disabled className="bg-gray-50" />
                    <p className="text-xs text-gray-400">QQ号由系统绑定，不可修改</p>
                  </div>

                  <Button type="submit" disabled={isSaving || isAvatarUploading}>
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        保存中...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        保存
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2">技能标签</CardTitle>
        </CardHeader>
        <CardContent>
          {tagsLoading ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="w-20 h-8 rounded-full" />
              ))}
            </div>
          ) : tagStatuses.length === 0 ? (
            <div className="text-center py-6">
              <UserCircle className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">暂无技能标签</p>
              <p className="text-xs text-gray-400 mt-1">
                前往技能档案页面申请岗位标签
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tagStatuses.map((item) => {
                const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.not_applied;
                return (
                  <Badge
                    key={item.tag.id}
                    variant={config.variant}
                    className="px-3 py-1.5 gap-1"
                  >
                    {config.icon}
                    {item.tag.name}
                    <span className="text-[10px] opacity-70">{config.label}</span>
                  </Badge>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AvatarCropDialog
        open={Boolean(cropImageUrl)}
        imageUrl={cropImageUrl}
        uploading={isAvatarUploading}
        onCancel={closeCropDialog}
        onConfirm={uploadAvatarFile}
      />
    </div>
  );
}
