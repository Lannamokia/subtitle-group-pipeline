import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import type { RegistrationMode } from "@/types";
import { Settings, Shield, Users, Lock } from "lucide-react";

export function RegistrationSettingsPage() {
  const [mode, setMode] = useState<RegistrationMode>("qq_verification");
  const [qqGroup, setQqGroup] = useState("123456789");
  const [codeLength, setCodeLength] = useState(8);
  const [roleTagEnabled, setRoleTagEnabled] = useState(true);

  return (
    <div className="max-w-full md:max-w-3xl mx-auto space-y-6 px-0">
      <div>
        <h1 className="text-display text-gray-800 flex items-center gap-2">
          <Settings className="w-6 h-6 text-gray-400" />
          注册策略
        </h1>
        <p className="text-sm text-gray-500 mt-1">配置用户注册和准入控制策略</p>
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2">注册模式</CardTitle>
          <CardDescription>选择平台允许的注册方式</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as RegistrationMode)} className="space-y-4">
            <div className="flex items-start space-x-3 rounded-lg border p-3 md:p-4 border-gray-200 p-4 cursor-pointer hover:bg-gray-50" onClick={() => setMode("disabled")}>
              <RadioGroupItem value="disabled" id="disabled" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-red-500" />
                  <Label htmlFor="disabled" className="text-sm font-medium cursor-pointer">禁止注册</Label>
                </div>
                <p className="text-xs text-gray-500 mt-1">关闭注册入口，仅管理员可创建账号</p>
              </div>
            </div>

            <div className="flex items-start space-x-3 rounded-lg border p-3 md:p-4 border-gray-200 p-4 cursor-pointer hover:bg-gray-50" onClick={() => setMode("open")}>
              <RadioGroupItem value="open" id="open" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-green-500" />
                  <Label htmlFor="open" className="text-sm font-medium cursor-pointer">开放注册</Label>
                </div>
                <p className="text-xs text-gray-500 mt-1">任何人都可以直接注册并立即使用</p>
              </div>
            </div>

            <div className="flex items-start space-x-3 rounded-lg border p-3 md:p-4 border-primary-200 bg-primary-50/50 p-4 cursor-pointer" onClick={() => setMode("qq_verification")}>
              <RadioGroupItem value="qq_verification" id="qq_verification" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary-500" />
                  <Label htmlFor="qq_verification" className="text-sm font-medium cursor-pointer">QQ群验证注册</Label>
                </div>
                <p className="text-xs text-gray-500 mt-1">注册后需要在指定QQ群发送验证指令激活账号</p>
              </div>
            </div>
          </RadioGroup>

          {mode === "qq_verification" && (
            <div className="space-y-4 pt-4 border-t">
              <div className="space-y-2">
                <Label>验证QQ群号</Label>
                <Input value={qqGroup} onChange={(e) => setQqGroup(e.target.value)} placeholder="输入QQ群号" />
              </div>
              <div className="space-y-2">
                <Label>验证码长度</Label>
                <Input type="number" value={codeLength} onChange={(e) => setCodeLength(Number(e.target.value))} min={4} max={12} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2">资格标签</CardTitle>
          <CardDescription>配置用户资格标签申请和审批</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">启用资格标签申请</p>
              <p className="text-xs text-gray-500">允许用户在注册时选择意向岗位标签</p>
            </div>
            <Switch checked={roleTagEnabled} onCheckedChange={setRoleTagEnabled} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button>保存设置</Button>
      </div>
    </div>
  );
}
