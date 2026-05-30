import { useState, useEffect, useCallback } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authApi, roleTagApi, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import {
  Settings,
  Shield,
  Users,
  Lock,
  Loader2,
  Save,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  User,
  FileText,
  Tag,
} from "lucide-react";
import type { RoleTagDefinition, RoleTagApplication, TaskRole } from "@/types";
import { TASK_ROLE_MAP } from "@/lib/utils";

const settingsSchema = z.object({
  mode: z.enum(["disabled", "open", "qq_verification"]),
  qqGroup: z.string().optional(),
  codeLength: z.number().min(4).max(12),
  roleTagEnabled: z.boolean(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

const tagSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(20, "名称最多20个字符"),
  roleType: z.string().min(1, "请选择岗位类型"),
  description: z.string().max(200, "描述最多200个字符").optional(),
});

type TagFormData = z.infer<typeof tagSchema>;

const registrationModeOptions = [
  {
    value: "disabled" as const,
    label: "禁止注册",
    description: "关闭注册入口，仅管理员可创建账号",
    icon: Lock,
    activeClass: "border-red-200 bg-red-50/30",
    iconClass: "text-red-500",
  },
  {
    value: "open" as const,
    label: "开放注册",
    description: "任何人都可以直接注册并立即使用",
    icon: Users,
    activeClass: "border-green-200 bg-green-50/30",
    iconClass: "text-green-500",
  },
  {
    value: "qq_verification" as const,
    label: "QQ群验证注册",
    description: "注册后需要在指定QQ群发送验证指令激活账号",
    icon: Shield,
    activeClass: "border-primary-200 bg-primary-50/50",
    iconClass: "text-primary-500",
  },
];

export function RegistrationSettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [tags, setTags] = useState<RoleTagDefinition[]>([]);
  const [applications, setApplications] = useState<RoleTagApplication[]>([]);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<RoleTagDefinition | null>(null);
  const [isSubmittingTag, setIsSubmittingTag] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reasonApplication, setReasonApplication] = useState<RoleTagApplication | null>(null);
  const [activeTab, setActiveTab] = useState<"settings" | "tags" | "applications">("settings");

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      mode: "qq_verification",
      qqGroup: "",
      codeLength: 8,
      roleTagEnabled: true,
    },
  });

  const tagForm = useForm<TagFormData>({
    resolver: zodResolver(tagSchema),
    defaultValues: { name: "", roleType: "", description: "" },
  });

  const mode = useWatch({
    control: form.control,
    name: "mode",
  });

  const setRegistrationMode = (value: SettingsFormData["mode"]) => {
    form.setValue("mode", value, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [settingsData, tagsData, appsData] = await Promise.all([
        authApi.getRegistrationPolicy(),
        roleTagApi.getAllTags(),
        roleTagApi.getApplications({ status: "pending" }),
      ]);
      form.reset({
        mode: settingsData.mode,
        qqGroup: settingsData.qqGroup || "",
        codeLength: settingsData.codeLength,
        roleTagEnabled: settingsData.roleTagEnabled,
      });
      setTags(tagsData);
      setApplications(appsData);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [form]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveSettings = async (data: SettingsFormData) => {
    setIsSaving(true);
    try {
      await authApi.updateRegistrationPolicy(data);
      toast.success("设置已保存");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const openCreateTagDialog = () => {
    setEditingTag(null);
    tagForm.reset({ name: "", roleType: "", description: "" });
    setTagDialogOpen(true);
  };

  const openEditTagDialog = (tag: RoleTagDefinition) => {
    setEditingTag(tag);
    tagForm.reset({
      name: tag.name,
      roleType: tag.roleType,
      description: tag.description || "",
    });
    setTagDialogOpen(true);
  };

  const handleSubmitTag = async (data: TagFormData) => {
    setIsSubmittingTag(true);
    try {
      if (editingTag) {
        await roleTagApi.updateTag(editingTag.id, data);
        toast.success("标签已更新");
      } else {
        await roleTagApi.createTag(data);
        toast.success("标签已创建");
      }
      setTagDialogOpen(false);
      const tagsData = await roleTagApi.getAllTags();
      setTags(tagsData);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSubmittingTag(false);
    }
  };

  const handleDeleteTag = async (id: string) => {
    try {
      await roleTagApi.deleteTag(id);
      toast.success("标签已删除");
      setTags((prev) => prev.filter((t) => t.id !== id));
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleReview = async (id: string, status: "approved" | "rejected") => {
    setReviewingId(id);
    try {
      await roleTagApi.reviewApplication(id, { status });
      toast.success(status === "approved" ? "已通过申请" : "已驳回申请");
      const appsData = await roleTagApi.getApplications({ status: "pending" });
      setApplications(appsData);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setReviewingId(null);
    }
  };

  const roleOptions = Object.entries(TASK_ROLE_MAP).map(([key, value]) => ({
    value: key as TaskRole,
    label: value.label,
  }));

  return (
    <div className="max-w-full md:max-w-3xl mx-auto space-y-6 px-0">
      <div>
        <h1 className="text-display text-gray-800 flex items-center gap-2">
          <Settings className="w-6 h-6 text-gray-400" />
          注册策略
        </h1>
        <p className="text-sm text-gray-500 mt-1">配置用户注册和准入控制策略</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {[
          { key: "settings" as const, label: "注册设置", icon: Settings },
          { key: "tags" as const, label: "资格标签", icon: Tag },
          { key: "applications" as const, label: "申请审核", icon: FileText },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {tab.key === "applications" && applications.length > 0 && (
              <span className="ml-1 text-[10px] bg-primary-500 text-white px-1.5 py-0.5 rounded-full">
                {applications.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "settings" && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSaveSettings)} className="space-y-6">
            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-h2">注册模式</CardTitle>
                <CardDescription>选择平台允许的注册方式</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {isLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-20 rounded-lg" />
                    <Skeleton className="h-20 rounded-lg" />
                    <Skeleton className="h-20 rounded-lg" />
                  </div>
                ) : (
                  <FormField
                    control={form.control}
                    name="mode"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <div className="space-y-4" role="radiogroup" aria-label="注册模式">
                            {registrationModeOptions.map((option) => {
                              const Icon = option.icon;
                              const selected = field.value === option.value;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  role="radio"
                                  aria-checked={selected}
                                  onClick={() => setRegistrationMode(option.value)}
                                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors md:p-4 ${
                                    selected
                                      ? option.activeClass
                                      : "border-gray-200 hover:bg-gray-50"
                                  }`}
                                >
                                  <span
                                    className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                      selected ? "border-primary-500" : "border-gray-300"
                                    }`}
                                  >
                                    {selected && <span className="h-2 w-2 rounded-full bg-primary-500" />}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
                                      <Icon className={`h-4 w-4 ${option.iconClass}`} />
                                      {option.label}
                                    </span>
                                    <span className="mt-1 block text-xs text-gray-500">
                                      {option.description}
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {mode === "qq_verification" && (
                  <div className="space-y-4 pt-4 border-t">
                    <FormField
                      control={form.control}
                      name="qqGroup"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>验证QQ群号</FormLabel>
                          <FormControl>
                            <Input placeholder="输入QQ群号" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="codeLength"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>验证码长度</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={4}
                              max={12}
                              value={field.value}
                              onChange={(event) => field.onChange(event.target.valueAsNumber)}
                              onBlur={field.onBlur}
                              name={field.name}
                              ref={field.ref}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-h2">资格标签</CardTitle>
                <CardDescription>配置用户资格标签申请和审批</CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="roleTagEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between space-y-0">
                      <div>
                        <p className="text-sm font-medium text-gray-700">启用资格标签申请</p>
                        <p className="text-xs text-gray-500">允许用户在注册时选择意向岗位标签</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    保存设置
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      )}

      {activeTab === "tags" && (
        <Card>
          <CardHeader className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-h2">资格标签管理</CardTitle>
                <CardDescription>管理所有可用的岗位资格标签</CardDescription>
              </div>
              <Button size="sm" onClick={openCreateTagDialog}>
                <Plus className="w-4 h-4 mr-1.5" />
                新建标签
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            ) : tags.length === 0 ? (
              <div className="text-center py-8">
                <Tag className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">暂无标签</p>
                <p className="text-xs text-gray-400 mt-1">点击右上角创建标签</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="flex items-center justify-between py-3 px-2 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{TASK_ROLE_MAP[tag.roleType]?.label || tag.roleType}</Badge>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{tag.name}</p>
                        {tag.description && (
                          <p className="text-xs text-gray-500">{tag.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => openEditTagDialog(tag)}
                      >
                        <Pencil className="w-4 h-4 text-gray-400" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => handleDeleteTag(tag.id)}
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "applications" && (
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-h2">标签申请审核</CardTitle>
            <CardDescription>审核成员提交的岗位标签申请</CardDescription>
          </CardHeader>
          <CardContent>
            {applications.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">暂无待审核的申请</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>申请人</TableHead>
                      <TableHead>申请标签</TableHead>
                      <TableHead>申请理由</TableHead>
                      <TableHead>申请时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {applications.map((app) => (
                      <TableRow key={app.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <span className="text-sm">{app.user.username}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{app.tag.name}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-primary-600 hover:text-primary-700"
                            onClick={() => setReasonApplication(app)}
                          >
                            <FileText className="w-3.5 h-3.5 mr-1.5" />
                            查看理由
                          </Button>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-500">
                            {new Date(app.createdAt).toLocaleDateString("zh-CN")}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600 hover:bg-green-50 hover:text-green-700"
                              disabled={reviewingId === app.id}
                              onClick={() => handleReview(app.id, "approved")}
                            >
                              {reviewingId === app.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              )}
                              通过
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:bg-red-50 hover:text-red-700"
                              disabled={reviewingId === app.id}
                              onClick={() => handleReview(app.id, "rejected")}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              驳回
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tag Dialog */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTag ? "编辑标签" : "新建标签"}
            </DialogTitle>
            <DialogDescription>
              {editingTag ? "修改标签信息" : "创建新的岗位资格标签"}
            </DialogDescription>
          </DialogHeader>
          <Form {...tagForm}>
            <form onSubmit={tagForm.handleSubmit(handleSubmitTag)} className="space-y-4">
              <FormField
                control={tagForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>标签名称</FormLabel>
                    <FormControl>
                      <Input placeholder="例如：资深翻译" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={tagForm.control}
                name="roleType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>岗位类型</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择岗位类型" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {roleOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={tagForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>描述</FormLabel>
                    <FormControl>
                      <Input placeholder="标签描述（可选）" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setTagDialogOpen(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={isSubmittingTag}>
                  {isSubmittingTag ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      保存中...
                    </>
                  ) : (
                    "保存"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reasonApplication} onOpenChange={(open) => !open && setReasonApplication(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>申请理由</DialogTitle>
            <DialogDescription>
              {reasonApplication?.user.username} 申请 {reasonApplication?.tag.name}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-md border bg-gray-50 p-4 text-sm text-gray-700">
            {reasonApplication?.reason || "未填写申请理由"}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonApplication(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
