import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, getErrorMessage, normalizeProject, normalizeStorageBackend, normalizeUser } from "@/lib/api";
import { cn, getRoleLabel } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import type { ProjectTemplate, TaskRole, StorageBackend, User } from "@/types";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FolderKanban,
  Monitor,
  Film,
  FolderOpen,
  Loader2,
  X,
  HardDrive,
  Users,
} from "lucide-react";

const STEPS = [
  { id: 1, title: "选择模板", icon: <FolderKanban className="w-4 h-4" /> },
  { id: 2, title: "基本信息", icon: <Monitor className="w-4 h-4" /> },
  { id: 3, title: "存储配置", icon: <HardDrive className="w-4 h-4" /> },
  { id: 4, title: "成员配置", icon: <Users className="w-4 h-4" /> },
  { id: 5, title: "确认创建", icon: <Check className="w-4 h-4" /> },
];

const UNASSIGNED_SELECT_VALUE = "__unassigned__";

const projectFormSchema = z.object({
  name: z.string().min(1, "项目名称不能为空").max(100),
  qqGroupId: z.string().trim().min(1, "项目 QQ 群号不能为空").max(50, "项目 QQ 群号过长"),
  type: z.enum(["anime", "movie", "collection"]),
  season: z.number().min(1).max(99),
  episodes: z.number().min(1).max(999),
  tags: z.array(z.string()),
  templateId: z.string().optional(),
  storageBackendId: z.string().min(1, "请选择存储后端"),
  members: z.array(
    z.object({
      role: z.string(),
      userId: z.string().optional(),
    })
  ),
});

type ProjectFormValues = z.infer<typeof projectFormSchema>;

type ApiEnvelope<T> = { data: T };

function getUserDisplayName(user?: User | null) {
  return user?.nickname?.trim() || user?.username || "";
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i));
}

function toBackendProjectType(type: ProjectFormValues["type"]) {
  return type === "collection" ? "other" : type;
}

function fromBackendProjectType(type: ProjectTemplate["type"]): ProjectFormValues["type"] {
  return type === "other" || type === "ova" || type === "special" || type === "music_video"
    ? "collection"
    : type;
}

const defaultValues: ProjectFormValues = {
  name: "",
  qqGroupId: "",
  type: "anime",
  season: 1,
  episodes: 12,
  tags: [],
  templateId: undefined,
  storageBackendId: "",
  members: [],
};

