import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Activity, Check, Copy, KeyRound, Loader2, Pencil, Plus, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { captchaApi, getErrorMessage } from "@/lib/api";
import type { CaptchaPolicyConfig, CaptchaPolicyLevel, CaptchaProviderProfile, CaptchaProviderType } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const LEVELS: Array<{ value: CaptchaPolicyLevel; label: string }> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

const TYPE_LABELS: Record<CaptchaProviderType, string> = {
  custom: "自研验证码",
  turnstile: "Cloudflare Turnstile",
  recaptcha_v2_invisible: "Google reCAPTCHA v2 Invisible",
};

type EditorState = {
  id?: string;
  name: string;
  type: CaptchaProviderType;
  baseUrl: string;
  siteId: string;
  siteKey: string;
  secret: string;
  hostnames: string;
  action: string;
  replaceCredentials: boolean;
};

const EMPTY_EDITOR: EditorState = {
  name: "",
  type: "custom",
  baseUrl: "",
  siteId: "",
  siteKey: "",
  secret: "",
  hostnames: "",
  action: "login",
  replaceCredentials: true,
};

export function CaptchaSettingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const restricted = user?.restrictedRecovery === true;
  const [providers, setProviders] = useState<CaptchaProviderProfile[]>([]);
  const [policy, setPolicy] = useState<CaptchaPolicyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [providerResult, policyResult] = await Promise.all([captchaApi.listProviders(), captchaApi.getPolicy()]);
      setProviders(providerResult);
      setPolicy(policyResult);
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function configFromEditor(value: EditorState) {
    if (value.type === "custom") return { baseUrl: value.baseUrl.trim(), siteId: value.siteId.trim(), secret: value.secret };
    const common = {
      siteKey: value.siteKey.trim(),
      secretKey: value.secret,
      allowedHostnames: value.hostnames.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
    };
    return value.type === "turnstile" ? { ...common, action: value.action.trim() || "login" } : common;
  }

  async function saveProvider() {
    if (!editor) return;
    setWorking("save");
    try {
      const result = editor.id
        ? await captchaApi.updateProvider(editor.id, {
            name: editor.name,
            ...(editor.replaceCredentials ? { config: configFromEditor(editor) } : {}),
          })
        : await captchaApi.createProvider({ name: editor.name, type: editor.type, config: configFromEditor(editor) });
      if (result.recoveryKey) setRecoveryKey(result.recoveryKey);
      setEditor(null);
      await load();
      toast.success(editor.id ? "Provider 已更新" : "Provider 已创建");
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setWorking(""); }
  }

  async function testProvider(id: string) {
    setWorking(`test:${id}`);
    try {
      const result = await captchaApi.testProvider(id);
      if (result.status === "healthy") toast.success("健康检查通过");
      else toast.error(`健康检查失败：${result.errorCode || result.status}`);
      await load();
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setWorking(""); }
  }

  async function activate(id: string) {
    setWorking(`activate:${id}`);
    try {
      const result = await captchaApi.activateProvider(id);
      if (result.recoverySessionTerminated) {
        logout();
        navigate("/login", { replace: true });
        return;
      }
      await load();
      window.dispatchEvent(new Event("captcha-config-changed"));
      toast.success("Provider 已激活");
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setWorking(""); }
  }

  async function rotate(id: string) {
    setWorking(`rotate:${id}`);
    try {
      const result = await captchaApi.rotateRecoveryKey(id);
      setRecoveryKey(result.recoveryKey);
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setWorking(""); }
  }

  async function updatePolicy(data: { enabled?: boolean; level?: CaptchaPolicyLevel }) {
    setWorking("policy");
    try {
      const result = await captchaApi.updatePolicy(data);
      if (result.recoverySessionTerminated) {
        logout();
        navigate("/login", { replace: true });
        return;
      }
      setPolicy(result);
      window.dispatchEvent(new Event("captcha-config-changed"));
      toast.success("登录验证策略已更新");
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setWorking(""); }
  }

  function edit(profile: CaptchaProviderProfile) {
    setEditor({
      ...EMPTY_EDITOR,
      id: profile.id,
      name: profile.name,
      type: profile.type,
      baseUrl: profile.config.baseUrl || "",
      siteId: profile.config.siteId || "",
      siteKey: profile.config.siteKey || "",
      hostnames: profile.config.allowedHostnames?.join("\n") || "",
      action: profile.config.action || "login",
      replaceCredentials: false,
    });
  }

  if (loading) return <div className="flex min-h-48 items-center justify-center text-gray-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />加载登录验证配置</div>;

  return (
    <div className="space-y-6">
      {restricted && (
        <Alert className="border-amber-400 bg-amber-50 text-amber-950">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>受限恢复会话</AlertTitle>
          <AlertDescription>只能检查、切换可用 Provider，或关闭登录验证。操作完成后会话立即终止。</AlertDescription>
        </Alert>
      )}

      <section className="space-y-4 border-b border-gray-200 pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800"><ShieldCheck className="h-5 w-5 text-primary-600" />登录验证策略</h2>
            <p className="mt-1 text-sm text-gray-500">配置版本 {policy?.configVersion ?? 1}</p>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="captcha-enabled">启用验证</Label>
            <Switch id="captcha-enabled" checked={policy?.enabled || false} disabled={working === "policy" || (restricted && !policy?.enabled)} onCheckedChange={(enabled) => void updatePolicy({ enabled })} />
          </div>
        </div>
        {!restricted && (
          <div className="space-y-2">
            <Label>自研验证强度</Label>
            <div className="grid w-full max-w-sm grid-cols-3 rounded-md border border-gray-200 p-1">
              {LEVELS.map((level) => (
                <button key={level.value} type="button" className={`h-8 rounded-sm text-sm ${policy?.level === level.value ? "bg-gray-800 text-white" : "text-gray-600 hover:bg-gray-100"}`} disabled={working === "policy"} onClick={() => void updatePolicy({ level: level.value })}>{level.label}</button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-base font-semibold text-gray-800">Provider 配置</h2><p className="mt-1 text-sm text-gray-500">{providers.length} 个配置档案</p></div>
          {!restricted && <Button onClick={() => setEditor({ ...EMPTY_EDITOR })}><Plus className="h-4 w-4" />新建 Provider</Button>}
        </div>

        <div className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
          {providers.length === 0 && <div className="py-14 text-center text-sm text-gray-500">暂无 Provider</div>}
          {providers.map((profile) => (
            <div key={profile.id} className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm text-gray-800">{profile.name}</strong>
                  <Badge variant="outline">{TYPE_LABELS[profile.type]}</Badge>
                  {profile.isActive && <Badge className="bg-emerald-600">当前</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><Activity className="h-3.5 w-3.5" />{profile.health.status}</span>
                  {profile.config.baseUrl && <span className="truncate">{profile.config.baseUrl}</span>}
                  {profile.config.allowedHostnames?.length ? <span>{profile.config.allowedHostnames.join(", ")}</span> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={working === `test:${profile.id}`} onClick={() => void testProvider(profile.id)}>{working === `test:${profile.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}测试</Button>
                {!profile.isActive && <Button size="sm" variant="outline" disabled={working === `activate:${profile.id}`} onClick={() => void activate(profile.id)}><Check className="h-4 w-4" />激活</Button>}
                {!restricted && <Button size="sm" variant="ghost" onClick={() => edit(profile)}><Pencil className="h-4 w-4" />编辑</Button>}
                {!restricted && <Button size="sm" variant="ghost" disabled={working === `rotate:${profile.id}`} onClick={() => void rotate(profile.id)}><KeyRound className="h-4 w-4" />轮换</Button>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Dialog open={Boolean(editor)} onOpenChange={(open) => { if (!open) setEditor(null); }}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editor?.id ? "编辑 Provider" : "新建 Provider"}</DialogTitle></DialogHeader>
          {editor && (
            <div className="space-y-4">
              <div className="space-y-1.5"><Label>名称</Label><Input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></div>
              {!editor.id && <div className="space-y-1.5"><Label>类型</Label><select className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm" value={editor.type} onChange={(event) => setEditor({ ...editor, type: event.target.value as CaptchaProviderType })}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>}
              {editor.id && <label className="flex items-center gap-2 text-sm"><Switch checked={editor.replaceCredentials} onCheckedChange={(replaceCredentials) => setEditor({ ...editor, replaceCredentials })} />替换接入凭据</label>}
              {editor.replaceCredentials && editor.type === "custom" && <>
                <div className="space-y-1.5"><Label>服务地址</Label><Input placeholder="https://captcha.example.com" value={editor.baseUrl} onChange={(event) => setEditor({ ...editor, baseUrl: event.target.value })} /></div>
                <div className="space-y-1.5"><Label>Site ID</Label><Input value={editor.siteId} onChange={(event) => setEditor({ ...editor, siteId: event.target.value })} /></div>
                <div className="space-y-1.5"><Label>Site Secret</Label><Input type="password" value={editor.secret} onChange={(event) => setEditor({ ...editor, secret: event.target.value })} /></div>
              </>}
              {editor.replaceCredentials && editor.type !== "custom" && <>
                <div className="space-y-1.5"><Label>Site Key</Label><Input value={editor.siteKey} onChange={(event) => setEditor({ ...editor, siteKey: event.target.value })} /></div>
                <div className="space-y-1.5"><Label>Secret Key</Label><Input type="password" value={editor.secret} onChange={(event) => setEditor({ ...editor, secret: event.target.value })} /></div>
                <div className="space-y-1.5"><Label>允许的 Hostname</Label><textarea className="min-h-24 w-full rounded-md border border-gray-200 p-3 text-sm" value={editor.hostnames} onChange={(event) => setEditor({ ...editor, hostnames: event.target.value })} /></div>
                {editor.type === "turnstile" && <div className="space-y-1.5"><Label>Action</Label><Input value={editor.action} onChange={(event) => setEditor({ ...editor, action: event.target.value })} /></div>}
              </>}
              <Button className="w-full" disabled={working === "save" || !editor.name.trim() || (editor.replaceCredentials && !editor.secret)} onClick={() => void saveProvider()}>{working === "save" && <Loader2 className="h-4 w-4 animate-spin" />}保存</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(recoveryKey)} onOpenChange={(open) => { if (!open) { setRecoveryKey(""); setCopied(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>备用豁免密钥</DialogTitle></DialogHeader>
          <Alert className="border-amber-300 bg-amber-50 text-amber-950"><KeyRound className="h-4 w-4" /><AlertTitle>仅显示一次</AlertTitle><AlertDescription>旧密钥已立即失效。</AlertDescription></Alert>
          <div className="flex items-stretch gap-2"><code className="min-w-0 flex-1 break-all rounded-md bg-gray-900 p-3 text-xs text-emerald-200">{recoveryKey}</code><Button variant="outline" size="icon" title="复制" onClick={() => { void navigator.clipboard.writeText(recoveryKey); setCopied(true); }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button></div>
          <Button onClick={() => { setRecoveryKey(""); setCopied(false); }}>完成</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
