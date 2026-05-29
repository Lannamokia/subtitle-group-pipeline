import { useState, useEffect, useCallback } from "react";
import { api, getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { FileListItem } from "@/components/FileListItem";
import { toast } from "sonner";
import type { FileEntity, FileType, LinkAsset } from "@/types";
import {
  Search,
  FileArchive,
  Upload,
  Loader2,
  Filter,
  Link2,
  Trash2,
  ExternalLink,
} from "lucide-react";

const FILE_TYPE_OPTIONS: { value: FileType | "all"; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "video", label: "视频" },
  { value: "subtitle", label: "字幕" },
  { value: "font", label: "字体" },
  { value: "project_package", label: "工程包" },
  { value: "other", label: "其他" },
];

export function FileListPage() {
  const [files, setFiles] = useState<FileEntity[]>([]);
  const [links, setLinks] = useState<LinkAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<FileType | "all">("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileEntity | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkForm, setLinkForm] = useState({ name: "", url: "", extractCode: "", description: "" });
  const [addingLink, setAddingLink] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<FileEntity[]>("/files");
      setFiles(res.data);
    } catch (error) {
      toast.error("获取文件列表失败: " + getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLinks = useCallback(async () => {
    try {
      const res = await api.get<LinkAsset[]>("/links");
      setLinks(res.data);
    } catch {
      setLinks([]);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
    fetchLinks();
  }, [fetchFiles, fetchLinks]);

  const filteredFiles = files.filter((f) => {
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== "all" && f.type !== typeFilter) return false;
    return true;
  });

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", fileList[0]);
      await api.post("/files/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("文件上传成功");
      setUploadOpen(false);
      fetchFiles();
    } catch (error) {
      toast.error("上传失败: " + getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (fileId: string) => {
    try {
      const res = await api.post(`/files/${fileId}/download`);
      window.open(res.data.url, "_blank");
    } catch (error) {
      toast.error("获取下载链接失败: " + getErrorMessage(error));
    }
  };

  const handleAddLink = async () => {
    if (!linkForm.name || !linkForm.url) {
      toast.error("请填写名称和链接");
      return;
    }
    setAddingLink(true);
    try {
      await api.post("/links", linkForm);
      toast.success("链接已添加");
      setLinkDialogOpen(false);
      setLinkForm({ name: "", url: "", extractCode: "", description: "" });
      fetchLinks();
    } catch (error) {
      toast.error("添加失败: " + getErrorMessage(error));
    } finally {
      setAddingLink(false);
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    try {
      await api.delete(`/links/${linkId}`);
      toast.success("链接已删除");
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
    } catch (error) {
      toast.error("删除失败: " + getErrorMessage(error));
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display text-gray-800">文件</h1>
          <p className="text-sm text-gray-500 mt-1">共 {filteredFiles.length} 个文件</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(true)}>
            <Link2 className="w-4 h-4 mr-1.5" />
            添加链接
          </Button>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="w-4 h-4 mr-1.5" />
            上传文件
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="搜索文件..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as FileType | "all")}>
          <SelectTrigger className="w-40">
            <Filter className="w-3.5 h-3.5 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILE_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-h3">文件列表</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {filteredFiles.length > 0 ? (
                <div>
                  {filteredFiles.map((file) => (
                    <FileListItem
                      key={file.id}
                      file={file}
                      onDownload={() => handleDownload(file.id)}
                      onViewHistory={() => setSelectedFile(file)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center py-16 text-center">
                  <FileArchive className="w-10 h-10 text-gray-300" />
                  <p className="text-sm text-gray-500 mt-3">暂无文件</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Link Assets */}
          {links.length > 0 && (
            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-h3">网盘链接</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100">
                  {links.map((link) => (
                    <div
                      key={link.id}
                      className="flex items-center justify-between px-6 py-4 hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <Link2 className="w-4 h-4 text-blue-500" />
                        <div>
                          <p className="text-sm font-medium text-gray-800">{link.name}</p>
                          <p className="text-xs text-gray-500">{link.description}</p>
                          {link.extractCode && (
                            <p className="text-xs text-gray-400">提取码: {link.extractCode}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => window.open(link.url, "_blank")}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500"
                          onClick={() => handleDeleteLink(link.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上传文件</DialogTitle>
          </DialogHeader>
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
              dragOver ? "border-primary-500 bg-primary-50" : "border-gray-300"
            )}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
          >
            <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600">拖拽文件到此处，或</p>
            <label className="mt-2 inline-block">
              <input
                type="file"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files)}
              />
              <Button type="button" variant="outline" size="sm" asChild>
                <span>选择文件</span>
              </Button>
            </label>
          </div>
          {uploading && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="w-5 h-5 animate-spin text-primary-500 mr-2" />
              <span className="text-sm text-gray-500">上传中...</span>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Link Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加网盘链接</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">名称</label>
              <Input
                placeholder="链接名称"
                value={linkForm.name}
                onChange={(e) => setLinkForm({ ...linkForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">链接</label>
              <Input
                placeholder="https://..."
                value={linkForm.url}
                onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">提取码</label>
              <Input
                placeholder="可选"
                value={linkForm.extractCode}
                onChange={(e) => setLinkForm({ ...linkForm, extractCode: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">描述</label>
              <Input
                placeholder="可选"
                value={linkForm.description}
                onChange={(e) => setLinkForm({ ...linkForm, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>取消</Button>
            <Button onClick={handleAddLink} disabled={addingLink}>
              {addingLink && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version History Sheet */}
      <Sheet open={!!selectedFile} onOpenChange={() => setSelectedFile(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>版本历史</SheetTitle>
          </SheetHeader>
          {selectedFile && (
            <div className="mt-6 space-y-3">
              <div className="text-sm">
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-gray-500">共 {selectedFile.versionCount} 个版本</p>
              </div>
              <div className="text-center py-8 text-sm text-gray-400">
                版本历史详情需要从后端获取
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