export function ProjectCreatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const rawPreselectedTemplateId = (location.state as { templateId?: string })?.templateId;
  const preselectedTemplateId = isUuid(rawPreselectedTemplateId) ? rawPreselectedTemplateId : undefined;

  const [currentStep, setCurrentStep] = useState(preselectedTemplateId ? 2 : 1);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [storageBackends, setStorageBackends] = useState<StorageBackend[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [tagInput, setTagInput] = useState("");

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      ...defaultValues,
      templateId: preselectedTemplateId,
    },
  });

  // Fetch templates
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const res = await api.get<ApiEnvelope<ProjectTemplate[]>>("/templates");
        setTemplates(res.data.data);
        if (preselectedTemplateId) {
          const tmpl = res.data.data.find((t) => t.id === preselectedTemplateId);
          if (tmpl) {
            setSelectedTemplate(tmpl);
            form.setValue("type", fromBackendProjectType(tmpl.type));
          }
        }
      } catch (error) {
        toast.error("获取模板失败: " + getErrorMessage(error));
      }
    };
    fetchTemplates();
  }, [preselectedTemplateId, form]);

  // Fetch storage backends
  useEffect(() => {
    const fetchBackends = async () => {
      try {
        const res = await api.get<ApiEnvelope<unknown[]>>("/storage/backends");
        setStorageBackends(res.data.data.map((b) => normalizeStorageBackend(b as Record<string, unknown>)).filter((b) => b.isEnabled));
      } catch (error) {
        toast.error("获取存储后端失败: " + getErrorMessage(error));
      }
    };
    fetchBackends();
  }, []);

  // Fetch users for member assignment
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await api.get<ApiEnvelope<{ items: unknown[] } | unknown[]>>("/users");
        const usersData = Array.isArray(res.data.data) ? res.data.data : res.data.data.items;
        setUsers(usersData.map((user) => normalizeUser(user as Record<string, unknown>)));
      } catch {
        setUsers([]);
      }
    };
    fetchUsers();
  }, []);

  const handleSelectTemplate = (template: ProjectTemplate) => {
    setSelectedTemplate(template);
    form.setValue("templateId", template.id);
    form.setValue("type", fromBackendProjectType(template.type));

    // Initialize members from template roles
    const memberSlots = template.roles
      .filter((roleConfig) => roleConfig.enabled)
      .flatMap((roleConfig) =>
        Array.from({ length: roleConfig.slotCount }, () => ({
          role: roleConfig.role,
          userId: undefined as string | undefined,
        }))
      );
    form.setValue("members", memberSlots);
    setCurrentStep(2);
  };

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    const current = form.getValues("tags");
    if (!current.includes(tag)) {
      form.setValue("tags", [...current, tag]);
    }
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    const current = form.getValues("tags");
    form.setValue(
      "tags",
      current.filter((t) => t !== tag)
    );
  };

  const handleNext = async () => {
    if (currentStep === 2) {
      const valid = await form.trigger(["name", "qqGroupId", "type", "season", "episodes"]);
      if (!valid) return;
    }
    if (currentStep === 3) {
      const valid = await form.trigger(["storageBackendId"]);
      if (!valid) return;
    }
    setCurrentStep((s) => Math.min(s + 1, 5));
  };

  const handleBack = () => {
    setCurrentStep((s) => Math.max(s - 1, 1));
  };

  const handleFormSubmit = async (values: ProjectFormValues) => {
    if (currentStep < 5) {
      await handleNext();
      return;
    }

    setSubmitting(true);
    try {
      const payload = values.templateId
        ? {
            name: values.name,
            qq_group_id: values.qqGroupId.trim(),
            template_id: values.templateId,
            storage_backend_id: values.storageBackendId,
            season_count: values.season,
            units_per_season: values.episodes,
          }
        : {
            name: values.name,
            qq_group_id: values.qqGroupId.trim(),
            project_type: toBackendProjectType(values.type),
            storage_backend_id: values.storageBackendId,
          };

      const res = await api.post<ApiEnvelope<unknown>>(
        values.templateId ? "/projects/from-template" : "/projects",
        payload
      );
      const project = normalizeProject(res.data.data as Record<string, unknown>);

      await Promise.all(
        values.members
          .filter((m) => m.userId)
          .map((member) =>
            api.post(`/projects/${project.id}/members`, {
              user_id: member.userId,
              role: member.role,
            })
          )
      );

      toast.success("项目创建成功");
      navigate(`/projects/${project.id}`);
    } catch (error) {
      toast.error("创建失败: " + getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return !!selectedTemplate;
      case 2:
        return !!form.watch("name") && !!form.watch("qqGroupId")?.trim();
      case 3:
        return !!form.watch("storageBackendId");
      case 4:
        return true;
      case 5:
        return true;
      default:
        return false;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-display text-gray-800">新建项目</h1>
          <p className="text-sm text-gray-500 mt-1">按照步骤创建新项目</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-between">
        {STEPS.map((step, i) => (
          <div key={step.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                  currentStep > step.id
                    ? "bg-primary-500 text-white"
                    : currentStep === step.id
                      ? "bg-primary-100 text-primary-700 border-2 border-primary-500"
                      : "bg-gray-100 text-gray-400"
                )}
              >
                {currentStep > step.id ? <Check className="w-4 h-4" /> : step.icon}
              </div>
              <span
                className={cn(
                  "text-xs mt-1.5 font-medium",
                  currentStep >= step.id ? "text-gray-700" : "text-gray-400"
                )}
              >
                {step.title}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-0.5 mx-2 mb-5",
                  currentStep > step.id ? "bg-primary-500" : "bg-gray-200"
                )}
              />
            )}
          </div>
        ))}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
          {/* Step 1: Select Template */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <h2 className="text-h2 text-gray-800">选择项目模板</h2>
              <p className="text-sm text-gray-500">选择一个模板作为项目的基础配置</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {templates.map((template) => (
                  <Card
                    key={template.id}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md",
                      selectedTemplate?.id === template.id
                        ? "ring-2 ring-primary-500 border-primary-500"
                        : "border-gray-200"
                    )}
                    onClick={() => handleSelectTemplate(template)}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {template.type === "anime" && <Monitor className="h-4 w-4 shrink-0 text-gray-400" />}
                          {template.type === "movie" && <Film className="h-4 w-4 shrink-0 text-gray-400" />}
                          {(template.type === "collection" || template.type === "other") && <FolderOpen className="h-4 w-4 shrink-0 text-gray-400" />}
                          <span className="min-w-0 break-words font-medium text-gray-800 [overflow-wrap:anywhere]">{template.name}</span>
                        </div>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {template.type === "anime"
                            ? "番剧"
                            : template.type === "movie"
                              ? "电影"
                              : "合集"}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 line-clamp-2">
                        {template.description}
                      </p>
                      <div className="flex items-center gap-1 flex-wrap">
                        {template.roles
                          .filter((r) => r.enabled)
                          .map((r) => (
                            <Badge
                              key={r.role}
                              variant="secondary"
                              className="text-[10px] font-normal"
                            >
                              {getRoleLabel(r.role)}
                            </Badge>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSelectedTemplate(null);
                  form.setValue("templateId", undefined);
                  form.setValue("members", []);
                  setCurrentStep(2);
                }}
              >
                不使用模板，直接创建
              </Button>
            </div>
          )}

          {/* Step 2: Basic Info */}
          {currentStep === 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h2">项目基本信息</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>项目名称 *</FormLabel>
                      <FormControl>
                        <Input placeholder="输入项目名称" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="qqGroupId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>项目 QQ 群号 *</FormLabel>
                      <FormControl>
                        <Input placeholder="填写该项目独立 QQ 群号" {...field} />
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
                      <FormLabel>项目类型 *</FormLabel>
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

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="season"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>季数</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            max={99}
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="episodes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>集数</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            max={999}
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormItem>
                  <FormLabel>标签</FormLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="添加标签，按回车确认"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={handleAddTag}>
                      添加
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {form.watch("tags").map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-xs cursor-pointer hover:bg-red-50"
                        onClick={() => handleRemoveTag(tag)}
                      >
                        {tag}
                        <X className="w-3 h-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                </FormItem>
              </CardContent>
            </Card>
          )}

          {/* Step 3: Storage Backend */}
          {currentStep === 3 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h2">选择存储后端</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="storageBackendId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>存储后端 *</FormLabel>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {storageBackends.map((backend) => (
                          <Card
                            key={backend.id}
                            className={cn(
                              "cursor-pointer transition-all",
                              field.value === backend.id
                                ? "ring-2 ring-primary-500 border-primary-500"
                                : "border-gray-200 hover:border-gray-300"
                            )}
                            onClick={() => field.onChange(backend.id)}
                          >
                            <CardContent className="p-4 space-y-2">
                              <div className="flex items-center gap-2">
                                <HardDrive className="w-4 h-4 text-gray-400" />
                                <span className="font-medium">{backend.name}</span>
                                {backend.isDefault && (
                                  <Badge variant="secondary" className="text-[10px]">默认</Badge>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 space-y-1">
                                <p>类型: {backend.type.toUpperCase()}</p>
                                <p>端点: {backend.endpoint}</p>
                                <p>
                                  容量: {(backend.usedBytes / 1024 / 1024 / 1024).toFixed(1)} GB /{" "}
                                  {(backend.quotaBytes / 1024 / 1024 / 1024).toFixed(1)} GB
                                </p>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          )}

          {/* Step 4: Member Configuration */}
          {currentStep === 4 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h2">配置成员</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-gray-500">为每个角色分配成员（可选，可留空后续再分配）</p>
                <div className="space-y-3">
                  {selectedTemplate?.roles
                    .filter((r) => r.enabled)
                    .map((roleConfig) => {
                      const memberSlots = form
                        .watch("members")
                        .map((member, index) => ({ member, index }))
                        .filter(({ member }) => member.role === roleConfig.role);
                      return (
                        <div key={roleConfig.role} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {getRoleLabel(roleConfig.role)}
                              </span>
                              <Badge variant="outline" className="text-[10px]">
                                {roleConfig.slotCount} 个名额
                              </Badge>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {Array.from({ length: roleConfig.slotCount }, (_, i) => {
                              const slot = memberSlots[i];
                              const member = slot?.member;

                              return (
                                <div key={`${roleConfig.role}-${i}`} className="flex items-center gap-2">
                                  <Select
                                    value={member?.userId || UNASSIGNED_SELECT_VALUE}
                                    onValueChange={(val) => {
                                      const members = form.getValues("members");
                                      const nextMembers = members.map((item) => ({ ...item }));
                                      const nextUserId =
                                        val === UNASSIGNED_SELECT_VALUE ? undefined : val;

                                      if (slot) {
                                        nextMembers[slot.index] = {
                                          ...nextMembers[slot.index],
                                          userId: nextUserId,
                                        };
                                      } else {
                                        nextMembers.push({
                                          role: roleConfig.role,
                                          userId: nextUserId,
                                        });
                                      }

                                      form.setValue("members", nextMembers, {
                                        shouldDirty: true,
                                        shouldTouch: true,
                                        shouldValidate: true,
                                      });
                                    }}
                                  >
                                    <SelectTrigger className="flex-1">
                                      <SelectValue placeholder={`选择${getRoleLabel(roleConfig.role)}成员`} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={UNASSIGNED_SELECT_VALUE}>暂不分配</SelectItem>
                                      {users.map((user) => (
                                        <SelectItem key={user.id} value={user.id}>
                                          {getUserDisplayName(user)}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 5: Review */}
          {currentStep === 5 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h2">确认创建</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <ReviewSection title="基本信息">
                    <ReviewItem label="项目名称" value={form.watch("name")} />
                    <ReviewItem label="项目 QQ 群号" value={form.watch("qqGroupId")} />
                    <ReviewItem
                      label="项目类型"
                      value={
                        form.watch("type") === "anime"
                          ? "番剧"
                          : form.watch("type") === "movie"
                            ? "电影"
                            : "合集"
                      }
                    />
                    <ReviewItem label="季数" value={`第${form.watch("season")}季`} />
                    <ReviewItem label="集数" value={`${form.watch("episodes")}集`} />
                    <ReviewItem
                      label="标签"
                      value={
                        form.watch("tags").length > 0
                          ? form.watch("tags").join(", ")
                          : "无"
                      }
                    />
                  </ReviewSection>

                  <Separator />

                  <ReviewSection title="模板">
                    <ReviewItem
                      label="使用模板"
                      value={selectedTemplate?.name || "不使用模板"}
                    />
                  </ReviewSection>

                  <Separator />

                  <ReviewSection title="存储后端">
                    <ReviewItem
                      label="存储后端"
                      value={
                        storageBackends.find(
                          (b) => b.id === form.watch("storageBackendId")
                        )?.name || ""
                      }
                    />
                  </ReviewSection>

                  <Separator />

                  <ReviewSection title="成员">
                    {form
                      .watch("members")
                      .filter((m) => m.userId)
                      .map((m, i) => (
                        <ReviewItem
                          key={i}
                          label={getRoleLabel(m.role as TaskRole)}
                          value={
                            getUserDisplayName(users.find((u) => u.id === m.userId)) || m.userId || ""
                          }
                        />
                      ))}
                    {form.watch("members").filter((m) => m.userId).length === 0 && (
                      <p className="text-sm text-gray-400">暂未分配成员</p>
                    )}
                  </ReviewSection>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 1}
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              上一步
            </Button>

            {currentStep < 5 ? (
              <Button type="button" onClick={handleNext} disabled={!canProceed()}>
                下一步
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            ) : (
              <Button
                type="button"
                disabled={submitting}
                onClick={form.handleSubmit(handleFormSubmit)}
              >
                {submitting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                创建项目
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}

function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm px-3 py-2 bg-gray-50 rounded">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-800">{value}</span>
    </div>
  );
}
