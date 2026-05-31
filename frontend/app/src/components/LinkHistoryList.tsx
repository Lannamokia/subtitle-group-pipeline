import { ExternalLink, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FileEntity, LinkAsset } from "@/types";

function fallbackLinkFromFile(file: FileEntity): LinkAsset | null {
  if (!file.url) return null;
  return {
    id: file.id,
    projectId: file.projectId,
    fileId: file.fileId,
    name: file.name,
    url: file.url,
    extractCode: file.extractCode,
    description: file.description,
    taskId: file.taskId,
    unitId: file.unitId,
    role: file.role,
    type: file.type,
    createdBy: file.uploader,
    createdAt: file.updatedAt || file.createdAt,
    updatedAt: file.updatedAt || file.createdAt,
  };
}

function getLinkEntries(file: FileEntity) {
  const entries = file.linkHistory?.length
    ? file.linkHistory
    : [fallbackLinkFromFile(file)].filter((link): link is LinkAsset => Boolean(link));

  return [...entries].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
}

function formatTimestamp(value?: string) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN");
}

export function LinkHistoryList({ file }: { file: FileEntity }) {
  const entries = getLinkEntries(file);

  return (
    <div className="mt-6 space-y-3">
      <div className="text-sm">
        <p className="font-medium break-words">{file.name}</p>
        <p className="text-gray-500">共 {entries.length} 次链接提交</p>
      </div>
      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map((link, index) => (
            <div key={link.id} className="rounded-md border border-gray-200 p-3 text-sm space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Link2 className="h-4 w-4 shrink-0 text-blue-500" />
                    <span className="break-words">{link.name || "网盘链接"}</span>
                  </div>
                  <p className="mt-1 break-all text-xs text-gray-500">{link.url}</p>
                </div>
                {index === 0 && (
                  <span className="shrink-0 rounded bg-primary-50 px-1.5 py-0.5 text-[10px] text-primary-700">
                    当前
                  </span>
                )}
              </div>
              <div className="space-y-1 text-xs text-gray-500">
                {link.extractCode && <p>提取码: {link.extractCode}</p>}
                {link.description && <p className="break-words">说明: {link.description}</p>}
                <p>{formatTimestamp(link.createdAt)}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => window.open(link.url, "_blank")}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                打开链接
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-8 text-center text-sm text-gray-400">暂无链接历史</div>
      )}
    </div>
  );
}
