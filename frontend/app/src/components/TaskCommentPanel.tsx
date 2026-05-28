import { useState, useRef, useCallback, useEffect } from "react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/UserAvatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mockUsers, mockFiles } from "@/lib/mockData";
import type { TaskComment, User } from "@/types";
import {
  Send,
  FileText,
  AtSign,
  MessageSquare,
  Hash,
} from "lucide-react";

// Mock comments data
const mockComments: TaskComment[] = [
  {
    id: "c1",
    taskId: "t1",
    user: mockUsers[1],
    content: "翻译稿已上传，请审核一下第三段的措辞",
    fileVersionId: "fv1",
    lineNumber: undefined,
    mentions: [],
    createdAt: "2024-06-20T10:00:00Z",
  },
  {
    id: "c2",
    taskId: "t1",
    user: mockUsers[2],
    content: "@小红 第三段的「不可能」改成「怎么会」会更自然一些",
    fileVersionId: "fv1",
    lineNumber: 15,
    mentions: ["u2"],
    createdAt: "2024-06-20T11:30:00Z",
  },
  {
    id: "c3",
    taskId: "t1",
    user: mockUsers[1],
    content: "好的，已修改",
    fileVersionId: undefined,
    lineNumber: undefined,
    mentions: [],
    createdAt: "2024-06-20T12:00:00Z",
  },
];

// Mock file versions
const mockFileVersions = [
  { id: "fv1", fileId: "f2", versionNumber: 1, label: "v1.0 - 初稿" },
  { id: "fv2", fileId: "f2", versionNumber: 2, label: "v1.1 - 修订" },
  { id: "fv3", fileId: "f2", versionNumber: 3, label: "v1.2 - 终稿" },
];

// Mock ASS lines for line-level commenting
const mockAssLines = [
  { number: 1, time: "0:00:05.00", text: "Dialogue: 0,0:00:05.00,0:00:07.50,Default,,0,0,0,,夏天又要结束了" },
  { number: 5, time: "0:00:15.00", text: "Dialogue: 0,0:00:15.00,0:00:18.00,Default,,0,0,0,,这不可能..." },
  { number: 10, time: "0:00:25.00", text: "Dialogue: 0,0:00:25.00,0:00:28.00,Default,,0,0,0,,谢谢你一直以来的照顾" },
  { number: 15, time: "0:00:35.00", text: "Dialogue: 0,0:00:35.00,0:00:38.00,Default,,0,0,0,,明天见" },
  { number: 20, time: "0:00:45.00", text: "Dialogue: 0,0:00:45.00,0:00:48.00,Default,,0,0,0,,我回来了" },
];

interface TaskCommentPanelProps {
  taskId: string;
  projectId: string;
}

