import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { setupApi, getErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Database, HardDrive, Loader2, UserPlus } from "lucide-react";

type DatabaseProvider = "sqlite" | "mysql" | "mariadb" | "postgresql";
type StorageType = "local" | "s3" | "s3_compatible";

export function SetupPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completeMessage, setCompleteMessage] = useState<string | null>(null);
  const [provider, setProvider] = useState<DatabaseProvider>("sqlite");
  const [databaseUrl, setDatabaseUrl] = useState("file:./dev.db");
  const [admin, setAdmin] = useState({ username: "admin", password: "", nickname: "", email: "" });
  const [storageType, setStorageType] = useState<StorageType>("local");
  const [storage, setStorage] = useState({
    name: "默认本地存储",
    localPath: "./uploads",
    endpoint: "",
    bucket: "",
    region: "us-east-1",
    accessKeyId: "",
    secretAccessKey: "",
    quotaGb: "",
  });

  useEffect(() => {
    setupApi.getStatus()
      .then((status) => {
        if (status.initialized) {
          navigate("/login", { replace: true });
        }
      })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [navigate]);

  const storageConfig = () => {
    if (storageType === "local") {
      return JSON.stringify({ basePath: storage.localPath || "./uploads" });
    }

    return JSON.stringify({
      endpoint: storage.endpoint || undefined,
      bucket: storage.bucket,
      region: storage.region,
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
      forcePathStyle: true,
    });
  };

  const handleSubmit = async () => {
    if (!databaseUrl.trim()) {
      toast.error("请填写数据库连接");
      return;
    }
    if (!admin.username.trim() || !admin.password) {
      toast.error("请填写超级管理员账号和密码");
      return;
    }
    if (admin.password.length < 8) {
      toast.error("超级管理员密码至少 8 位");
      return;
    }
    if (!storage.name.trim()) {
      toast.error("请填写默认存储名称");
      return;
    }
    if (storageType !== "local" && (!storage.bucket || !storage.accessKeyId || !storage.secretAccessKey)) {
      toast.error("S3 存储必须填写 bucket、accessKeyId 和 secretAccessKey");
      return;
    }

    setSubmitting(true);
    try {
      const result = await setupApi.complete({
        database: { provider, url: databaseUrl },
        admin: {
          username: admin.username,
          password: admin.password,
          nickname: admin.nickname || undefined,
          email: admin.email || undefined,
        },
        storage: {
          name: storage.name,
          backend_type: storageType,
          config: storageConfig(),
          quota_bytes: storage.quotaGb ? Number(storage.quotaGb) * 1024 * 1024 * 1024 : null,
        },
      });
      if ((result as { restartRequired?: boolean; message?: string })?.restartRequired) {
        setCompleteMessage((result as { message?: string }).message || "初始化完成，请重启服务后登录。");
        toast.success("初始化完成，请重启服务");
        return;
      }
      toast.success("初始化完成，请登录");
      navigate("/login", { replace: true });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-display text-gray-800">系统初始化</h1>
          <p className="mt-1 text-sm text-gray-500">配置数据库、超级管理员和默认存储后端后开始使用。</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <SetupStep icon={Database} title="数据库">
            <Label>数据库类型</Label>
            <Select value={provider} onValueChange={(value) => {
              const next = value as DatabaseProvider;
              setProvider(next);
              setDatabaseUrl(
                next === "sqlite"
                  ? "file:./dev.db"
                  : next === "mariadb"
                    ? "mariadb://user:password@localhost:3306/subtitle_group"
                  : next === "mysql"
                    ? "mysql://user:password@localhost:3306/subtitle_group"
                    : "postgresql://user:password@localhost:5432/subtitle_group"
              );
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sqlite">SQLite</SelectItem>
                <SelectItem value="mysql">MySQL</SelectItem>
                <SelectItem value="mariadb">MariaDB</SelectItem>
                <SelectItem value="postgresql">PostgreSQL</SelectItem>
              </SelectContent>
            </Select>
            <Label>连接地址</Label>
            <Input value={databaseUrl} onChange={(event) => setDatabaseUrl(event.target.value)} />
            <p className="text-xs leading-5 text-gray-500">
              初始化会按这里选择的类型同步数据库结构，并写入连接参数。MySQL/MariaDB/PostgreSQL 初始化完成后需要重启服务。
            </p>
          </SetupStep>

          <SetupStep icon={UserPlus} title="超级管理员">
            <Label>用户名</Label>
            <Input value={admin.username} onChange={(event) => setAdmin({ ...admin, username: event.target.value })} />
            <Label>密码</Label>
            <Input type="password" value={admin.password} onChange={(event) => setAdmin({ ...admin, password: event.target.value })} />
            <Label>昵称</Label>
            <Input value={admin.nickname} onChange={(event) => setAdmin({ ...admin, nickname: event.target.value })} />
            <Label>邮箱</Label>
            <Input value={admin.email} onChange={(event) => setAdmin({ ...admin, email: event.target.value })} />
          </SetupStep>

          <SetupStep icon={HardDrive} title="默认存储后端">
            <Label>存储类型</Label>
            <Select value={storageType} onValueChange={(value) => setStorageType(value as StorageType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="local">本地存储</SelectItem>
                <SelectItem value="s3">S3</SelectItem>
                <SelectItem value="s3_compatible">S3 Compatible / MinIO</SelectItem>
              </SelectContent>
            </Select>
            <Label>名称</Label>
            <Input value={storage.name} onChange={(event) => setStorage({ ...storage, name: event.target.value })} />
            {storageType === "local" ? (
              <>
                <Label>本地路径</Label>
                <Input value={storage.localPath} onChange={(event) => setStorage({ ...storage, localPath: event.target.value })} />
              </>
            ) : (
              <>
                <Label>Endpoint</Label>
                <Input value={storage.endpoint} onChange={(event) => setStorage({ ...storage, endpoint: event.target.value })} />
                <Label>Bucket</Label>
                <Input value={storage.bucket} onChange={(event) => setStorage({ ...storage, bucket: event.target.value })} />
                <Label>Region</Label>
                <Input value={storage.region} onChange={(event) => setStorage({ ...storage, region: event.target.value })} />
                <Label>Access Key ID</Label>
                <Input value={storage.accessKeyId} onChange={(event) => setStorage({ ...storage, accessKeyId: event.target.value })} />
                <Label>Secret Access Key</Label>
                <Input type="password" value={storage.secretAccessKey} onChange={(event) => setStorage({ ...storage, secretAccessKey: event.target.value })} />
              </>
            )}
            <Label>容量上限 GB</Label>
            <Input value={storage.quotaGb} onChange={(event) => setStorage({ ...storage, quotaGb: event.target.value })} placeholder="留空表示不限" />
          </SetupStep>
        </div>

        <div className="flex justify-end">
          {completeMessage ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {completeMessage}
            </div>
          ) : null}
          <Button size="lg" onClick={handleSubmit} disabled={submitting || Boolean(completeMessage)}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            完成初始化
          </Button>
        </div>
      </div>
    </div>
  );
}

function SetupStep({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <Icon className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
