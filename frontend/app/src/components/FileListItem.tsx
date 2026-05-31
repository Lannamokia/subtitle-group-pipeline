import { cn, formatFileSize, formatRelativeTime, getFileTypeLabel } from "@/lib/utils";
import type { FileEntity } from "@/types";
import { Film, FileText, Type, Archive, Link2, File, Download, History, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FileListItemProps {
  file: FileEntity;
  onDownload?: () => void;
  onViewHistory?: () => void;
  onDelete?: () => void;
  showVersion?: boolean;
  className?: string;
}

const fileTypeIcons: Record<string, React.ReactNode> = {
  video: <Film className="w-4 h-4 text-blue-500" />,
  subtitle: <FileText className="w-4 h-4 text-green-500" />,
  font: <Type className="w-4 h-4 text-purple-500" />,
  project_package: <Archive className="w-4 h-4 text-orange-500" />,
  other: <File className="w-4 h-4 text-gray-500" />,
};

export function FileListItem({ file, onDownload, onViewHistory, onDelete, showVersion = true, className }: FileListItemProps) {
  const isLink = file.assetKind === "link" || Boolean(file.url && file.size === 0);
  const historyCount = isLink ? file.linkHistory?.length ?? file.versionCount : file.versionCount;
  const canShowHistory = showVersion && Boolean(onViewHistory) && historyCount > 1;

  return (
    <div
      className={cn(
        "flex items-center gap-4 py-3 px-4 border-b border-gray-100 last:border-0",
        "hover:bg-gray-50 transition-colors",
        className
      )}
    >
      {/* File icon */}
      <div className="shrink-0">
        {isLink ? <Link2 className="w-4 h-4 text-blue-500" /> : fileTypeIcons[file.type] || fileTypeIcons.other}
      </div>

      {/* File name + version badge */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-800 truncate">{file.name}</span>
          {canShowHistory && (
            <span className="shrink-0 px-1.5 py-0.5 text-caption bg-blue-50 text-blue-600 rounded">
              {isLink ? `${historyCount}次提交` : `${historyCount}版本`}
            </span>
          )}
          {file.isSensitive && (
            <span className="shrink-0 px-1.5 py-0.5 text-caption bg-red-50 text-red-600 rounded">
              敏感
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-gray-500">{isLink ? "网盘链接" : getFileTypeLabel(file.type)}</span>
          <span className="text-xs text-gray-400">{file.uploader.username}</span>
          <span className="text-xs text-gray-400">{formatRelativeTime(file.updatedAt)}</span>
          {isLink && file.extractCode && (
            <span className="text-xs text-gray-400">提取码: {file.extractCode}</span>
          )}
        </div>
      </div>

      {/* File size */}
      {!isLink && (
        <div className="shrink-0 text-sm text-gray-500 w-24 text-right">
          {formatFileSize(file.size)}
        </div>
      )}

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onDownload}
          title={isLink ? "打开网盘链接" : "下载当前版本"}
          aria-label={isLink ? "打开网盘链接" : "下载当前版本"}
        >
          {isLink ? <Link2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
        </Button>
        {canShowHistory && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onViewHistory}
            title="版本历史"
            aria-label="版本历史"
          >
            <History className="w-4 h-4" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDownload}>
              {isLink ? <Link2 className="w-4 h-4 mr-2" /> : <Download className="w-4 h-4 mr-2" />}
              {isLink ? "打开链接" : "下载"}
            </DropdownMenuItem>
            {canShowHistory && (
              <DropdownMenuItem onClick={onViewHistory}>
                <History className="w-4 h-4 mr-2" />
                版本历史
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={onDelete}>
                <Trash2 className="w-4 h-4 mr-2" />
                删除
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
