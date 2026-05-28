import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { storageApi, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  HardDrive,
  Cloud,
  Plus,
  Loader2,
  Pencil,
  Trash2,
  Server,
  Database,
} from "lucide-react";
import type { StorageBackend } from "@/types";
import { formatFileSize } from "@/lib/utils";

const backendSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(50, "名称最多50个字符"),
  type: z.enum(["local", "s3"]),
  endpoint: z.string().min(1, "Endpoint不能为空"),
  bucket: z.string().optional(),
  rootPath: z.string().optional(),
  region: z.string().optional(),
  accessKey: z.string().optional(),
  secretKey: z.string().optional(),
  quotaBytes: z.number().min(0, "配额不能为负数"),
  isDefault: z.boolean(),
  isEnabled: z.boolean(),
});

type BackendFormData = z.infer<typeof backendSchema>;

export function StorageBackendPage() {
  const [backends, setBackends] = useState<StorageBackend[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBackend, setEditingBackend] = useState<StorageBackend | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingBackend, setDeletingBackend] = useState<StorageBackend | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const form = useForm<BackendFormData>({
    resolver: zodResolver(backendSchema),
    defaultValues: {
      name: "",
      type: "local",
      endpoint: "",
      bucket: "",
      rootPath: "",
      region: "",
      accessKey: "",
      secretKey: "",
      quotaBytes: 10737418240, // 10GB default
      isDefault: false,
      isEnabled: true,
    },
  });

  const fetchBackends = async () => {
    setIsLoading(true);
    try {
      const data = await storageApi.getBackends();
      setBackends(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBackends();
  }, []);

  const openCreateDialog = () => {
    setEditingBackend(null);
    form.reset({
      name: "",
      type: "local",
      endpoint: "",
      bucket: "",
      rootPath: "",
      region: "",
      accessKey: "",
      secretKey: "",
      quotaBytes: 10737418240,
      isDefault: false,
      isEnabled: true,
    });
    setDialogOpen(true);
  };

  const openEditDialog = (backend: StorageBackend) => {
    setEditingBackend(backend);
    form.reset({
      name: backend.name,
      type: backend.type,
      endpoint: backend.endpoint,
      bucket: backend.bucket || "",
      rootPath: backend.rootPath || "",
      region: backend.region || "",
      accessKey: backend.accessKey || "",
      secretKey: "",
      quotaBytes: backend.quotaBytes,
      isDefault: backend.isDefault,
      isEnabled: backend.isEnabled,
    });
    setDialogOpen(true);
  };

  const openDeleteDialog = (backend: StorageBackend) => {
    setDeletingBackend(backend);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = async (data: BackendFormData) => {
    setIsSubmitting(true);
    try {
      if (editingBackend) {
        await storageApi.updateBackend(editingBackend.id, data);
        toast.success("存储后端已更新");
      } else {
        await storageApi.createBackend(data);
        toast.success("存储后端已创建");
      }
      setDialogOpen(false);
      fetchBackends();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingBackend) return;
    setIsDeleting(true);
    try {
      await storageApi.deleteBackend(deletingBackend.id);
      toast.success("存储后端已删除");
      setDeleteDialogOpen(false);
      fetchBackends();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  const totalQuota = backends.reduce((sum, b) => sum + b.quotaBytes, 0);
  const totalUsed = backends.reduce((sum, b) => sum + b.usedBytes, 0);

  return (
    <div className="max-w-full md:max-w-5xl mx-auto space-y-6 px-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display text-gray-800 flex items-center gap-2">
            <Database className="w-6 h-6 text-gray-400" />
            存储后端管理
          </h1>
          <p className="text-sm text-gray-500 mt-1">管理系统文件存储后端配置</p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="w-4 h-4 mr-1.5" />
          添加后端
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                <Server className="w-5 h-5 text-primary-500" />
              </div>
              <div>
                <p className="text-sm text-gray-500">后端数量</p>
                <p className="text-xl font-semibold text-gray-800">{backends.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                <HardDrive className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-gray-500">总配额</p>
                <p className="text-xl font-semibold text-gray-800">{formatFileSize(totalQuota)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Cloud className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-gray-500">已使用</p>
                <p className="text-xl font-semibold text-gray-800">{formatFileSize(totalUsed)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Backend List */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2">存储后端列表</CardTitle>
          <CardDescription>所有已配置的存储后端</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          ) : backends.length === 0 ? (
            <div className="text-center py-12">
              <Database className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">暂无存储后端</p>
              <p className="text-xs text-gray-400 mt-1">点击右上角添加后端</p>
            </div>
          ) : (
            <div className="space-y-4">
              {backends.map((backend) => {
                const usagePercent = backend.quotaBytes > 0
                  ? Math.round((backend.usedBytes / backend.quotaBytes) * 100)
                  : 0;

                return (
                  <div
                    key={backend.id}
                    className="border rounded-lg p-4 space-y-3 hover:border-primary-200 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
                          {backend.type === "s3" ? (
                            <Cloud className="w-5 h-5 text-primary-500" />
                          ) : (
                            <HardDrive className="w-5 h-5 text-green-500" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">
                              {backend.name}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {backend.type === "s3" ? "S3" : "本地"}
                            </Badge>
                            {backend.isDefault && (
                              <Badge variant="default" className="text-[10px]">默认</Badge>
                            )}
                            {!backend.isEnabled && (
                              <Badge variant="secondary" className="text-[10px]">已禁用</Badge>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{backend.endpoint}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => openEditDialog(backend)}
                        >
                          <Pencil className="w-4 h-4 text-gray-400" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => openDeleteDialog(backend)}
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">
                          已用 {formatFileSize(backend.usedBytes)} / {formatFileSize(backend.quotaBytes)}
                        </span>
                        <span className="text-gray-500">{usagePercent}%</span>
                      </div>
                      <Progress value={usagePercent} className="h-1.5" />
                    </div>

                    {backend.projectCount > 0 && (
                      <p className="text-xs text-gray-400">
                        关联项目: {backend.projectCount} 个
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingBackend ? "编辑存储后端" : "添加存储后端"}
            </DialogTitle>
            <DialogDescription>
              {editingBackend
                ? "修改存储后端的配置信息"
                : "配置新的文件存储后端"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>名称</FormLabel>
                    <FormControl>
                      <Input placeholder="例如：主存储" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>类型</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择存储类型" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="local">本地存储</SelectItem>
                        <SelectItem value="s3">S3 兼容存储</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endpoint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Endpoint</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={form.watch("type") === "s3" ? "https://s3.amazonaws.com" : "/data/storage"}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {form.watch("type") === "s3" && (
                <>
                  <FormField
                    control={form.control}
                    name="bucket"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bucket</FormLabel>
                        <FormControl>
                          <Input placeholder="my-bucket" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="region"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Region</FormLabel>
                        <FormControl>
                          <Input placeholder="us-east-1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="accessKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Access Key</FormLabel>
                        <FormControl>
                          <Input placeholder="AKIA..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="secretKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Secret Key</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder={editingBackend ? "留空保持不变" : "..."}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {form.watch("type") === "local" && (
                <FormField
                  control={form.control}
                  name="rootPath"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>根路径</FormLabel>
                      <FormControl>
                        <Input placeholder="/data/storage" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="quotaBytes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>配额 (GB)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        {...field}
                        value={Math.round(field.value / 1073741824)}
                        onChange={(e) => field.onChange(Number(e.target.value) * 1073741824)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex items-center gap-6">
                <FormField
                  control={form.control}
                  name="isDefault"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="text-sm font-normal">设为默认</FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="isEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="text-sm font-normal">启用</FormLabel>
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
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

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除存储后端「{deletingBackend?.name}」吗？
              {deletingBackend && deletingBackend.projectCount > 0 && (
                <span className="block mt-2 text-red-500">
                  警告：该后端关联了 {deletingBackend.projectCount} 个项目，删除后这些项目将无法访问文件！
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  删除中...
                </>
              ) : (
                "删除"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
