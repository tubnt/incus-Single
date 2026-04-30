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

// OPS-028 L2：从 pub IP 末位推算内网 IP placeholder。pub IP 不合法时返
// 回空字符串（input 渲染空 placeholder，等用户输完 pub IP 才显示）。
function derivedInternalIP(prefix: "10.0.10" | "10.0.20" | "10.0.30", pubIP: string): string {
  const parts = pubIP.split(".");
  if (parts.length !== 4) return "";
  const last = parts[3];
  if (!last || !/^\d+$/.test(last)) return "";
  return `${prefix}.${last}`;
}

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
  // OPS-026 / PLAN-028 advanced：bonded NIC / 异构拓扑
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [skipNetwork, setSkipNetwork] = useState(false);
  const [nicPrimary, setNicPrimary] = useState("");
  const [nicCluster, setNicCluster] = useState("");
  const [bridgeName, setBridgeName] = useState("");
  const [mgmtIP, setMgmtIP] = useState("");
  const [cephPubIP, setCephPubIP] = useState("");
  const [cephClusterIP, setCephClusterIP] = useState("");

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
        // OPS-026 / PLAN-028 advanced 覆盖
        nic_primary: nicPrimary || undefined,
        nic_cluster: nicCluster || undefined,
        bridge_name: bridgeName || undefined,
        mgmt_ip: mgmtIP || undefined,
        ceph_pub_ip: cephPubIP || undefined,
        ceph_cluster_ip: cephClusterIP || undefined,
        skip_network: skipNetwork || undefined,
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

                  {/* OPS-026 / PLAN-028 advanced：bonded NIC / 异构拓扑 */}
                  <details open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
                    <summary className="cursor-pointer text-small font-emphasis text-text-secondary py-1.5 select-none">
                      {t("admin.nodes.add.advanced", "高级（bonded NIC / 异构拓扑）")}
                    </summary>
                    <div className="space-y-3 mt-3 pl-3 border-l border-border">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={skipNetwork}
                          onChange={(e) => setSkipNetwork(e.target.checked)}
                          className="size-4"
                        />
                        <span className="text-small">
                          {t("admin.nodes.add.skipNetwork", "跳过网络配置（节点已由运维预配 IP / 路由 / 桥接）")}
                        </span>
                      </label>
                      <FormField label={t("admin.nodes.add.nicPrimary", "主网卡名（默认 eno1）")}>
                        <Input value={nicPrimary} onChange={(e) => setNicPrimary(e.target.value)} placeholder="bond-mgmt" />
                      </FormField>
                      <FormField label={t("admin.nodes.add.nicCluster", "Ceph 集群网卡名（默认 eno2）")}>
                        <Input value={nicCluster} onChange={(e) => setNicCluster(e.target.value)} placeholder="bond-ceph" />
                      </FormField>
                      <FormField label={t("admin.nodes.add.bridgeName", "桥接名（默认 br-pub）")}>
                        <Input value={bridgeName} onChange={(e) => setBridgeName(e.target.value)} placeholder="br-pub" />
                      </FormField>
                      {/* OPS-028 L2：placeholder 跟着 publicIP 末位走，运维不用心算 */}
                      <FormField label={t("admin.nodes.add.mgmtIP", "mgmt IP（默认按 pub IP 末位推算）")}>
                        <Input value={mgmtIP} onChange={(e) => setMgmtIP(e.target.value)} placeholder={derivedInternalIP("10.0.10", publicIP)} />
                      </FormField>
                      <FormField label={t("admin.nodes.add.cephPubIP", "Ceph public IP（默认推算 10.0.20.X）")}>
                        <Input value={cephPubIP} onChange={(e) => setCephPubIP(e.target.value)} placeholder={derivedInternalIP("10.0.20", publicIP)} />
                      </FormField>
                      <FormField label={t("admin.nodes.add.cephClusterIP", "Ceph cluster IP（默认推算 10.0.30.X）")}>
                        <Input value={cephClusterIP} onChange={(e) => setCephClusterIP(e.target.value)} placeholder={derivedInternalIP("10.0.30", publicIP)} />
                      </FormField>
                      {skipNetwork && !mgmtIP
                        ? (
                            <div className="rounded-md border border-status-warning/30 bg-status-warning/8 p-2 text-xs text-status-warning">
                              {t(
                                "admin.nodes.add.skipNetworkWarn",
                                "skip-network 模式下 mgmt IP 为空将走 pub IP 末位推算（{{ip}}）；如不一致请显式填入。",
                                { ip: derivedInternalIP("10.0.10", publicIP) || "—" },
                              )}
                            </div>
                          )
                        : null}
                    </div>
                  </details>

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
