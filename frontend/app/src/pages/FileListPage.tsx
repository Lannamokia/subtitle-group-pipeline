import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FileListItem } from "@/components/FileListItem";
import { mockFiles } from "@/lib/mockData";
import { Search, FileArchive, Upload } from "lucide-react";

export function FileListPage() {
  const [search, setSearch] = useState("");
  const filtered = mockFiles.filter((f) =>
    search ? f.name.toLowerCase().includes(search.toLowerCase()) : true
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display text-gray-800">文件</h1>
          <p className="text-sm text-gray-500 mt-1">共 {filtered.length} 个文件</p>
        </div>
        <Button>
          <Upload className="w-4 h-4 mr-1.5" />
          上传文件
        </Button>
      </div>

      <Card>
        <CardHeader className="py-4">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="搜索文件..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length > 0 ? (
            <div>
              {filtered.map((file) => (
                <FileListItem key={file.id} file={file} onDownload={() => {}} onViewHistory={() => {}} />
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
    </div>
  );
}
