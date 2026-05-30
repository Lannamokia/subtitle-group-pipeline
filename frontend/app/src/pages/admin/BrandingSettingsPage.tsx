import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { systemApi, getErrorMessage } from "@/lib/api";
import { getBrandLogoUrl, useBrandingStore } from "@/stores/brandingStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImagePlus, Save } from "lucide-react";

const CROP_SIZE = 320;
const OUTPUT_SIZE = 512;

export function BrandingSettingsPage() {
  const branding = useBrandingStore((state) => state.branding);
  const setBranding = useBrandingStore((state) => state.setBranding);
  const loadBranding = useBrandingStore((state) => state.loadBranding);
  const logoUrl = getBrandLogoUrl(branding);
  const [appName, setAppName] = useState(branding.appName);
  const [savingName, setSavingName] = useState(false);
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("logo.png");
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    void loadBranding();
  }, [loadBranding]);

  useEffect(() => {
    setAppName(branding.appName);
  }, [branding.appName]);

  const handleSaveName = async () => {
    setSavingName(true);
    try {
      const updated = await systemApi.updateBranding({ appName });
      setBranding(updated);
      toast.success("系统名称已更新");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSavingName(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Logo 只支持 PNG、JPG 或 WebP");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast.error("原图大小不能超过 8MB");
      return;
    }

    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(URL.createObjectURL(file));
    setSourceName(file.name);
    setLogoDialogOpen(true);
  };

  const handleCroppedLogo = async (blob: Blob) => {
    setUploadingLogo(true);
    try {
      const file = new File([blob], sourceName.replace(/\.[^.]+$/, "") + ".png", {
        type: "image/png",
      });
      const updated = await systemApi.uploadLogo(file);
      setBranding(updated);
      setLogoDialogOpen(false);
      toast.success("Logo 已更新");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-5">
          <div>
            <h2 className="text-h2 text-gray-800">系统标识</h2>
            <p className="text-sm text-gray-500 mt-1">用于左上角、登录页、浏览器标题和页面图标。</p>
          </div>

          <div className="grid gap-5 lg:grid-cols-[180px_minmax(0,1fr)]">
            <div>
              <Label>当前 Logo</Label>
              <div className="mt-2 flex h-36 w-36 items-center justify-center rounded-lg border bg-gray-50">
                {logoUrl ? (
                  <img src={logoUrl} alt={branding.appName} className="h-24 w-24 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-24 w-24 items-center justify-center rounded-lg bg-primary-500 text-3xl font-bold text-white">
                    {branding.appName.charAt(0)}
                  </span>
                )}
              </div>
              <label className="mt-3 inline-flex">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={handleFileChange}
                />
                <span className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground">
                  <ImagePlus className="mr-1.5 h-4 w-4" />
                  上传并裁切
                </span>
              </label>
            </div>

            <div className="space-y-3">
              <Label htmlFor="app-name">系统名称</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="app-name"
                  value={appName}
                  maxLength={80}
                  onChange={(event) => setAppName(event.target.value)}
                  placeholder="输入字幕组系统名称"
                />
                <Button
                  className="shrink-0"
                  onClick={handleSaveName}
                  disabled={savingName || !appName.trim()}
                >
                  <Save className="mr-1.5 h-4 w-4" />
                  保存名称
                </Button>
              </div>
              <div className="rounded-lg border bg-gray-50 p-4">
                <p className="text-xs text-gray-500">预览</p>
                <div className="mt-2 flex items-center gap-3">
                  {logoUrl ? (
                    <img src={logoUrl} alt={appName} className="h-9 w-9 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500 text-sm font-bold text-white">
                      {(appName || "S").charAt(0)}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-gray-800">{appName || "SubtitleSync"}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <LogoCropDialog
        open={logoDialogOpen}
        sourceUrl={sourceUrl}
        uploading={uploadingLogo}
        onOpenChange={setLogoDialogOpen}
        onConfirm={handleCroppedLogo}
      />
    </div>
  );
}

function LogoCropDialog({
  open,
  sourceUrl,
  uploading,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  sourceUrl: string | null;
  uploading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (blob: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ dragging: boolean; x: number; y: number }>({ dragging: false, x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!sourceUrl) return;
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      const baseScale = Math.max(CROP_SIZE / image.width, CROP_SIZE / image.height);
      setScale(baseScale);
      setOffset({
        x: (CROP_SIZE - image.width * baseScale) / 2,
        y: (CROP_SIZE - image.height * baseScale) / 2,
      });
    };
    image.src = sourceUrl;
  }, [sourceUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
    ctx.drawImage(image, offset.x, offset.y, image.width * scale, image.height * scale);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, CROP_SIZE - 2, CROP_SIZE - 2);
  }, [offset, scale]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { dragging: true, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.dragging) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    dragRef.current = { dragging: true, x: event.clientX, y: event.clientY };
    setOffset((current) => ({ x: current.x + dx, y: current.y + dy }));
  };

  const handlePointerUp = () => {
    dragRef.current.dragging = false;
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const output = document.createElement("canvas");
    output.width = OUTPUT_SIZE;
    output.height = OUTPUT_SIZE;
    const ctx = output.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(canvas, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    output.toBlob((blob) => {
      if (blob) onConfirm(blob);
    }, "image/png");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>裁切 Logo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex justify-center">
            <canvas
              ref={canvasRef}
              width={CROP_SIZE}
              height={CROP_SIZE}
              className="h-80 w-80 cursor-move rounded-lg border bg-gray-50 touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          </div>
          <div className="space-y-2">
            <Label>缩放</Label>
            <Slider
              min={0.2}
              max={4}
              step={0.01}
              value={[scale]}
              onValueChange={(value) => setScale(value[0] ?? scale)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={!sourceUrl || uploading}>
            {uploading ? "上传中..." : "保存 Logo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
