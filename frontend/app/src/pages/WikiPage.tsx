import { useState, useCallback } from "react";
import { useParams } from "react-router";
import { cn, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/stores/authStore";
import { mockWiki } from "@/lib/mockData";
import type { WikiBlock, WikiBlockType, WikiStatus } from "@/types";
import {
  Edit3,
  Eye,
  Plus,
  Trash2,
  GripVertical,
  Check,
  X,
  Table,
  FileText,
  Clock,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Link } from "react-router";

// Simple markdown renderer
function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inList = false;
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (inList && listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="list-disc list-inside space-y-1 my-2">
          {listItems}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("# ")) {
      flushList();
      elements.push(
        <h1 key={i} className="text-2xl font-bold text-gray-800 mt-6 mb-3">
          {trimmed.slice(2)}
        </h1>
      );
    } else if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(
        <h2 key={i} className="text-xl font-semibold text-gray-700 mt-5 mb-2">
          {trimmed.slice(3)}
        </h2>
      );
    } else if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(
        <h3 key={i} className="text-lg font-medium text-gray-700 mt-4 mb-2">
          {trimmed.slice(4)}
        </h3>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList) inList = true;
      listItems.push(
        <li key={i} className="text-sm text-gray-600">
          {trimmed.slice(2)}
        </li>
      );
    } else if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
      flushList();
      elements.push(
        <p key={i} className="text-sm text-gray-600 my-1">
          <strong>{trimmed.slice(2, -2)}</strong>
        </p>
      );
    } else if (trimmed === "---") {
      flushList();
      elements.push(<hr key={i} className="my-4 border-gray-200" />);
    } else if (trimmed === "") {
      flushList();
    } else {
      flushList();
      elements.push(
        <p key={i} className="text-sm text-gray-600 leading-relaxed my-1">
          {trimmed}
        </p>
      );
    }
  });

  flushList();
  return <div className="prose prose-sm max-w-none">{elements}</div>;
}

