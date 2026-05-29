import { useState } from "react";
import { cn, getRoleLabel } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DeliveryItem, TaskRole } from "@/types";
import { GripVertical, Plus, X, ArrowUp, ArrowDown } from "lucide-react";

const ALL_ROLES: TaskRole[] = [
  "source",
  "timing",
  "translation",
  "post_production",
  "encoding",
  "release",
];

interface DeliveryChecklistEditorProps {
  items: DeliveryItem[];
  onChange: (items: DeliveryItem[]) => void;
  readOnly?: boolean;
}

export function DeliveryChecklistEditor({
  items,
  onChange,
  readOnly = false,
}: DeliveryChecklistEditorProps) {
  const [draggingIndex] = useState<number | null>(null);

  const handleAddItem = () => {
    const newItem: DeliveryItem = {
      id: `d${Date.now()}`,
      name: "",
      role: "translation",
      required: true,
    };
    onChange([...items, newItem]);
  };

  const handleRemoveItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleUpdateItem = (index: number, updates: Partial<DeliveryItem>) => {
    const newItems = items.map((item, i) =>
      i === index ? { ...item, ...updates } : item
    );
    onChange(newItems);
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const newItems = [...items];
    [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
    onChange(newItems);
  };

  const handleMoveDown = (index: number) => {
    if (index >= items.length - 1) return;
    const newItems = [...items];
    [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
    onChange(newItems);
  };

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div
          key={item.id}
          className={cn(
            "flex items-center gap-2 p-3 border rounded-lg bg-gray-50/50 transition-colors",
            draggingIndex === index && "opacity-50"
          )}
        >
          {!readOnly && (
            <>
              <GripVertical className="w-4 h-4 text-gray-300 shrink-0 cursor-grab" />
              <div className="flex flex-col gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 min-w-0"
                  onClick={() => handleMoveUp(index)}
                  disabled={index === 0}
                >
                  <ArrowUp className="w-3 h-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 min-w-0"
                  onClick={() => handleMoveDown(index)}
                  disabled={index === items.length - 1}
                >
                  <ArrowDown className="w-3 h-3" />
                </Button>
              </div>
            </>
          )}

          <div className="flex-1 min-w-0">
            <Input
              placeholder="交付项名称"
              value={item.name}
              onChange={(e) => handleUpdateItem(index, { name: e.target.value })}
              disabled={readOnly}
              className="text-sm"
            />
          </div>

          <Select
            value={item.role}
            onValueChange={(val) => handleUpdateItem(index, { role: val as TaskRole })}
            disabled={readOnly}
          >
            <SelectTrigger className="w-28 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {getRoleLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <Switch
                checked={item.required}
                onCheckedChange={(checked) =>
                  handleUpdateItem(index, { required: checked })
                }
                disabled={readOnly}
              />
              <span
                className={cn(
                  "text-xs",
                  item.required ? "text-gray-700" : "text-gray-400"
                )}
              >
                必需
              </span>
            </div>

            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
                onClick={() => handleRemoveItem(index)}
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      ))}

      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleAddItem}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          添加交付项
        </Button>
      )}

      {items.length === 0 && (
        <div className="text-center py-6 text-sm text-gray-400">
          暂无交付项
        </div>
      )}
    </div>
  );
}
