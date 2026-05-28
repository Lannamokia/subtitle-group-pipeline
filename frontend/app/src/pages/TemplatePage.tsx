import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { useForm, useFieldArray, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, getErrorMessage } from "@/lib/api";
import { cn, getRoleLabel } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import type { ProjectTemplate, TaskRole } from "@/types";
import {
  Plus,
  Search,
  ArrowRight,
  Film,
  Monitor,
  FolderOpen,
  Loader2,
  Pencil,
  Trash2,
  Star,
  GripVertical,
  X,
} from "lucide-react";

type TemplateType = "all" | "anime" | "movie" | "collection";

const typeIcons: Record<string, React.ReactNode> = {
  anime: <Monitor className="w-4 h-4" />,
  movie: <Film className="w-4 h-4" />,
  collection: <FolderOpen className="w-4 h-4" />,
};

const typeLabels: Record<string, string> = {
  anime: "番剧",
  movie: "电影",
  collection: "合集",
};

const ALL_ROLES: TaskRole[] = [
  "source",
  "timing",
  "translation",
  "post_production",
  "encoding",
  "release",
  "supervisor",
];

// Zod schema for template form
const roleConfigSchema = z.object({
  role: z.string(),
  enabled: z.boolean(),
  slotCount: z.number().min(1).max(20),
  assignmentStrategy: z.enum(["manual", "open_claim"]),
  maxSegmentLength: z.number().min(0).optional(),
});

const deliveryItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "名称不能为空"),
  role: z.string(),
  required: z.boolean(),
});

const templateFormSchema = z.object({
  name: z.string().min(1, "模板名称不能为空").max(100),
  type: z.enum(["anime", "movie", "collection"]),
  description: z.string().optional(),
  roles: z.array(roleConfigSchema),
  uploadPolicy: z.object({
    allowedTypes: z.record(z.string(), z.array(z.string())),
  }),
  notificationPolicy: z.object({
    events: z.record(z.string(), z.array(z.string())),
  }),
  assPolicy: z.object({
    mergeRule: z.string(),
    dedupThreshold: z.number().min(0).max(1),
  }),
  productConfig: z.object({
    resolution: z.string(),
    bitrate: z.string(),
    encoder: z.string(),
    containerFormat: z.string(),
    namingRule: z.string(),
  }),
  deliveryChecklist: z.array(deliveryItemSchema),
});

type TemplateFormValues = z.infer<typeof templateFormSchema>;

const defaultFormValues: TemplateFormValues = {
  name: "",
  type: "anime",
  description: "",
  roles: ALL_ROLES.map((role) => ({
    role,
    enabled: role !== "supervisor",
    slotCount: role === "translation" ? 3 : 1,
    assignmentStrategy: role === "translation" ? "open_claim" : "manual",
    maxSegmentLength: role === "translation" ? 300 : undefined,
  })),
  uploadPolicy: { allowedTypes: {} },
  notificationPolicy: {
    events: {
      task_assigned: ["in_site"],
      task_submitted: ["in_site", "email"],
      review_completed: ["in_site"],
    },
  },
  assPolicy: { mergeRule: "default", dedupThreshold: 0.1 },
  productConfig: {
    resolution: "1920x1080",
    bitrate: "8000k",
    encoder: "x264",
    containerFormat: "mkv",
    namingRule: "{title}_{ep}_{quality}",
  },
  deliveryChecklist: [
    { id: "d1", name: "成品视频", role: "encoding", required: true },
    { id: "d2", name: "外挂字幕", role: "translation", required: true },
    { id: "d3", name: "字体包", role: "post_production", required: true },
  ],
};

