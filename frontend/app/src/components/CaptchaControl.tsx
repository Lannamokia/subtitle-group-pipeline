import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { captchaApi, getErrorMessage } from "@/lib/api";
import type { CaptchaPresentation, LoginResponse } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: Record<string, unknown>): string;
      execute(widgetId: string): void;
      reset(widgetId: string): void;
    };
    grecaptcha?: {
      ready(callback: () => void): void;
      render(container: HTMLElement, options: Record<string, unknown>): number;
      execute(widgetId: number): Promise<string> | void;
      reset(widgetId: number): void;
    };
  }
}

const scriptPromises = new Map<string, Promise<void>>();

function loadScript(id: string, src: string, ready: () => boolean) {
  if (ready()) return Promise.resolve();
  const existing = scriptPromises.get(id);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const oldScript = document.getElementById(id) as HTMLScriptElement | null;
    const script = oldScript || document.createElement("script");
    const onReady = () => resolve();
    const onError = () => reject(new Error("CAPTCHA_SCRIPT_BLOCKED"));
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!oldScript) {
      script.id = id;
      script.src = src;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  scriptPromises.set(id, promise);
  return promise;
}

interface CaptchaControlProps {
  username: string;
  password: string;
  beforeStart: () => Promise<boolean>;
  onVerified: (verificationToken?: string) => Promise<void>;
  onRecovery: (result: LoginResponse) => void;
  disabled?: boolean;
}

