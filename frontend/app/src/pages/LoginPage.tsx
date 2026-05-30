import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuthStore } from "@/stores/authStore";
import { getBrandLogoUrl, useBrandingStore } from "@/stores/brandingStore";
import { authApi, getErrorMessage, roleTagApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RoleTagDefinition } from "@/types";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  MessageCircle,
  User,
  Lock,
  QrCode,
  Loader2,
} from "lucide-react";

type AuthView = "login" | "register" | "verification";

// Login schema
const loginSchema = z.object({
  username: z.string().min(1, "用户名不能为空"),
  password: z.string().min(1, "密码不能为空"),
});

type LoginFormData = z.infer<typeof loginSchema>;

// Register schema
const registerSchema = z
  .object({
    username: z
      .string()
      .min(2, "用户名至少2个字符")
      .max(20, "用户名最多20个字符")
      .regex(/^[a-zA-Z0-9_一-龥]+$/, "用户名只能包含字母、数字、下划线和中文"),
    password: z.string().min(8, "密码至少8个字符").max(50, "密码最多50个字符"),
    confirmPassword: z.string(),
    qq: z
      .string()
      .min(5, "QQ号至少5位")
      .max(11, "QQ号最多11位")
      .regex(/^\d+$/, "QQ号只能包含数字"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

const resetRequestSchema = z.object({
  username: z.string().min(1, "用户名不能为空"),
});

const resetConfirmSchema = z
  .object({
    code: z.string().min(1, "验证码不能为空").max(16, "验证码过长"),
    password: z.string().min(8, "密码至少8个字符").max(50, "密码最多50个字符"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  });

type ResetRequestFormData = z.infer<typeof resetRequestSchema>;
type ResetConfirmFormData = z.infer<typeof resetConfirmSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const branding = useBrandingStore((state) => state.branding);
  const logoUrl = getBrandLogoUrl(branding);
  const [view, setView] = useState<AuthView>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [availableTags, setAvailableTags] = useState<RoleTagDefinition[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetStep, setResetStep] = useState<"request" | "confirm">("request");
  const [resetUsername, setResetUsername] = useState("");
  const [resetInfo, setResetInfo] = useState<{ commandFormat?: string; emailSent?: boolean; qqSent?: boolean } | null>(null);
  const [verificationInfo, setVerificationInfo] = useState<{
    qqGroup: string;
    command: string;
  } | null>(null);

  // Login form
  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  // Register form
  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: "", password: "", confirmPassword: "", qq: "" },
  });

  const resetRequestForm = useForm<ResetRequestFormData>({
    resolver: zodResolver(resetRequestSchema),
    defaultValues: { username: "" },
  });

  const resetConfirmForm = useForm<ResetConfirmFormData>({
    resolver: zodResolver(resetConfirmSchema),
    defaultValues: { code: "", password: "", confirmPassword: "" },
  });

  useEffect(() => {
    roleTagApi.getAllTags()
      .then(setAvailableTags)
      .catch(() => setAvailableTags([]));
  }, []);

  const handleLogin = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      const result = await authApi.login(data);
      if (result.status === "pending_verification" || result.requiresVerification) {
        setVerificationInfo(
          result.verification ?? {
            qqGroup: result.qqGroup || "",
            command: result.verifyCommand || "",
          }
        );
        setView("verification");
        toast.info("账号待验证，请先完成QQ群验证");
        return;
      }
      if (!result.user || !result.token) {
        toast.error("登录响应缺少会话信息");
        return;
      }
      login({ ...result.user, token: result.token, refreshToken: result.refreshToken });
      toast.success("登录成功");
      navigate("/dashboard");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (data: RegisterFormData) => {
    setIsLoading(true);
    try {
      const result = await authApi.register({
        username: data.username,
        password: data.password,
        confirmPassword: data.confirmPassword,
        qq: data.qq,
        tags: selectedTagIds,
      });

      if (result.status === "pending_verification" && result.verification) {
        setVerificationInfo(result.verification);
        setView("verification");
        toast.info("注册成功，请完成QQ群验证");
      } else if (result.user && result.token) {
        login({ ...result.user, token: result.token, refreshToken: result.refreshToken });
        toast.success("注册成功");
        navigate("/dashboard");
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCommand = () => {
    if (verificationInfo) {
      navigator.clipboard.writeText(verificationInfo.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("已复制到剪贴板");
    }
  };

  const openResetDialog = () => {
    const username = loginForm.getValues("username");
    resetRequestForm.reset({ username });
    resetConfirmForm.reset({ code: "", password: "", confirmPassword: "" });
    setResetUsername(username);
    setResetInfo(null);
    setResetStep("request");
    setResetDialogOpen(true);
  };

  const handleRequestReset = async (data: ResetRequestFormData) => {
    setIsLoading(true);
    try {
      const result = await authApi.requestPasswordReset({ username: data.username });
      setResetUsername(data.username);
      setResetInfo({
        commandFormat: result.resetCommandFormat ?? result.resetCommand,
        emailSent: result.emailSent,
        qqSent: result.qqSent,
      });
      setResetStep("confirm");
      toast.success(result.message || "验证码已发送");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmReset = async (data: ResetConfirmFormData) => {
    setIsLoading(true);
    try {
      await authApi.confirmPasswordReset({
        username: resetUsername,
        code: data.code,
        password: data.password,
      });
      toast.success("密码已重置，请使用新密码登录");
      setResetDialogOpen(false);
      setResetStep("request");
      loginForm.setValue("username", resetUsername);
      loginForm.setValue("password", "");
      setView("login");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel - Brand */}
      <div className="hidden lg:flex lg:w-[45%] bg-primary-50 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-100/50 to-transparent" />
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt={branding.appName} className="w-10 h-10 rounded-xl object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center">
                <span className="text-white font-bold text-lg">{branding.appName.charAt(0)}</span>
              </div>
            )}
            <span className="text-xl font-semibold text-gray-800">{branding.appName}</span>
          </div>
        </div>
        <div className="relative z-10">
          <h1 className="text-3xl font-semibold text-gray-800 mb-3">
            高效协作，精准交付
          </h1>
          <p className="text-gray-500 text-base leading-relaxed max-w-sm">
            专为字幕组打造的一站式协作平台，覆盖片源、时轴、翻译、后期、压制全流程，让每一份作品都臻于完美。
          </p>
        </div>
        <div className="relative z-10 text-xs text-gray-400">
          {branding.appName} v1.0.0
        </div>
      </div>

      {/* Right panel - Form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            {logoUrl ? (
              <img src={logoUrl} alt={branding.appName} className="w-10 h-10 rounded-xl object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center">
                <span className="text-white font-bold text-lg">{branding.appName.charAt(0)}</span>
              </div>
            )}
            <span className="text-xl font-semibold text-gray-800">{branding.appName}</span>
          </div>

          {view === "verification" ? (
            /* Verification State */
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-yellow-50 flex items-center justify-center mx-auto mb-4">
                  <QrCode className="w-8 h-8 text-yellow-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-800">等待验证</h2>
                <p className="text-sm text-gray-500 mt-2">
                  你的账号已创建，请完成QQ群验证以激活账号
                </p>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 space-y-4">
                <div>
                  <Label className="text-xs text-gray-500">验证QQ群</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <MessageCircle className="w-4 h-4 text-primary-500" />
                    <span className="text-lg font-medium text-gray-800">
                      {verificationInfo?.qqGroup || "--"}
                    </span>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-gray-500">验证指令</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 bg-white border rounded-md px-3 py-2 text-sm font-mono text-gray-800">
                      {verificationInfo?.command || "--"}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={handleCopyCommand}
                    >
                      {copied ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="text-sm text-gray-500 space-y-2">
                <p className="flex items-start gap-2">
                  <span className="shrink-0">1.</span>
                  加入验证QQ群 {verificationInfo?.qqGroup || "--"}
                </p>
                <p className="flex items-start gap-2">
                  <span className="shrink-0">2.</span>
                  在群中发送验证指令 {verificationInfo?.command || "--"}
                </p>
                <p className="flex items-start gap-2">
                  <span className="shrink-0">3.</span>
                  等待系统自动验证通过
                </p>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setView("login");
                  setVerificationInfo(null);
                }}
              >
                返回登录
              </Button>
            </div>
          ) : (
            /* Login/Register Tabs */
            <Tabs value={view} onValueChange={(v) => setView(v as AuthView)} className="space-y-6">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">注册</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-4">
                <Form {...loginForm}>
                  <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                    <FormField
                      control={loginForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>用户名</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                              <Input placeholder="输入用户名" className="pl-9" {...field} />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>密码</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                              <Input
                                type={showPassword ? "text" : "password"}
                                placeholder="输入密码"
                                className="pl-9 pr-9"
                                {...field}
                              />
                              <button
                                type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                onClick={() => setShowPassword(!showPassword)}
                              >
                                {showPassword ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          登录中...
                        </>
                      ) : (
                        "登录"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      className="w-full px-0 text-sm"
                      onClick={openResetDialog}
                    >
                      忘记密码？
                    </Button>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="register" className="space-y-4">
                <Form {...registerForm}>
                  <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-4">
                    <FormField
                      control={registerForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>用户名</FormLabel>
                          <FormControl>
                            <Input placeholder="设置用户名" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={registerForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>密码</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type={showPassword ? "text" : "password"}
                                placeholder="设置密码"
                                className="pr-9"
                                {...field}
                              />
                              <button
                                type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                onClick={() => setShowPassword(!showPassword)}
                              >
                                {showPassword ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={registerForm.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>确认密码</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type={showConfirmPassword ? "text" : "password"}
                                placeholder="再次输入密码"
                                className="pr-9"
                                {...field}
                              />
                              <button
                                type="button"
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              >
                                {showConfirmPassword ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={registerForm.control}
                      name="qq"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>QQ号</FormLabel>
                          <FormControl>
                            <Input placeholder="用于群验证" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {availableTags.length > 0 ? (
                      <div className="space-y-2">
                        <Label>意向岗位（可多选）</Label>
                        <div className="flex flex-wrap gap-2">
                          {availableTags.map((tag) => (
                            <Badge
                              key={tag.id}
                              variant={selectedTagIds.includes(tag.id) ? "default" : "outline"}
                              className="cursor-pointer px-3 py-1.5 select-none"
                              onClick={() => toggleTag(tag.id)}
                            >
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          注册中...
                        </>
                      ) : (
                        "注册并验证"
                      )}
                    </Button>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
            <DialogDescription>
              通过邮件验证码，或用绑定 QQ 向机器人发送重置指令验证身份。
            </DialogDescription>
          </DialogHeader>

          {resetStep === "request" ? (
            <Form {...resetRequestForm}>
              <form onSubmit={resetRequestForm.handleSubmit(handleRequestReset)} className="space-y-4">
                <FormField
                  control={resetRequestForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>用户名</FormLabel>
                      <FormControl>
                        <Input placeholder="输入需要重置密码的用户名" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  获取验证码
                </Button>
              </form>
            </Form>
          ) : (
            <Form {...resetConfirmForm}>
              <form onSubmit={resetConfirmForm.handleSubmit(handleConfirmReset)} className="space-y-4">
                <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-600">
                  <p>如果账号存在，验证码会发送至账号绑定的邮箱或 QQ 私聊。</p>
                  {resetInfo?.commandFormat && (
                    <p className="mt-2">
                      QQ 机器人指令：
                      <code className="ml-1 rounded bg-white px-1.5 py-0.5 text-primary-700">
                        {resetInfo.commandFormat}
                      </code>
                    </p>
                  )}
                  <p className="mt-2 text-xs text-gray-500">验证码 15 分钟内有效。</p>
                </div>
                <FormField
                  control={resetConfirmForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>验证码</FormLabel>
                      <FormControl>
                        <Input placeholder="输入 8 位验证码" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={resetConfirmForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>新密码</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="设置新密码" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={resetConfirmForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>确认新密码</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="再次输入新密码" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setResetStep("request")}
                  >
                    重新发送
                  </Button>
                  <Button type="submit" className="flex-1" disabled={isLoading}>
                    {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    重置密码
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
