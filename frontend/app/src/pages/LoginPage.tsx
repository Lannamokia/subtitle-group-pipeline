import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { mockCurrentUser } from "@/lib/mockData";
import type { TaskRole } from "@/types";
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  MessageCircle,
  User,
  Lock,
  QrCode,
} from "lucide-react";

type AuthView = "login" | "register" | "verification";

const ROLE_TAGS: { value: TaskRole; label: string }[] = [
  { value: "source", label: "片源" },
  { value: "timing", label: "时轴" },
  { value: "translation", label: "翻译" },
  { value: "post_production", label: "后期" },
  { value: "encoding", label: "压制" },
  { value: "release", label: "发布" },
];

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [view, setView] = useState<AuthView>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<TaskRole[]>([]);

  // Login form
  const [loginForm, setLoginForm] = useState({ username: "", password: "", remember: false });

  // Register form
  const [registerForm, setRegisterForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    qq: "",
  });

  // Verification
  const [verificationCode] = useState("A3B7K9P2");
  const [qqGroup] = useState("123456789");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Mock: always succeed with demo user
    login(mockCurrentUser);
    navigate("/dashboard");
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    // Mock: go to verification
    setView("verification");
  };

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(`/verify ${verificationCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleRole = (role: TaskRole) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel - Brand */}
      <div className="hidden lg:flex lg:w-[45%] bg-primary-50 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-100/50 to-transparent" />
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center">
              <span className="text-white font-bold text-lg">S</span>
            </div>
            <span className="text-xl font-semibold text-gray-800">SubtitleSync</span>
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
          SubtitleSync v1.0.0
        </div>
      </div>

      {/* Right panel - Form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center">
              <span className="text-white font-bold text-lg">S</span>
            </div>
            <span className="text-xl font-semibold text-gray-800">SubtitleSync</span>
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
                    <span className="text-lg font-medium text-gray-800">{qqGroup}</span>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-gray-500">验证指令</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 bg-white border rounded-md px-3 py-2 text-sm font-mono text-gray-800">
                      /verify {verificationCode}
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
                  加入验证QQ群 {qqGroup}
                </p>
                <p className="flex items-start gap-2">
                  <span className="shrink-0">2.</span>
                  在群中发送验证指令 /verify {verificationCode}
                </p>
                <p className="flex items-start gap-2">
                  <span className="shrink-0">3.</span>
                  等待系统自动验证通过
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setView("login")}
                >
                  返回登录
                </Button>
                <Button className="flex-1" onClick={() => { login(mockCurrentUser); navigate("/dashboard"); }}>
                  模拟验证通过
                </Button>
              </div>
            </div>
          ) : (
            /* Login/Register Tabs */
            <Tabs value={view} onValueChange={(v) => setView(v as AuthView)} className="space-y-6">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">注册</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-4">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-username">用户名</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        id="login-username"
                        placeholder="输入用户名"
                        className="pl-9"
                        value={loginForm.username}
                        onChange={(e) => setLoginForm((p) => ({ ...p, username: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="login-password">密码</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="输入密码"
                        className="pl-9 pr-9"
                        value={loginForm.password}
                        onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="remember"
                        checked={loginForm.remember}
                        onCheckedChange={(checked) =>
                          setLoginForm((p) => ({ ...p, remember: checked as boolean }))
                        }
                      />
                      <Label htmlFor="remember" className="text-sm text-gray-500 cursor-pointer">
                        记住我
                      </Label>
                    </div>
                  </div>

                  <Button type="submit" className="w-full">
                    登录
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register" className="space-y-4">
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-username">用户名</Label>
                    <Input
                      id="reg-username"
                      placeholder="设置用户名"
                      value={registerForm.username}
                      onChange={(e) => setRegisterForm((p) => ({ ...p, username: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-password">密码</Label>
                    <Input
                      id="reg-password"
                      type="password"
                      placeholder="设置密码"
                      value={registerForm.password}
                      onChange={(e) => setRegisterForm((p) => ({ ...p, password: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-confirm">确认密码</Label>
                    <Input
                      id="reg-confirm"
                      type="password"
                      placeholder="再次输入密码"
                      value={registerForm.confirmPassword}
                      onChange={(e) => setRegisterForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-qq">QQ号</Label>
                    <Input
                      id="reg-qq"
                      placeholder="用于群验证"
                      value={registerForm.qq}
                      onChange={(e) => setRegisterForm((p) => ({ ...p, qq: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>意向岗位（可多选）</Label>
                    <div className="flex flex-wrap gap-2">
                      {ROLE_TAGS.map((role) => (
                        <Badge
                          key={role.value}
                          variant={selectedRoles.includes(role.value) ? "default" : "outline"}
                          className="cursor-pointer px-3 py-1.5"
                          onClick={() => toggleRole(role.value)}
                        >
                          {role.label}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <Button type="submit" className="w-full">
                    注册并验证
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
