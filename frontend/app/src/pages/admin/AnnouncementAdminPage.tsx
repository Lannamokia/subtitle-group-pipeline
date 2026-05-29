import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { announcementApi, api, getErrorMessage } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
} from "@/components/ui/form";
import type { Announcement } from "@/types";
import {
  Megaphone,
  Plus,
  Pencil,
  Trash2,
  Pin,
  Globe,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";

const announcementSchema = z.object({
  title: z.string().min(1, "标题不能为空").max(200, "标题最多200字"),
  content: z.string().min(1, "内容不能为空").max(5000, "内容最多5000字"),
  pinned: z.boolean(),
});

type AnnouncementFormValues = z.infer<typeof announcementSchema>;

export function AnnouncementAdminPage() {
  const currentUser = useAuthStore((s) => s.user);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    announcementApi.getAnnouncements({ type: "global" })
      .then(setAnnouncements)
      .catch(() => {});
  }, []);

  const form = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementSchema),
    defaultValues: {
      title: "",
      content: "",
      pinned: false,
    },
  });

  const openCreateDialog = () => {
    setEditingAnnouncement(null);
    form.reset({ title: "", content: "", pinned: false });
    setIsDialogOpen(true);
  };

  const openEditDialog = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    form.reset({
      title: announcement.title,
      content: announcement.content,
      pinned: false, // Would come from a pinned field in real data
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: AnnouncementFormValues) => {
    setIsSubmitting(true);
    try {
      if (editingAnnouncement) {
        const updated = await announcementApi.updateAnnouncement(editingAnnouncement.id, {
          title: data.title,
          content: data.content,
          isPinned: data.pinned,
        });
        setAnnouncements((prev) =>
          prev.map((a) =>
            a.id === editingAnnouncement.id
              ? updated
              : a
          )
        );
      } else {
        const created = await announcementApi.createAnnouncement({
          type: "global",
          title: data.title,
          content: data.content,
          isPinned: data.pinned,
        });
        setAnnouncements((prev) => [created, ...prev]);
      }
      setIsDialogOpen(false);
      toast.success(editingAnnouncement ? "公告已保存" : "公告已发布");
    } catch (error) {
      toast.error("公告操作失败: " + getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await announcementApi.deleteAnnouncement(id);
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      toast.success("公告已删除");
    } catch (error) {
      toast.error("删除失败: " + getErrorMessage(error));
    }
  };

  const handleTogglePin = async (id: string) => {
    try {
      await api.post(`/announcements/${id}/pin`, { pinned: true });
      setAnnouncements(await announcementApi.getAnnouncements({ type: "global" }));
    } catch (error) {
      toast.error("置顶失败: " + getErrorMessage(error));
    }
  };

  const regularAnnouncements = announcements;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display text-gray-800 flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-primary-500" />
            全局公告管理
          </h1>
          <p className="text-sm text-gray-500 mt-1">创建和管理全站公告</p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="w-4 h-4 mr-1.5" />
          新建公告
        </Button>
      </div>

      {/* Announcements list */}
      <div className="space-y-3">
        {regularAnnouncements.map((announcement) => (
          <AnnouncementCard
            key={announcement.id}
            announcement={announcement}
            onEdit={() => openEditDialog(announcement)}
            onDelete={() => handleDelete(announcement.id)}
            onTogglePin={() => handleTogglePin(announcement.id)}
          />
        ))}
        {announcements.length === 0 && (
          <EmptyState />
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingAnnouncement ? "编辑公告" : "新建公告"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>标题</FormLabel>
                    <FormControl>
                      <Input placeholder="输入公告标题..." {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>内容</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="输入公告内容..."
                        className="min-h-[120px]"
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="pinned"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <FormLabel>置顶公告</FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {editingAnnouncement ? "保存" : "发布"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AnnouncementCard({
  announcement,
  onEdit,
  onDelete,
  onTogglePin,
}: {
  announcement: Announcement;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = announcement.content.length > 200;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary-500" />
              <h3 className="text-sm font-medium text-gray-800">
                {announcement.title}
              </h3>
              <Badge variant="outline" className="text-[10px]">
                全局
              </Badge>
            </div>
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatRelativeTime(announcement.createdAt)} · 发布者: {announcement.createdBy.username}
            </p>
            <div className="mt-2">
              <p
                className={cn(
                  "text-sm text-gray-600 leading-relaxed",
                  !expanded && isLong && "line-clamp-3"
                )}
              >
                {announcement.content}
              </p>
              {isLong && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="text-xs text-primary-500 hover:text-primary-600 mt-1"
                >
                  {expanded ? "收起" : "展开更多"}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={onTogglePin}
            >
              <Pin className="w-4 h-4 text-gray-400" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={onEdit}
            >
              <Pencil className="w-4 h-4 text-gray-400" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认删除</AlertDialogTitle>
                  <AlertDialogDescription>
                    确定要删除公告「{announcement.title}」吗？此操作不可撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-16 text-center">
        <Megaphone className="w-10 h-10 text-gray-300" />
        <p className="text-sm text-gray-500 mt-3">暂无公告</p>
        <p className="text-xs text-gray-400 mt-1">创建第一条全局公告</p>
      </CardContent>
    </Card>
  );
}