export function TaskCommentPanel({ taskId, projectId }: TaskCommentPanelProps) {
  const currentUser = useAuthStore((s) => s.user);
  const [comments, setComments] = useState<TaskComment[]>(mockComments);
  const [newComment, setNewComment] = useState("");
  const [selectedFileVersion, setSelectedFileVersion] = useState<string>("");
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPosition, setCursorPosition] = useState(0);

  // Filter users for mention
  const mentionableUsers = mockUsers.filter(
    (u) =>
      u.id !== currentUser?.id &&
      (mentionQuery === "" || u.username.toLowerCase().includes(mentionQuery.toLowerCase()))
  );

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursor = e.target.selectionStart;
    setNewComment(value);
    setCursorPosition(cursor);

    // Check if we're typing @
    const beforeCursor = value.slice(0, cursor);
    const lastAtIndex = beforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const afterAt = beforeCursor.slice(lastAtIndex + 1);
      // Only show if no space after @
      if (!afterAt.includes(" ") && !afterAt.includes("\n")) {
        setMentionQuery(afterAt);
        setShowMentionDropdown(true);
        setMentionIndex(0);
      } else {
        setShowMentionDropdown(false);
      }
    } else {
      setShowMentionDropdown(false);
    }
  };

  const insertMention = useCallback(
    (user: User) => {
      const beforeCursor = newComment.slice(0, cursorPosition);
      const lastAtIndex = beforeCursor.lastIndexOf("@");
      const beforeMention = newComment.slice(0, lastAtIndex);
      const afterCursor = newComment.slice(cursorPosition);
      const newValue = `${beforeMention}@${user.username} ${afterCursor}`;
      setNewComment(newValue);
      setShowMentionDropdown(false);
      textareaRef.current?.focus();
    },
    [newComment, cursorPosition]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showMentionDropdown) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex((prev) => (prev + 1) % mentionableUsers.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex((prev) => (prev - 1 + mentionableUsers.length) % mentionableUsers.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (mentionableUsers[mentionIndex]) {
        insertMention(mentionableUsers[mentionIndex]);
      }
    } else if (e.key === "Escape") {
      setShowMentionDropdown(false);
    }
  };

  const handleSubmit = () => {
    if (!newComment.trim() || !currentUser) return;

    // Extract mentions from comment text
    const mentionPattern = /@(\S+)/g;
    const mentions: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = mentionPattern.exec(newComment)) !== null) {
      const username = match[1];
      const mentionedUser = mockUsers.find((u) => u.username === username);
      if (mentionedUser) {
        mentions.push(mentionedUser.id);
      }
    }

    const comment: TaskComment = {
      id: `c-${Date.now()}`,
      taskId,
      user: currentUser,
      content: newComment.trim(),
      fileVersionId: selectedFileVersion || undefined,
      lineNumber: selectedLine || undefined,
      mentions,
      createdAt: new Date().toISOString(),
    };

    setComments((prev) => [...prev, comment]);
    setNewComment("");
    setSelectedLine(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Comment list */}
      <div className="flex-1 overflow-y-auto space-y-4 p-4 min-h-[300px]">
        {comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="w-10 h-10 text-gray-300" />
            <p className="text-sm text-gray-500 mt-3">暂无评论</p>
            <p className="text-xs text-gray-400 mt-1">发表第一条评论</p>
          </div>
        ) : (
          comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} />
          ))
        )}
      </div>

      {/* New comment input */}
      <div className="border-t border-gray-200 p-4 space-y-3">
        {/* File version selector */}
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-400" />
          <Select value={selectedFileVersion} onValueChange={setSelectedFileVersion}>
            <SelectTrigger className="w-fit h-8 text-xs">
              <SelectValue placeholder="引用文件版本（可选）" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">不引用文件</SelectItem>
              {mockFileVersions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedFileVersion && (
            <Select value={selectedLine?.toString() || ""} onValueChange={(v) => setSelectedLine(v ? Number(v) : null)}>
              <SelectTrigger className="w-fit h-8 text-xs">
                <SelectValue placeholder="选择行号（可选）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">不指定行</SelectItem>
                {mockAssLines.map((line) => (
                  <SelectItem key={line.number} value={line.number.toString()}>
                    行 {line.number} ({line.time})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Selected line preview */}
        {selectedLine && (
          <div className="bg-gray-50 rounded-md px-3 py-2 text-xs font-mono text-gray-600 border border-gray-200">
            <div className="flex items-center gap-1 text-gray-400 mb-1">
              <Hash className="w-3 h-3" />
              行 {selectedLine}
            </div>
            {mockAssLines.find((l) => l.number === selectedLine)?.text}
          </div>
        )}

        {/* Textarea with mention support */}
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={newComment}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="输入评论... 使用 @ 提及成员"
            className="min-h-[80px] pr-10 text-sm"
          />
          <Button
            size="sm"
            className="absolute bottom-2 right-2 h-7 px-2"
            onClick={handleSubmit}
            disabled={!newComment.trim()}
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Mention dropdown */}
        {showMentionDropdown && mentionableUsers.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
            {mentionableUsers.map((user, index) => (
              <button
                key={user.id}
                onClick={() => insertMention(user)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors",
                  index === mentionIndex && "bg-primary-50"
                )}
              >
                <UserAvatar user={user} size="xs" />
                <span className="text-sm text-gray-700">{user.username}</span>
                <span className="text-xs text-gray-400 ml-auto">@{user.username}</span>
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-400">
          按 @ 提及成员，只有被 @ 提及的成员会收到通知
        </p>
      </div>
    </div>
  );
}

function CommentItem({ comment }: { comment: TaskComment }) {
  // Parse mentions in content
  const renderContent = (content: string) => {
    const parts = content.split(/(@\S+)/g);
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        return (
          <span key={i} className="text-primary-600 font-medium bg-primary-50 px-1 rounded">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div className="flex gap-3">
      <UserAvatar user={comment.user} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800">{comment.user.username}</span>
          <span className="text-xs text-gray-400">{formatRelativeTime(comment.createdAt)}</span>
        </div>

        {/* File reference */}
        {comment.fileVersionId && (
          <div className="flex items-center gap-1 mt-1">
            <FileText className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-500">
              引用{" "}
              {mockFileVersions.find((v) => v.id === comment.fileVersionId)?.label || "文件版本"}
            </span>
          </div>
        )}

        {/* Line reference */}
        {comment.lineNumber && (
          <div className="flex items-center gap-1 mt-1">
            <Hash className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-500">行 {comment.lineNumber}</span>
          </div>
        )}

        <p className="text-sm text-gray-700 mt-1 leading-relaxed">{renderContent(comment.content)}</p>

        {/* Mention indicator */}
        {comment.mentions.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5">
            <AtSign className="w-3 h-3 text-primary-500" />
            <span className="text-xs text-primary-600">
              提及了 {comment.mentions.length} 位成员
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
