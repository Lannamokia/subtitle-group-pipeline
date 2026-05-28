import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/stores/authStore";
import { UserCircle } from "lucide-react";

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="max-w-full md:max-w-2xl mx-auto space-y-6 px-0">
      <h1 className="text-display text-gray-800">个人设置</h1>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2">基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
              <UserCircle className="w-8 h-8 text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">{user?.username}</p>
              <p className="text-xs text-gray-400">{user?.role === "supervisor" ? "监制" : "成员"}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>用户名</Label>
            <Input defaultValue={user?.username} />
          </div>
          <div className="space-y-2">
            <Label>QQ号</Label>
            <Input defaultValue={user?.qq} />
          </div>
          <Button>保存</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2">技能档案</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-500">选择你擅长或有意向的岗位</p>
          <div className="flex flex-wrap gap-2">
            {["片源", "时轴", "翻译", "后期", "压制", "发布"].map((tag) => (
              <Badge key={tag} variant="outline" className="cursor-pointer px-3 py-1.5 hover:bg-primary-50 hover:border-primary-200 transition-colors">
                {tag}
              </Badge>
            ))}
          </div>
          <Button>申请标签</Button>
        </CardContent>
      </Card>
    </div>
  );
}
