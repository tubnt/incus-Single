import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useJobQuery } from "@/features/jobs/api";
import { JobProgress } from "@/features/jobs/components/job-progress";
import { useJobStream } from "@/features/jobs/use-job-stream";
import {
  useAddNodeMutation,
  useTestSSHMutation,
} from "@/features/nodes/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/node-join")({
  component: NodeJoinPage,
});

/** PLAN-026 / INFRA-002：把原"手工 4 步 Wizard"换成自动化表单 + 实时进度。
 *
 *  流程：
 *    1) 填表（cluster / hostname / public IP / role / SSH user / key 路径）
 *    2) 测试 SSH（已有 useTestSSHMutation 复用）
 *    3) 提交 → POST /admin/clusters/{cluster}/nodes → 202 + job_id
 *    4) 切到 JobProgress 视图，SSE 流式 9 步进度
 *    5) 终态后给 toast + 返回节点列表
 */
function NodeJoinPage() {
  const { t } = useTranslation();
  const [cluster, setCluster] = useState("cn-sz-01");
  const [nodeName, setNodeName] = useState("");
  const [publicIP, setPublicIP] = useState("");
  const [role, setRole] = useState<"osd" | "mon-mgr-osd">("osd");
  const [sshUser, setSshUser] = useState("root");
  const [sshKey, setSshKey] = useState("");
  const [sshOK, setSshOK] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);

  const testSSH = useTestSSHMutation();
  const addNode = useAddNodeMutation(cluster);
  const stream = useJobStream(jobId);
  const jobQuery = useJobQuery(stream.terminal != null ? jobId : null);

  const formError = (() => {
    if (!nodeName) return t("admin.nodes.add.errMissingName", "节点名必填");
    if (!/^[a-z0-9][\w.-]*$/i.test(nodeName)) return t("admin.nodes.add.errInvalidName", "节点名格式非法");
    if (!publicIP) return t("admin.nodes.add.errMissingIP", "公网 IP 必填");
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(publicIP)) return t("admin.nodes.add.errInvalidIP", "IP 格式非法");
    return "";
  })();

  // 终态成功 toast（避免 render 内 setState）
  useEffect(() => {
    if (stream.terminal === "succeeded" && jobQuery.data?.job?.status === "succeeded") {
      toast.success(t("admin.nodes.add.done", { defaultValue: "节点 {{name}} 已加入集群", name: nodeName }));
    }
    if (stream.terminal === "failed" || stream.terminal === "partial") {
      const lastFailed = stream.steps.slice().reverse().find((s) => s.status === "failed");
      toast.error(lastFailed?.detail ?? t("admin.nodes.add.failed", "节点加入失败，请查看进度卡详情"));
    }
  }, [stream.terminal, jobQuery.data, stream.steps, nodeName, t]);

  const onTestSSH = () => {
    if (!publicIP) {
      toast.error(t("admin.nodes.add.errMissingIP", "公网 IP 必填"));
      return;
    }
    testSSH.mutate(publicIP, {
      onSuccess: (res) => {
        if (res.status === "ok") {
          setSshOK(true);
          toast.success(t("admin.nodes.add.sshOk", "SSH 连通正常"));
        } else {
          setSshOK(false);
          toast.error(
            t("admin.nodes.add.sshFailed", {
              defaultValue: "SSH 失败: {{err}}",
              err: res.error || res.output,
            }),
          );
        }
      },
      onError: (err) => {
        setSshOK(false);
        toast.error((err as Error).message);
      },
    });
  };

  const onSubmit = () => {
    if (formError || !sshOK) return;
    addNode.mutate(
      {
        node_name: nodeName,
        public_ip: publicIP,
        ssh_user: sshUser || undefined,
        ssh_key_file: sshKey || undefined,
        role,
      },
      {
        onSuccess: (res) => {
          if (res.job_id) {
            setJobId(res.job_id);
            toast.info(
              t("admin.nodes.add.enqueued", {
                defaultValue: "已入队，job #{{id}}",
                id: res.job_id,
              }),
            );
          }
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  return (
    <PageShell>
      <PageHeader
        title={t("admin.nodes.add.title", "添加节点")}
        actions={
          <Link
            to="/admin/nodes"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("common.back", "返回")}
          </Link>
        }
      />
      <PageContent>
        {jobId
          ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t("admin.nodes.add.progressTitle", {
                      defaultValue: "正在加入节点 {{name}}",
                      name: nodeName,
                    })}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <JobProgress steps={stream.steps} />
                  {stream.terminal != null
                    ? (
                        <div className="flex justify-end">
                          <Link
                            to="/admin/nodes"
                            className={buttonVariants({ variant: "primary", size: "sm" })}
                          >
                            {t("common.done", "完成")}
                          </Link>
                        </div>
                      )
                    : (
                        <div className="text-caption text-text-tertiary">
                          {t("admin.nodes.add.progressHint", "进度实时更新中。可关闭本页稍后回来查看")}
                        </div>
                      )}
                </CardContent>
              </Card>
            )
          : (
              <Card>
                <CardHeader>
                  <CardTitle>{t("admin.nodes.add.formTitle", "节点信息")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField label={t("admin.nodes.add.cluster", "目标集群")}>
                    <Select value={cluster} onValueChange={(v) => setCluster(String(v))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cn-sz-01">cn-sz-01</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label={t("admin.nodes.add.nodeName", "节点名（如 node6）")}>
                    <Input
                      value={nodeName}
                      onChange={(e) => setNodeName(e.target.value)}
                      placeholder="node6"
                    />
                  </FormField>
                  <FormField label={t("admin.nodes.add.publicIP", "公网 IP")}>
                    <Input
                      value={publicIP}
                      onChange={(e) => {
                        setPublicIP(e.target.value);
                        setSshOK(false);
                      }}
                      placeholder="202.151.179.231"
                    />
                  </FormField>
                  <FormField label={t("admin.nodes.add.role", "Ceph 角色")}>
                    <Select value={role} onValueChange={(v) => setRole(String(v) as typeof role)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="osd">osd（仅存储）</SelectItem>
                        <SelectItem value="mon-mgr-osd">mon-mgr-osd（含 MON）</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label={t("admin.nodes.add.sshUser", "SSH 用户（默认 root）")}>
                    <Input value={sshUser} onChange={(e) => setSshUser(e.target.value)} placeholder="root" />
                  </FormField>
                  <FormField label={t("admin.nodes.add.sshKey", "SSH 私钥路径（admin 服务器本地，留空用全局默认）")}>
                    <Input
                      value={sshKey}
                      onChange={(e) => setSshKey(e.target.value)}
                      placeholder="/etc/incus-admin/keys/cluster-deploy"
                    />
                  </FormField>

                  {formError
                    ? (
                        <div className="rounded-md border border-status-error/30 bg-status-error/8 p-3 text-sm text-status-error">
                          {formError}
                        </div>
                      )
                    : null}

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={testSSH.isPending || !publicIP}
                      onClick={onTestSSH}
                    >
                      {testSSH.isPending
                        ? t("admin.nodes.add.testing", "测试中...")
                        : sshOK
                          ? t("admin.nodes.add.sshOkBadge", "✓ SSH 连通")
                          : t("admin.nodes.add.testSSH", "测试 SSH 连通")}
                    </Button>
                    <span
                      className={cn(
                        "text-caption",
                        sshOK ? "text-status-success" : "text-text-tertiary",
                      )}
                    >
                      {sshOK
                        ? t("admin.nodes.add.canSubmit", "可提交")
                        : t("admin.nodes.add.testFirst", "需要先测试 SSH 连通")}
                    </span>
                  </div>
                </CardContent>
                <CardContent className="flex justify-end gap-2 border-t border-border pt-4">
                  <Link
                    to="/admin/nodes"
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    {t("common.cancel", "取消")}
                  </Link>
                  <Button
                    variant="primary"
                    disabled={!sshOK || !!formError || addNode.isPending}
                    onClick={onSubmit}
                  >
                    {addNode.isPending
                      ? t("common.processing", "处理中...")
                      : t("admin.nodes.add.submit", "开始添加")}
                  </Button>
                </CardContent>
              </Card>
            )}
      </PageContent>
    </PageShell>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
