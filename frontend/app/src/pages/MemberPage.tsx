import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/UserAvatar";
import { memberApi } from "@/lib/api";
import type { User } from "@/types";
import { Search, UserPlus } from "lucide-react";

export function MemberPage() {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    memberApi.getMembers()
      .then((data) => setUsers(data.items || []))
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display text-gray-800">成员管理</h1>
          <p className="text-sm text-gray-500 mt-1">共 {users.length} 名成员</p>
        </div>
        <Button>
          <UserPlus className="w-4 h-4 mr-1.5" />
          邀请成员
        </Button>
      </div>

      <Card>
        <CardHeader className="py-4">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="搜索成员..." className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-100">
            {users.map((user) => (
              <div key={user.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-6 py-3 sm:py-4 hover:bg-gray-50 gap-2">
                <div className="flex items-center gap-3">
                  <UserAvatar user={user} size="md" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{user.username}</p>
                    <p className="text-xs text-gray-400">QQ: {user.qq}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-xs">
                    {user.role === "super_admin"
                      ? "超级管理员"
                      : user.role === "group_admin"
                        ? "组管理员"
                        : user.role === "supervisor"
                          ? "监制"
                          : "成员"}
                  </Badge>
                  <Badge
                    variant={user.status === "active" ? "default" : "outline"}
                    className="text-xs"
                  >
                    {user.status === "active" ? "正常" : "待验证"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