export function TemplatePage() {
  const navigate = useNavigate();
  const isSupervisor = useAuthStore((s) => s.isSupervisor());
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TemplateType>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<ProjectTemplate | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<ProjectTemplate | null>(null);
  const [detailTemplate, setDetailTemplate] = useState<ProjectTemplate | null>(null);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ProjectTemplate[]>("/templates");
      setTemplates(res.data);
    } catch (error) {
      toast.error("获取模板列表失败: " + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleDelete = async () => {
    if (!deleteTemplate) return;
    try {
      await api.delete(`/templates/${deleteTemplate.id}`);
      toast.success("模板已删除");
      setTemplates((prev) => prev.filter((t) => t.id !== deleteTemplate.id));
      setDeleteTemplate(null);
    } catch (error) {
      toast.error("删除失败: " + getErrorMessage(error));
    }
  };

  const handleSetDefault = async (templateId: string) => {
    try {
      await api.post(`/templates/${templateId}/default`);
      setDefaultTemplateId(templateId);
      toast.success("已设为默认模板");
    } catch (error) {
      toast.error("设置失败: " + getErrorMessage(error));
    }
  };

  const filtered = templates.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display text-gray-800">项目模板</h1>
          <p className="text-sm text-gray-500 mt-1">管理和创建项目模板，快速启动标准化工作流</p>
        </div>
        {isSupervisor && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            新建模板
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="搜索模板..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={typeFilter} onValueChange={(v) => setTypeFilter(v as TemplateType)}>
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="anime">番剧</TabsTrigger>
            <TabsTrigger value="movie">电影</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {filtered.map((template) => (
            <Card
              key={template.id}
              className="group hover:shadow-lg transition-all cursor-pointer overflow-hidden"
              onClick={() => setDetailTemplate(template)}
            >
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">{typeIcons[template.type]}</span>
                    <h3 className="text-h3 text-gray-800">{template.name}</h3>
                  </div>
                  <div className="flex items-center gap-1">
                    {defaultTemplateId === template.id && (
                      <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {typeLabels[template.type]}
                    </Badge>
                  </div>
                </div>
                <p className="text-sm text-gray-500 line-clamp-2">{template.description}</p>

                {/* Role chain visualization */}
                <div className="flex items-center gap-1 flex-wrap">
                  {template.roles
                    .filter((r) => r.enabled)
                    .map((role, i, arr) => (
                      <div key={role.role} className="flex items-center">
                        <span className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-600">
                          {getRoleLabel(role.role)}
                        </span>
                        {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-gray-300 mx-0.5" />}
                      </div>
                    ))}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <span className="text-xs text-gray-400">已使用 {template.useCount} 次</span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate("/projects/new", { state: { templateId: template.id } });
                      }}
                    >
                      快速开项
                    </Button>
                    {isSupervisor && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditTemplate(template);
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTemplate(template);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <TemplateFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchTemplates}
      />

      {/* Edit Dialog */}
      {editTemplate && (
        <TemplateFormDialog
          open={!!editTemplate}
          onOpenChange={(open) => !open && setEditTemplate(null)}
          template={editTemplate}
          onSuccess={fetchTemplates}
        />
      )}

      {/* Detail Dialog */}
      <TemplateDetailDialog
        template={detailTemplate}
        onOpenChange={() => setDetailTemplate(null)}
        onSetDefault={handleSetDefault}
        isDefault={detailTemplate ? defaultTemplateId === detailTemplate.id : false}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTemplate} onOpenChange={(open) => !open && setDeleteTemplate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除模板</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除模板「{deleteTemplate?.name}」吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------- Template Form Dialog ---------- */

function TemplateFormDialog({
  open,
  onOpenChange,
  template,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: ProjectTemplate | null;
  onSuccess: () => void;
}) {
  const isEdit = !!template;
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: isEdit
      ? {
          name: template.name,
          type: template.type,
          description: template.description || "",
          roles: template.roles,
          uploadPolicy: template.uploadPolicy,
          notificationPolicy: template.notificationPolicy,
          assPolicy: template.assPolicy,
          productConfig: template.productConfig,
          deliveryChecklist: template.deliveryChecklist,
        }
      : defaultFormValues,
  });

  const { fields: roleFields } = useFieldArray({
    control: form.control,
    name: "roles",
  });

  const { fields: checklistFields, append: appendChecklist, remove: removeChecklist } = useFieldArray({
    control: form.control,
    name: "deliveryChecklist",
  });

  const onSubmit = async (values: TemplateFormValues) => {
    setSubmitting(true);
    try {
      if (isEdit && template) {
        await api.put(`/templates/${template.id}`, values);
        toast.success("模板已更新");
      } else {
        await api.post("/templates", values);
        toast.success("模板已创建");
      }
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑模板" : "新建模板"}</DialogTitle>
          <DialogDescription>配置项目模板的所有参数</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <Accordion type="multiple" defaultValue={["basic", "roles"]} className="w-full">
                {/* Basic Info */}
                <AccordionItem value="basic">
                  <AccordionTrigger>基本信息</AccordionTrigger>
                  <AccordionContent className="space-y-4 px-1">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>模板名称</FormLabel>
                          <FormControl>
                            <Input placeholder="输入模板名称" {...field} />
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
                          <FormLabel>项目类型</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="anime">番剧</SelectItem>
                              <SelectItem value="movie">电影</SelectItem>
                              <SelectItem value="collection">合集</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>描述</FormLabel>
                          <FormControl>
                            <Textarea placeholder="模板描述..." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </AccordionContent>
                </AccordionItem>

                {/* Roles */}
                <AccordionItem value="roles">
                  <AccordionTrigger>角色配置</AccordionTrigger>
                  <AccordionContent className="space-y-3 px-1">
                    {roleFields.map((field, index) => (
                      <div
                        key={field.id}
                        className="flex items-center gap-3 p-3 border rounded-lg bg-gray-50/50"
                      >
                        <FormField
                          control={form.control}
                          name={`roles.${index}.enabled`}
                          render={({ field }) => (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <span className="text-sm font-medium w-16 shrink-0">
                          {getRoleLabel(field.role as TaskRole)}
                        </span>
                        <FormField
                          control={form.control}
                          name={`roles.${index}.slotCount`}
                          render={({ field }) => (
                            <FormItem className="flex-1">
                              <FormControl>
                                <Input
                                  type="number"
                                  min={1}
                                  max={20}
                                  className="w-20"
                                  {...field}
                                  onChange={(e) => field.onChange(Number(e.target.value))}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`roles.${index}.assignmentStrategy`}
                          render={({ field }) => (
                            <FormItem className="flex-1">
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="manual">手动分配</SelectItem>
                                  <SelectItem value="open_claim">开放认领</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        {field.role === "translation" && (
                          <FormField
                            control={form.control}
                            name={`roles.${index}.maxSegmentLength`}
                            render={({ field }) => (
                              <FormItem className="w-24">
                                <FormControl>
                                  <Input
                                    type="number"
                                    placeholder="最大字数"
                                    {...field}
                                    value={field.value || ""}
                                    onChange={(e) =>
                                      field.onChange(
                                        e.target.value ? Number(e.target.value) : undefined
                                      )
                                    }
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        )}
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>

                {/* Product Config */}
                <AccordionItem value="product">
                  <AccordionTrigger>成品配置</AccordionTrigger>
                  <AccordionContent className="space-y-4 px-1">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="productConfig.resolution"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>分辨率</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="productConfig.bitrate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>码率</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="productConfig.encoder"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>编码器</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="productConfig.containerFormat"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>容器格式</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="productConfig.namingRule"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>命名规则</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </AccordionContent>
                </AccordionItem>

                {/* ASS Policy */}
                <AccordionItem value="ass">
                  <AccordionTrigger>ASS策略</AccordionTrigger>
                  <AccordionContent className="space-y-4 px-1">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="assPolicy.mergeRule"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>合并规则</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="default">默认</SelectItem>
                                <SelectItem value="keep_all">保留全部</SelectItem>
                                <SelectItem value="latest_wins">最新优先</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="assPolicy.dedupThreshold"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>去重阈值</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step={0.01}
                                min={0}
                                max={1}
                                {...field}
                                onChange={(e) => field.onChange(Number(e.target.value))}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* Delivery Checklist */}
                <AccordionItem value="checklist">
                  <AccordionTrigger>交付清单</AccordionTrigger>
                  <AccordionContent className="space-y-3 px-1">
                    {checklistFields.map((field, index) => (
                      <div key={field.id} className="flex items-center gap-2">
                        <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                        <FormField
                          control={form.control}
                          name={`deliveryChecklist.${index}.name`}
                          render={({ field }) => (
                            <FormItem className="flex-1">
                              <FormControl>
                                <Input placeholder="项目名称" {...field} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`deliveryChecklist.${index}.role`}
                          render={({ field }) => (
                            <FormItem className="w-28">
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {ALL_ROLES.filter((r) => r !== "supervisor").map((r) => (
                                    <SelectItem key={r} value={r}>
                                      {getRoleLabel(r)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`deliveryChecklist.${index}.required`}
                          render={({ field }) => (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                              </FormControl>
                              <span className="text-xs text-gray-500">必需</span>
                            </FormItem>
                          )}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500"
                          onClick={() => removeChecklist(index)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        appendChecklist({
                          id: `d${Date.now()}`,
                          name: "",
                          role: "translation",
                          required: true,
                        })
                      }
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      添加项目
                    </Button>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                  {isEdit ? "保存" : "创建"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Template Detail Dialog ---------- */

function TemplateDetailDialog({
  template,
  onOpenChange,
  onSetDefault,
  isDefault,
}: {
  template: ProjectTemplate | null;
  onOpenChange: () => void;
  onSetDefault: (id: string) => void;
  isDefault: boolean;
}) {
  if (!template) return null;

  return (
    <Dialog open={!!template} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{template.name}</DialogTitle>
            {isDefault && <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />}
          </div>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Info */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">基本信息</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between px-3 py-2 bg-gray-50 rounded">
                <span className="text-gray-500">类型</span>
                <span>{typeLabels[template.type]}</span>
              </div>
              <div className="flex justify-between px-3 py-2 bg-gray-50 rounded">
                <span className="text-gray-500">使用次数</span>
                <span>{template.useCount}</span>
              </div>
            </div>
          </div>

          <Separator />

          {/* Roles */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">角色配置</h4>
            <div className="space-y-2">
              {template.roles.map((role) => (
                <div
                  key={role.role}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded text-sm",
                    role.enabled ? "bg-gray-50" : "bg-gray-50/50 text-gray-400"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full",
                        role.enabled ? "bg-green-500" : "bg-gray-300"
                      )}
                    />
                    <span>{getRoleLabel(role.role)}</span>
                  </div>
                  {role.enabled && (
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{role.slotCount} 个名额</span>
                      <span>
                        {role.assignmentStrategy === "manual" ? "手动分配" : "开放认领"}
                      </span>
                      {role.maxSegmentLength && <span>最大{role.maxSegmentLength}字</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Product Config */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">成品配置</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between px-3 py-2 bg-gray-50 rounded">
                <span className="text-gray-500">分辨率</span>
                <span>{template.productConfig.resolution}</span>
              </div>
              <div className="flex justify-between px-3 py-2 bg-gray-50 rounded">
                <span className="text-gray-500">码率</span>
                <span>{template.productConfig.bitrate}</span>
              </div>
              <div className="flex justify-between px-3 py-2 bg-gray-50 rounded">
                <span className="text-gray-500">编码器</span>
                <span>{template.productConfig.encoder}</span>
              </div>
              <div className="flex justify-between px-3 py-2 bg-gray-50 rounded">
                <span className="text-gray-500">容器格式</span>
                <span>{template.productConfig.containerFormat}</span>
              </div>
              <div className="col-span-2 flex justify-between px-3 py-2 bg-gray-50 rounded">
                <span className="text-gray-500">命名规则</span>
                <span className="font-mono">{template.productConfig.namingRule}</span>
              </div>
            </div>
          </div>

          <Separator />

          {/* Delivery Checklist */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">交付清单</h4>
            <div className="space-y-1">
              {template.deliveryChecklist.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        item.required ? "bg-red-400" : "bg-gray-300"
                      )}
                    />
                    <span>{item.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {getRoleLabel(item.role)}
                    </Badge>
                    {item.required && (
                      <Badge variant="secondary" className="text-[10px]">
                        必需
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {!isDefault && (
            <Button variant="outline" onClick={() => onSetDefault(template.id)}>
              <Star className="w-4 h-4 mr-1.5" />
              设为默认
            </Button>
          )}
          <Button onClick={onOpenChange}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
