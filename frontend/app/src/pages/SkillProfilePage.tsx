import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuthStore } from "@/stores/authStore";
import { roleTagApi, getErrorMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import {
  Award,
  Clock,
  CheckCircle2,
  XCircle,
  Plus,
  Loader2,
  Shield,
  User,
} from "lucide-react";
import type { RoleTagDefinition, RoleTagApplication, UserRoleTagStatus } from "@/types";

const applySchema = z.object({
  reason: z.string().min(10, "申请理由至少10个字符").max(500, "申请理由最多500个字符"),
});

type ApplyFormData = z.infer<typeof applySchema>;

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  granted: { label: "已授予", color: "bg-green-100 text-green-700 border-green-200", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  pending: { label: "申请中", color: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: <Clock className="w-3.5 h-3.5" /> },
  rejected: { label: "已驳回", color: "bg-red-100 text-red-700 border-red-200", icon: <XCircle className="w-3.5 h-3.5" /> },
  not_applied: { label: "未申请", color: "bg-gray-100 text-gray-600 border-gray-200", icon: null },
};

export function SkillProfilePage() {
  const { isAdmin } = useAuthStore();
  const [allTags, setAllTags] = useState<RoleTagDefinition[]>([]);
  const [myStatuses, setMyStatuses] = useState<UserRoleTagStatus[]>([]);
  const [applications, setApplications] = useState<RoleTagApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [selectedTag, setSelectedTag] = useState<RoleTagDefinition | null>(null);
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [adminView, setAdminView] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const form = useForm<ApplyFormData>({
    resolver: zodResolver(applySchema),
    defaultValues: { reason: "" },
  });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [tagsData, statusesData] = await Promise.all([
        roleTagApi.getAllTags(),
        roleTagApi.getMyTagStatuses(),
      ]);
      setAllTags(tagsData);
      setMyStatuses(statusesData);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const fetchApplications = async () => {
    try {
      const result = await roleTagApi.getApplications({ status: "pending" });
      setApplications(result.items);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  useEffect(() => {
    fetchData();
    if (isAdmin()) {
      fetchApplications();
    }
  }, []);

  const handleApply = async (data: ApplyFormData) => {
    if (!selectedTag) return;
    setIsApplying(true);
    try {
      await roleTagApi.applyForTag(selectedTag.id, data.reason);
      toast.success("申请已提交，等待审核");
      setApplyDialogOpen(false);
      form.reset();
      fetchData();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsApplying(false);
    }
  };

  const openApplyDialog = (tag: RoleTagDefinition) => {
    setSelectedTag(tag);
    form.reset({ reason: "" });
    setApplyDialogOpen(true);
  };

  const handleReview = async (id: string, status: "approved" | "rejected") => {
    setReviewingId(id);
    try {
      await roleTagApi.reviewApplication(id, { status });
      toast.success(status === "approved" ? "已通过申请" : "已驳回申请");
      fetchApplications();
      fetchData();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setReviewingId(null);
    }
  };

  const getTagStatus = (tagId: string): string => {
    const status = myStatuses.find((s) => s.tag.id === tagId);
    return status?.status || "not_applied";
  };

  return (
    <div className="max-w-full md:max-w-4xl mx-auto space-y-6 px-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display text-gray-800 flex items-center gap-2">
            <Award className="w-6 h-6 text-primary-500" />
            技能档案
          </h1>
          <p className="text-sm text-gray-500 mt-1">管理你的岗位技能标签和申请记录</p>
        </div>
        {isAdmin() && (
          <Button
            variant={adminView ? "default" : "outline"}
            size="sm"
            onClick={() => setAdminView(!adminView)}
          >
            <Shield className="w-4 h-4 mr-1.5" />
            {adminView ? "返回我的档案" : "审核申请"}
          </Button>
        )}
      </div>

      {!adminView ? (
        <>
          {/* My Tags */}
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-h2">我的技能标签</CardTitle>
              <CardDescription>已申请和已授予的岗位标签</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="w-24 h-8 rounded-full" />
                  ))}
                </div>
              ) : myStatuses.length === 0 ? (
                <div className="text-center py-8">
                  <Award className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">暂无技能标签</p>
                  <p className="text-xs text-gray-400 mt-1">点击下方标签进行申请</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {myStatuses.map((item) => {
                    const config = STATUS_CONFIG[item.status];
                    return (
                      <Badge
                        key={item.tag.id}
                        variant="outline"
                        className={`px-3 py-1.5 gap-1 ${config.color}`}
                      >
                        {config.icon}
                        {item.tag.name}
                        <span className="text-[10px] opacity-80">{config.label}</span>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Available Tags */}
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-h2">可申请标签</CardTitle>
              <CardDescription>选择你擅长或有意向的岗位进行申请</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 rounded-lg" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {allTags.map((tag) => {
                    const status = getTagStatus(tag.id);
                    const config = STATUS_CONFIG[status];
                    const canApply = status === "not_applied" || status === "rejected";

                    return (
                      <div
                        key={tag.id}
                        className="border rounded-lg p-4 flex items-start justify-between gap-3 hover:border-primary-200 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">{tag.name}</span>
                            <Badge variant="outline" className={`text-[10px] ${config.color}`}>
                              {config.label}
                            </Badge>
                          </div>
                          {tag.description && (
                            <p className="text-xs text-gray-500 mt-1">{tag.description}</p>
                          )}
                        </div>
                        {canApply && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            onClick={() => openApplyDialog(tag)}
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" />
                            申请
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        /* Admin Review View */
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-h2">待审核申请</CardTitle>
            <CardDescription>审核成员的岗位标签申请</CardDescription>
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
                          <p className="text-sm text-gray-600 max-w-xs truncate">{app.reason}</p>
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

      {/* Apply Dialog */}
      <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Award className="w-5 h-5 text-primary-500" />
              申请标签：{selectedTag?.name}
            </DialogTitle>
            <DialogDescription>
              请填写申请理由，管理员审核通过后即可获得该标签
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleApply)} className="space-y-4">
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>申请理由</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="请描述你的相关经验、技能水平或意向..."
                        className="min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setApplyDialogOpen(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={isApplying}>
                  {isApplying ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      提交中...
                    </>
                  ) : (
                    "提交申请"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
