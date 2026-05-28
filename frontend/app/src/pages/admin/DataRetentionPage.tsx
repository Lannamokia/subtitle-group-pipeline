import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock, Archive, Trash2, Download } from "lucide-react";

export function DataRetentionPage() {
  return (
    <div className="max-w-full md:max-w-3xl mx-auto space-y-6 px-0">
      <div>
        <h1 className="text-display text-gray-800 flex items-center gap-2">
          <Clock className="w-6 h-6 text-gray-400" />
          数据保留策略
        </h1>
        <p className="text-sm text-gray-500 mt-1">配置归档清理、回收站和下载链接保留策略</p>
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2 flex items-center gap-2">
            <Archive className="w-5 h-5 text-gray-400" />
            归档清理
          </CardTitle>
          <CardDescription>归档项目满指定天数后自动清理旧版本</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>归档版本清理天数</Label>
            <Input type="number" defaultValue={30} min={1} />
            <p className="text-xs text-gray-500">归档满N天后自动清理旧版本，仅保留终稿</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2 flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-gray-400" />
            回收站
          </CardTitle>
          <CardDescription>回收站中项目的保留时间</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>回收站保留天数</Label>
            <Input type="number" defaultValue={30} min={1} />
            <p className="text-xs text-gray-500">超过保留天数的项目将被永久删除</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-h2 flex items-center gap-2">
            <Download className="w-5 h-5 text-gray-400" />
            下载链接
          </CardTitle>
          <CardDescription>临时下载链接的有效期设置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>链接有效期（秒）</Label>
            <Input type="number" defaultValue={300} min={90} />
            <p className="text-xs text-gray-500">最小90秒，建议300秒（5分钟）</p>
          </div>
          <div className="space-y-2">
            <Label>清理间隔（秒）</Label>
            <Input type="number" defaultValue={30} min={10} />
            <p className="text-xs text-gray-500">后台任务扫描过期链接的间隔</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button>保存设置</Button>
      </div>
    </div>
  );
}
