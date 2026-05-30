import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

const CROP_SIZE = 320;
const OUTPUT_SIZE = 512;

type AvatarCropDialogProps = {
  open: boolean;
  imageUrl: string | null;
  uploading: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => Promise<void>;
};

type Point = {
  x: number;
  y: number;
};

type ImageSize = {
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function fileFromCanvas(canvas: HTMLCanvasElement): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("头像裁剪失败"));
        return;
      }
      resolve(new File([blob], "avatar.png", { type: "image/png" }));
    }, "image/png");
  });
}

export function AvatarCropDialog({
  open,
  imageUrl,
  uploading,
  onCancel,
  onConfirm,
}: AvatarCropDialogProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ start: Point; origin: Point; pointerId: number } | null>(null);

  const display = useMemo(() => {
    if (!imageSize) {
      return { width: CROP_SIZE, height: CROP_SIZE, scale: 1 };
    }
    const baseScale = Math.max(CROP_SIZE / imageSize.width, CROP_SIZE / imageSize.height);
    const scale = baseScale * zoom;
    return {
      width: imageSize.width * scale,
      height: imageSize.height * scale,
      scale,
    };
  }, [imageSize, zoom]);

  const clampOffset = (next: Point, nextZoom = zoom): Point => {
    if (!imageSize) return { x: 0, y: 0 };
    const baseScale = Math.max(CROP_SIZE / imageSize.width, CROP_SIZE / imageSize.height);
    const scale = baseScale * nextZoom;
    const width = imageSize.width * scale;
    const height = imageSize.height * scale;
    const maxX = Math.max(0, (width - CROP_SIZE) / 2);
    const maxY = Math.max(0, (height - CROP_SIZE) / 2);
    return {
      x: clamp(next.x, -maxX, maxX),
      y: clamp(next.y, -maxY, maxY),
    };
  };

  useEffect(() => {
    if (!open) {
      setDrag(null);
      return;
    }
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setImageSize(null);
  }, [imageUrl, open]);

  useEffect(() => {
    setOffset((current) => clampOffset(current));
  }, [display.width, display.height]);

  const handleConfirm = async () => {
    const img = imageRef.current;
    if (!img || !imageSize) return;

    const sourceSize = CROP_SIZE / display.scale;
    const sourceX = (display.width / 2 - CROP_SIZE / 2 - offset.x) / display.scale;
    const sourceY = (display.height / 2 - CROP_SIZE / 2 - offset.y) / display.scale;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("头像裁剪失败");
    }

    ctx.drawImage(
      img,
      clamp(sourceX, 0, imageSize.width - sourceSize),
      clamp(sourceY, 0, imageSize.height - sourceSize),
      sourceSize,
      sourceSize,
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE
    );

    await onConfirm(await fileFromCanvas(canvas));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !uploading && onCancel()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>裁剪头像</DialogTitle>
          <DialogDescription>调整头像显示区域</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className="relative mx-auto overflow-hidden rounded-lg bg-gray-950"
            style={{ width: CROP_SIZE, height: CROP_SIZE }}
            onPointerDown={(event) => {
              if (uploading) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrag({
                start: { x: event.clientX, y: event.clientY },
                origin: offset,
                pointerId: event.pointerId,
              });
            }}
            onPointerMove={(event) => {
              if (!drag || uploading) return;
              setOffset(clampOffset({
                x: drag.origin.x + event.clientX - drag.start.x,
                y: drag.origin.y + event.clientY - drag.start.y,
              }));
            }}
            onPointerUp={(event) => {
              if (drag?.pointerId === event.pointerId) {
                setDrag(null);
              }
            }}
            onPointerCancel={() => setDrag(null)}
          >
            {imageUrl && (
              <img
                ref={imageRef}
                src={imageUrl}
                alt=""
                draggable={false}
                className="absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: display.width,
                  height: display.height,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                }}
                onLoad={(event) => {
                  setImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  });
                }}
              />
            )}
            <div className="pointer-events-none absolute inset-0 ring-2 ring-white/80" />
          </div>

          <div className="space-y-2">
            <Label>缩放</Label>
            <Slider
              value={[zoom]}
              min={1}
              max={3}
              step={0.01}
              disabled={uploading}
              onValueChange={(value) => {
                const nextZoom = value[0] ?? 1;
                setZoom(nextZoom);
                setOffset((current) => clampOffset(current, nextZoom));
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={uploading}>
            取消
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={uploading || !imageSize}>
            {uploading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            上传头像
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