// Table block renderer (display mode)
function TableBlockRenderer({ block }: { block: WikiBlock }) {
  const data = block.data as { headers: string[]; rows: string[][] } | undefined;
  if (!data) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50">
            {data.headers.map((h, i) => (
              <th
                key={i}
                className="text-left px-3 py-2 font-medium text-gray-700 border border-gray-200"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-gray-50">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-gray-600 border border-gray-200">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Editable table block
function EditableTableBlock({
  block,
  onChange,
}: {
  block: WikiBlock;
  onChange: (block: WikiBlock) => void;
}) {
  const data = (block.data as { headers: string[]; rows: string[][] }) || {
    headers: ["列1", "列2", "列3"],
    rows: [["", "", ""]],
  };

  const updateHeader = (index: number, value: string) => {
    const newHeaders = [...data.headers];
    newHeaders[index] = value;
    onChange({ ...block, data: { ...data, headers: newHeaders } });
  };

  const updateCell = (rowIndex: number, colIndex: number, value: string) => {
    const newRows = data.rows.map((r, i) =>
      i === rowIndex ? r.map((c, j) => (j === colIndex ? value : c)) : r
    );
    onChange({ ...block, data: { ...data, rows: newRows } });
  };

  const addRow = () => {
    onChange({
      ...block,
      data: { ...data, rows: [...data.rows, new Array(data.headers.length).fill("")] },
    });
  };

  const removeRow = (index: number) => {
    if (data.rows.length <= 1) return;
    onChange({
      ...block,
      data: { ...data, rows: data.rows.filter((_, i) => i !== index) },
    });
  };

  const addColumn = () => {
    onChange({
      ...block,
      data: {
        headers: [...data.headers, `列${data.headers.length + 1}`],
        rows: data.rows.map((r) => [...r, ""]),
      },
    });
  };

  const removeColumn = (index: number) => {
    if (data.headers.length <= 1) return;
    onChange({
      ...block,
      data: {
        headers: data.headers.filter((_, i) => i !== index),
        rows: data.rows.map((r) => r.filter((_, i) => i !== index)),
      },
    });
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50">
              {data.headers.map((h, i) => (
                <th key={i} className="border border-gray-200 p-0">
                  <div className="flex items-center">
                    <Input
                      value={h}
                      onChange={(e) => updateHeader(i, e.target.value)}
                      className="border-0 rounded-none bg-transparent focus-visible:ring-0 text-sm font-medium text-gray-700 h-9"
                    />
                    {data.headers.length > 1 && (
                      <button
                        onClick={() => removeColumn(i)}
                        className="px-1 text-gray-400 hover:text-red-500 shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="border border-gray-200 p-0">
                    <Input
                      value={cell}
                      onChange={(e) => updateCell(ri, ci, e.target.value)}
                      className="border-0 rounded-none bg-transparent focus-visible:ring-0 text-sm text-gray-600 h-9"
                    />
                  </td>
                ))}
                <td className="border-0 w-8">
                  {data.rows.length > 1 && (
                    <button
                      onClick={() => removeRow(ri)}
                      className="text-gray-400 hover:text-red-500 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          添加行
        </Button>
        <Button variant="outline" size="sm" onClick={addColumn}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          添加列
        </Button>
      </div>
    </div>
  );
}

// Block editor component
function BlockEditor({
  block,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  block: WikiBlock;
  onChange: (block: WikiBlock) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GripVertical className="w-4 h-4 text-gray-400" />
          <Badge variant="outline" className="text-[10px]">
            {block.type === "markdown" ? "Markdown" : "表格"}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {!isFirst && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onMoveUp}>
              <ArrowLeft className="w-3.5 h-3.5 rotate-90" />
            </Button>
          )}
          {!isLast && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onMoveDown}>
              <ArrowLeft className="w-3.5 h-3.5 -rotate-90" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
            onClick={onDelete}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {block.type === "markdown" ? (
        <Textarea
          value={block.content}
          onChange={(e) => onChange({ ...block, content: e.target.value })}
          placeholder="输入 Markdown 内容..."
          className="min-h-[120px] font-mono text-sm"
        />
      ) : (
        <EditableTableBlock block={block} onChange={onChange} />
      )}
    </div>
  );
}

// Diff view for pending changes
function DiffView({
  original,
  pending,
}: {
  original: WikiBlock[];
  pending: WikiBlock[];
}) {
  return (
    <div className="space-y-4">
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-yellow-600" />
        <span className="text-sm text-yellow-800">
          以下变更正在等待审核批准
        </span>
      </div>
      {pending.map((block, i) => {
        const orig = original[i];
        const hasChanged =
          !orig ||
          orig.type !== block.type ||
          orig.content !== block.content ||
          JSON.stringify(orig.data) !== JSON.stringify(block.data);

        return (
          <div
            key={block.id}
            className={cn(
              "border rounded-lg p-4",
              hasChanged ? "border-yellow-300 bg-yellow-50/30" : "border-gray-200"
            )}
          >
            {hasChanged && (
              <Badge variant="outline" className="text-[10px] mb-2 bg-yellow-100 text-yellow-700 border-yellow-300">
                已修改
              </Badge>
            )}
            {block.type === "markdown" ? (
              <MarkdownRenderer content={block.content} />
            ) : (
              <TableBlockRenderer block={block} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function WikiPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const isSupervisor = useAuthStore((s) => s.isSupervisor)();

  const [blocks, setBlocks] = useState<WikiBlock[]>(mockWiki.blocks);
  const [status, setStatus] = useState<WikiStatus>(mockWiki.status);
  const [isEditing, setIsEditing] = useState(false);
  const [pendingBlocks, setPendingBlocks] = useState<WikiBlock[] | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [activeTab, setActiveTab] = useState<"view" | "edit" | "diff">("view");
  const [title, setTitle] = useState(mockWiki.title);
  const [isSaving, setIsSaving] = useState(false);

  const handleAddBlock = (type: WikiBlockType) => {
    const newBlock: WikiBlock = {
      id: `block-${Date.now()}`,
      type,
      content: type === "markdown" ? "" : "",
      data:
        type === "table"
          ? { headers: ["列1", "列2", "列3"], rows: [["", "", ""]] }
          : undefined,
    };
    setBlocks((prev) => [...prev, newBlock]);
  };

  const handleUpdateBlock = useCallback((index: number, block: WikiBlock) => {
    setBlocks((prev) => prev.map((b, i) => (i === index ? block : b)));
  }, []);

  const handleDeleteBlock = useCallback((index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleMoveBlock = useCallback((index: number, direction: -1 | 1) => {
    setBlocks((prev) => {
      const newBlocks = [...prev];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= newBlocks.length) return prev;
      [newBlocks[index], newBlocks[targetIndex]] = [newBlocks[targetIndex], newBlocks[index]];
      return newBlocks;
    });
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Simulate API call
      await new Promise((r) => setTimeout(r, 500));

      if (isSupervisor) {
        // Supervisors can directly approve
        setStatus("approved");
        setPendingBlocks(null);
      } else {
        // Members submit for approval
        setPendingBlocks([...blocks]);
        setStatus("pending");
      }
      setIsEditing(false);
      setActiveTab("view");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async () => {
    setIsSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 300));
      setStatus("approved");
      setPendingBlocks(null);
      setShowDiff(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReject = async () => {
    setIsSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 300));
      setPendingBlocks(null);
      setStatus("draft");
      setShowDiff(false);
    } finally {
      setIsSaving(false);
    }
  };

  const displayBlocks = pendingBlocks || blocks;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          to={`/projects/${projectId}`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-3"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回项目
        </Link>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-display text-gray-800">{title}</h1>
            <WikiStatusBadge status={status} />
          </div>
          <div className="flex items-center gap-2">
            {status === "pending" && isSupervisor && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDiff(!showDiff)}
                >
                  <Eye className="w-4 h-4 mr-1.5" />
                  {showDiff ? "隐藏变更" : "查看变更"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={handleReject}
                  disabled={isSaving}
                >
                  <X className="w-4 h-4 mr-1.5" />
                  驳回
                </Button>
                <Button size="sm" onClick={handleApprove} disabled={isSaving}>
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  批准
                </Button>
              </>
            )}
            {!isEditing ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsEditing(true);
                  setActiveTab("edit");
                }}
              >
                <Edit3 className="w-4 h-4 mr-1.5" />
                编辑
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsEditing(false);
                    setActiveTab("view");
                    setBlocks(mockWiki.blocks); // Reset
                  }}
                >
                  <X className="w-4 h-4 mr-1.5" />
                  取消
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isSaving}>
                  <Check className="w-4 h-4 mr-1.5" />
                  {isSupervisor ? "保存" : "提交审核"}
                </Button>
              </>
            )}
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-2 flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          最后更新：{mockWiki.updatedBy.username} · {formatDate(mockWiki.updatedAt)}
        </p>
      </div>

      {/* Approval flow indicator */}
      {status !== "approved" && (
        <ApprovalFlowIndicator status={status} isSupervisor={isSupervisor} />
      )}

      {/* Diff view dialog */}
      {showDiff && pendingBlocks && (
        <Card className="border-yellow-300">
          <CardHeader className="py-3">
            <CardTitle className="text-h3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              待审核变更
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DiffView original={blocks} pending={pendingBlocks} />
          </CardContent>
        </Card>
      )}

      {/* Main content */}
      {isEditing ? (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList>
            <TabsTrigger value="edit">
              <Edit3 className="w-3.5 h-3.5 mr-1" />
              编辑
            </TabsTrigger>
            <TabsTrigger value="view">
              <Eye className="w-3.5 h-3.5 mr-1" />
              预览
            </TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="mt-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">页面标题</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="输入页面标题..."
              />
            </div>

            <div className="space-y-3">
              {blocks.map((block, index) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  onChange={(b) => handleUpdateBlock(index, b)}
                  onDelete={() => handleDeleteBlock(index)}
                  onMoveUp={() => handleMoveBlock(index, -1)}
                  onMoveDown={() => handleMoveBlock(index, 1)}
                  isFirst={index === 0}
                  isLast={index === blocks.length - 1}
                />
              ))}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button variant="outline" onClick={() => handleAddBlock("markdown")}>
                <FileText className="w-4 h-4 mr-1.5" />
                添加 Markdown
              </Button>
              <Button variant="outline" onClick={() => handleAddBlock("table")}>
                <Table className="w-4 h-4 mr-1.5" />
                添加表格
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="view" className="mt-4">
            <PreviewBlocks blocks={blocks} title={title} />
          </TabsContent>
        </Tabs>
      ) : (
        <PreviewBlocks blocks={displayBlocks} title={title} />
      )}
    </div>
  );
}

function PreviewBlocks({ blocks, title }: { blocks: WikiBlock[]; title: string }) {
  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
        {blocks.map((block) => (
          <div key={block.id}>
            {block.type === "markdown" ? (
              <MarkdownRenderer content={block.content} />
            ) : (
              <TableBlockRenderer block={block} />
            )}
          </div>
        ))}
        {blocks.length === 0 && (
          <div className="text-center py-12 text-sm text-gray-400">
            暂无内容，点击编辑开始添加
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WikiStatusBadge({ status }: { status: WikiStatus }) {
  const config = {
    draft: { label: "草稿", className: "bg-gray-100 text-gray-700 border-gray-300" },
    pending: { label: "待审核", className: "bg-yellow-100 text-yellow-700 border-yellow-300" },
    approved: { label: "已批准", className: "bg-green-100 text-green-700 border-green-300" },
  };
  const c = config[status];
  return (
    <Badge variant="outline" className={cn("text-xs", c.className)}>
      {c.label}
    </Badge>
  );
}

function ApprovalFlowIndicator({
  status,
  isSupervisor,
}: {
  status: WikiStatus;
  isSupervisor: boolean;
}) {
  const steps = [
    { id: "draft", label: "编辑中", description: "内容正在编辑" },
    { id: "pending", label: "待审核", description: "等待审核批准" },
    { id: "approved", label: "已批准", description: "变更已生效" },
  ];

  const currentIndex = steps.findIndex((s) => s.id === status);

  return (
    <Card className="bg-gray-50/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium",
                    index <= currentIndex
                      ? "bg-primary-500 text-white"
                      : "bg-gray-200 text-gray-500"
                  )}
                >
                  {index < currentIndex ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    index + 1
                  )}
                </div>
                <div>
                  <p
                    className={cn(
                      "text-sm font-medium",
                      index <= currentIndex ? "text-gray-800" : "text-gray-400"
                    )}
                  >
                    {step.label}
                  </p>
                </div>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-3",
                    index < currentIndex ? "bg-primary-500" : "bg-gray-200"
                  )}
                />
              )}
            </div>
          ))}
        </div>
        {status === "pending" && isSupervisor && (
          <p className="text-sm text-yellow-700 mt-3 bg-yellow-50 rounded-md px-3 py-2">
            作为监制，你可以批准或驳回这些变更。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
