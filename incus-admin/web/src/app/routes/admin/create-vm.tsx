import type {AdminCreateVMResult} from "@/features/vms/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useClustersQuery } from "@/features/clusters/api";
import { ClusterPicker } from "@/features/clusters/cluster-picker";
import { ProjectPicker } from "@/features/projects/project-picker";
import { useAdminCreateVMMutation } from "@/features/vms/api";
import { DEFAULT_OS_IMAGE, OsImagePicker, useOsImageLabel } from "@/features/vms/os-image-picker";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Label } from "@/shared/components/ui/label";
import { MobileBottomBar } from "@/shared/components/ui/mobile-bottom-bar";
import { SecretReveal } from "@/shared/components/ui/secret-reveal";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/create-vm")({
  component: CreateVMPage,
});

const PRESETS = [
  { label: "Small", cpu: 1, memory_mb: 1024, disk_gb: 25 },
  { label: "Medium", cpu: 2, memory_mb: 2048, disk_gb: 50 },
  { label: "Large", cpu: 4, memory_mb: 4096, disk_gb: 100 },
  { label: "XLarge", cpu: 8, memory_mb: 8192, disk_gb: 200 },
];

function CreateVMPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [preset, setPreset] = useState(1);
  const [osImage, setOsImage] = useState<string>(DEFAULT_OS_IMAGE);
  const [project, setProject] = useState("");
  // OPS-024 B2：批量创建 1..16
  const [count, setCount] = useState(1);

  const { data: clustersData } = useClustersQuery();
  const clusters = clustersData?.clusters ?? [];
  const [clusterName, setClusterName] = useState<string>("");

  useEffect(() => {
    if (!clusterName && clusters.length > 0) {
      setClusterName(clusters[0]!.name);
    }
  }, [clusterName, clusters]);

  const [result, setResult] = useState<AdminCreateVMResult | null>(null);
  const createMutation = useAdminCreateVMMutation(clusterName);

  const selected = PRESETS[preset]!;
  const osLabel = useOsImageLabel(osImage);

  const submit = () => {
    createMutation.mutate(
      {
        cpu: selected.cpu,
        memory_mb: selected.memory_mb,
        disk_gb: selected.disk_gb,
        os_image: osImage,
        project,
        count: count > 1 ? count : undefined,
      },
      { onSuccess: (data) => setResult(data) },
    );
  };

  const submitDisabled = createMutation.isPending || !clusterName || !project || count < 1 || count > 16;

  return (
    <PageShell>
      <PageHeader
        title={t("admin.createVmTitle", { defaultValue: "新建 VM" })}
        breadcrumbs={[
          { label: t("nav.allVms"), to: "/admin/vms" },
          { label: t("nav.createVm") },
        ]}
        description={t("admin.createVmDescription", {
          defaultValue: "选择规格、镜像和项目，下单后立即 provision。",
        })}
      />
      <PageContent>
        {result
          ? (
              <Card className="border-status-success/30 bg-status-success/8">
                <CardContent className="p-4 space-y-3">
                  <div className="font-strong text-sm text-status-success">
                    {result.items && result.items.length > 0
                      ? t("admin.vmsCreated", { defaultValue: "已入队 {{n}} 台 VM", n: result.items.length })
                      : t("admin.vmCreated", { defaultValue: "VM 创建成功" })}
                  </div>
                  {result.items && result.items.length > 0
                    ? (
                        <div className="space-y-2">
                          <p className="text-caption text-text-tertiary">
                            {t("admin.batchProvisioningHint", {
                              defaultValue: "异步入队，进度可在「订单」/「VM 列表」逐台查看：",
                            })}
                          </p>
                          <ul className="space-y-1 text-caption font-mono">
                            {result.items.map((it) => (
                              <li key={it.job_id} className="flex justify-between">
                                <span>{it.vm_name}</span>
                                <span className="text-text-tertiary">job #{it.job_id} · {it.ip}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    : (
                        <div className="space-y-2">
                          <SecretReveal label={t("vm.name")} value={result.vm_name ?? ""} inline={false} />
                          <SecretReveal label={t("vm.ip")} value={result.ip ?? ""} inline={false} autoMaskMs={0} />
                          {result.username
                            ? <SecretReveal label={t("vm.username")} value={result.username} inline={false} />
                            : null}
                          {result.password
                            ? <SecretReveal label={t("vm.password")} value={result.password} inline={false} />
                            : null}
                          {result.job_id
                            ? (
                                <p className="text-caption text-text-tertiary">
                                  {t("admin.asyncHint", {
                                    defaultValue: "异步创建中，job #{{id}}。完成后密码会通过 SSE 流送达。",
                                    id: result.job_id,
                                  })}
                                </p>
                              )
                            : (
                                <p className="text-caption text-text-tertiary">
                                  {t("admin.savePwdHint", { defaultValue: "请保存以上凭据 —— 密码仅显示一次。" })}
                                </p>
                              )}
                        </div>
                      )}
                  <div className="flex justify-end">
                    <Button
                      variant="primary"
                      onClick={() => {
                        setResult(null);
                        navigate({ to: "/admin/vms" });
                      }}
                    >
                      {t("admin.goToAllVms", { defaultValue: "前往 VM 列表" })}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          : null}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 max-w-5xl">
          <div className="lg:col-span-2 space-y-4">
            {clusters.length > 1 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-h3">{t("vm.cluster", { defaultValue: "集群" })}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ClusterPicker
                    value={clusterName}
                    onChange={setClusterName}
                    className="w-full h-9 rounded-md border border-border bg-surface-1 px-3 text-sm focus:outline-none focus:border-ring"
                  />
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-h3">{t("vm.size", { defaultValue: "规格" })}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PRESETS.map((p, i) => {
                    const active = i === preset;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setPreset(i)}
                        aria-pressed={active}
                        data-testid={`spec-preset-${p.label.toLowerCase()}`}
                        className={cn(
                          "relative p-3 rounded-md border text-center transition-colors",
                          active
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-border bg-surface-1 hover:bg-surface-2",
                        )}
                      >
                        {active ? (
                          <Check
                            size={12}
                            aria-hidden="true"
                            className="absolute top-1.5 right-1.5 text-accent"
                          />
                        ) : null}
                        <div className="font-emphasis text-sm">{p.label}</div>
                        <div className="text-caption text-text-tertiary mt-1">
                          {p.cpu}C / {(p.memory_mb / 1024).toFixed(0)}G / {p.disk_gb}G
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-h3">{t("vm.osImage", { defaultValue: "系统镜像" })}</CardTitle>
              </CardHeader>
              <CardContent>
                <OsImagePicker
                  value={osImage}
                  onChange={setOsImage}
                  className="w-full h-9 rounded-md border border-border bg-surface-1 px-3 text-sm focus:outline-none focus:border-ring"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-h3">{t("vm.project", { defaultValue: "项目" })}</CardTitle>
              </CardHeader>
              <CardContent>
                <Label className="sr-only">{t("vm.project")}</Label>
                <ProjectPicker
                  clusterName={clusterName}
                  value={project}
                  onChange={setProject}
                />
              </CardContent>
            </Card>

            {/* OPS-024 B2：批量创建 1..16 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">{t("admin.batchCount", { defaultValue: "批量数量（1..16）" })}</CardTitle>
              </CardHeader>
              <CardContent>
                <input
                  type="number"
                  min={1}
                  max={16}
                  step={1}
                  value={count}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    setCount(Number.isNaN(n) ? 1 : Math.min(16, Math.max(1, n)));
                  }}
                  className="w-32 h-9 rounded-md border border-border bg-surface-1 px-3 text-sm focus:outline-none focus:border-ring"
                />
                {count > 1
                  ? (
                      <p className="text-caption text-text-tertiary mt-2">
                        {t("admin.batchCountHint", {
                          defaultValue: "将一次性入队 {{n}} 个 VM job；每个独立 IP / 独立进度。完成后通过订单 / VM 列表查看。",
                          n: count,
                        })}
                      </p>
                    )
                  : null}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <Card className="lg:sticky lg:top-20">
              <CardHeader>
                <CardTitle className="text-h3">
                  {t("common.summary", { defaultValue: "概要" })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <SummaryRow label={t("vm.cluster")} value={clusters.find((c) => c.name === clusterName)?.display_name ?? "—"} />
                <SummaryRow
                  label={t("vm.config")}
                  value={`${selected.cpu} vCPU / ${(selected.memory_mb / 1024).toFixed(0)} GB / ${selected.disk_gb} GB`}
                />
                <SummaryRow label={t("vm.osImage")} value={osLabel ?? "—"} />
                <SummaryRow label={t("vm.project")} value={project || "—"} />
                <SummaryRow label={t("vm.ip")} value={t("admin.ipAuto", { defaultValue: "自动分配" })} />

                {createMutation.isError ? (
                  <Alert variant="error">
                    <AlertDescription>{(createMutation.error as Error).message}</AlertDescription>
                  </Alert>
                ) : null}

                <Button
                  variant="primary"
                  className="w-full hidden md:flex mt-4"
                  disabled={submitDisabled}
                  onClick={submit}
                >
                  <Plus size={14} aria-hidden="true" />
                  {createMutation.isPending
                    ? t("admin.creatingVm", { defaultValue: "创建中..." })
                    : t("admin.createVmTitle", { defaultValue: "新建 VM" })}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </PageContent>

      <MobileBottomBar>
        <Button
          variant="ghost"
          className="flex-1"
          onClick={() => navigate({ to: "/admin/vms" })}
        >
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          disabled={submitDisabled}
          onClick={submit}
        >
          <Plus size={14} aria-hidden="true" />
          {createMutation.isPending
            ? t("admin.creatingVm", { defaultValue: "创建中..." })
            : t("admin.createVmTitle", { defaultValue: "新建 VM" })}
        </Button>
      </MobileBottomBar>
    </PageShell>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b border-border last:border-b-0">
      <span className="text-text-tertiary">{label}</span>
      <span className="font-emphasis text-right truncate">{value}</span>
    </div>
  );
}