export function CaptchaControl({ username, password, beforeStart, onVerified, onRecovery, disabled }: CaptchaControlProps) {
  const [status, setStatus] = useState<"idle" | "preparing" | "challenge" | "complete" | "error">("idle");
  const [error, setError] = useState("");
  const [presentation, setPresentation] = useState<CaptchaPresentation | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [outageTicket, setOutageTicket] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [recovering, setRecovering] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const vendorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStatus("idle");
    setError("");
    setPresentation(null);
    setAttemptId(null);
    setOutageTicket("");
    setRecoveryKey("");
    setDialogOpen(false);
  }, [username]);

  useEffect(() => {
    if (presentation?.kind !== "custom_embed" || !dialogOpen) return;
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== presentation.allowedOrigin ||
        event.source !== iframeRef.current?.contentWindow ||
        event.data?.protocolVersion !== 1 ||
        event.data?.sessionId !== presentation.sessionRef
      ) return;
      if (event.data.event === "captcha.resize" && typeof event.data.height === "number") {
        iframeRef.current?.style.setProperty("height", `${Math.min(560, Math.max(190, event.data.height))}px`);
      }
      if (event.data.event === "captcha.completed" && typeof event.data.token === "string") {
        setDialogOpen(false);
        void complete(event.data.token);
      }
      if (event.data.event === "captcha.expired") void fail("验证码已过期");
      if (event.data.event === "captcha.error") void fail("验证码服务暂时不可用");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [dialogOpen, presentation]);

  async function fail(message: string) {
    setDialogOpen(false);
    setStatus("error");
    setError(message);
    try {
      const ticket = await captchaApi.requestOutageTicket(username);
      setOutageTicket(ticket.outageTicket);
    } catch {
      setOutageTicket("");
    }
  }

  async function complete(providerToken: string, targetAttemptId = attemptId) {
    if (!targetAttemptId) return;
    setStatus("preparing");
    try {
      const proof = await captchaApi.completeAttempt(targetAttemptId, providerToken);
      setStatus("complete");
      await onVerified(proof.verificationToken);
      setStatus("idle");
      setPresentation(null);
      setAttemptId(null);
    } catch (requestError) {
      await fail(getErrorMessage(requestError));
    }
  }

  async function runTurnstile(value: Extract<CaptchaPresentation, { kind: "turnstile" }>, targetAttemptId: string) {
    await loadScript("cloudflare-turnstile", "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", () => Boolean(window.turnstile));
    if (!vendorRef.current || !window.turnstile) throw new Error("CAPTCHA_SCRIPT_BLOCKED");
    vendorRef.current.replaceChildren();
    const widgetId = window.turnstile.render(vendorRef.current, {
      sitekey: value.siteKey,
      action: value.action,
      appearance: value.appearance,
      execution: "execute",
      callback: (token: string) => void complete(token, targetAttemptId),
      "error-callback": () => void fail("验证组件加载失败"),
      "expired-callback": () => setStatus("idle"),
    });
    window.turnstile.execute(widgetId);
  }

  async function runRecaptcha(value: Extract<CaptchaPresentation, { kind: "recaptcha_v2_invisible" }>, targetAttemptId: string) {
    await loadScript("google-recaptcha", "https://www.google.com/recaptcha/api.js?render=explicit", () => Boolean(window.grecaptcha));
    if (!vendorRef.current || !window.grecaptcha) throw new Error("CAPTCHA_SCRIPT_BLOCKED");
    vendorRef.current.replaceChildren();
    await new Promise<void>((resolve) => window.grecaptcha!.ready(resolve));
    const widgetId = window.grecaptcha.render(vendorRef.current, {
      sitekey: value.siteKey,
      size: "invisible",
      badge: value.badge,
      callback: (token: string) => void complete(token, targetAttemptId),
      "error-callback": () => void fail("验证组件加载失败"),
      "expired-callback": () => setStatus("idle"),
    });
    await window.grecaptcha.execute(widgetId);
  }

  async function start() {
    if (!(await beforeStart())) return;
    setStatus("preparing");
    setError("");
    setOutageTicket("");
    try {
      const config = await captchaApi.getPublicConfig();
      if (!config.enabled) {
        await onVerified();
        setStatus("idle");
        return;
      }
      const attempt = await captchaApi.createAttempt({
        username,
        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      });
      setAttemptId(attempt.attemptId);
      setPresentation(attempt.presentation);
      setStatus("challenge");
      if (attempt.presentation.kind === "custom_embed") setDialogOpen(true);
      else if (!attempt.attemptId) throw new Error("CAPTCHA_ATTEMPT_MISSING");
      else if (attempt.presentation.kind === "turnstile") await runTurnstile(attempt.presentation, attempt.attemptId);
      else if (attempt.presentation.kind === "recaptcha_v2_invisible") await runRecaptcha(attempt.presentation, attempt.attemptId);
      else await onVerified();
    } catch (requestError) {
      await fail(getErrorMessage(requestError));
    }
  }

  async function recoveryLogin() {
    setRecovering(true);
    try {
      const result = await captchaApi.recoveryLogin({ username, password, recoveryKey, outageTicket });
      onRecovery(result);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally { setRecovering(false); }
  }

  const label = status === "preparing" ? "验证中..." : status === "complete" ? "已验证" : status === "error" ? "重试验证" : "点击验证";

  return (
    <div className="space-y-3">
      <div ref={vendorRef} className="min-h-0" />
      <Button type="button" className="w-full" disabled={disabled || status === "preparing" || status === "challenge"} onClick={() => void start()}>
        {status === "preparing" ? <Loader2 className="h-4 w-4 animate-spin" /> : status === "complete" ? <CheckCircle2 className="h-4 w-4" /> : status === "error" ? <RefreshCw className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        {label}
      </Button>
      {error && <p className="text-center text-xs text-red-600" role="alert">{error}</p>}

      {outageTicket && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>验证码服务故障</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>仅超级管理员可使用备用密钥进入受限恢复页面。</p>
            <div className="space-y-1.5">
              <Label htmlFor="captcha-recovery-key">备用豁免密钥</Label>
              <Input id="captcha-recovery-key" type="password" maxLength={32} value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} />
            </div>
            <Button type="button" variant="outline" className="w-full border-amber-400 bg-white" disabled={recovering || recoveryKey.length !== 32} onClick={() => void recoveryLogin()}>
              {recovering && <Loader2 className="h-4 w-4 animate-spin" />}进入恢复页面
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open && status === "challenge") setStatus("idle"); setDialogOpen(open); }}>
        <DialogContent className="max-w-[400px] p-4">
          <DialogHeader><DialogTitle className="text-base">安全验证</DialogTitle></DialogHeader>
          {presentation?.kind === "custom_embed" && (
            <iframe
              ref={iframeRef}
              title="安全验证"
              src={presentation.iframeUrl}
              sandbox="allow-scripts allow-forms allow-same-origin"
              referrerPolicy="no-referrer"
              className="h-[220px] w-full border-0"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
