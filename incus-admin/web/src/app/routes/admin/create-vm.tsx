import type { AdminCreateVMResult } from "@/features/vms/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, CheckCircle2, Cpu, HardDrive, Layers, MemoryStick, Plus, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useClustersQuery } from "@/features/clusters/api";
import { useClusterProjectsQuery } from "@/features/projects/api";
import { useAdminCreateVMMutation } from "@/features/vms/api";
import { DEFAULT_OS_IMAGE, OsImagePicker, useOsImageLabel } from "@/features/vms/os-image-picker";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { MobileBottomBar } from "@/shared/components/ui/mobile-bottom-bar";
import { NumberStepper } from "@/shared/components/ui/number-stepper";
import { SecretReveal } from "@/shared/components/ui/secret-reveal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/create-vm")({
  component: CreateVMPage,
});

interface SpecPreset {
  label: string;
  hintKey: string;
  hintFallback: string;
  cpu: number;
  memory_mb: number;
  disk_gb: number;
}

const PRESETS: SpecPreset[] = [
  { label: "Small",  hintKey: "admin.specHintSmall",  hintFallback: "Dev / 测试",        cpu: 1, memory_mb: 1024,  disk_gb: 25 },
  { label: "Medium", hintKey: "admin.specHintMedium", hintFallback: "Web / 后台服务",   cpu: 2, memory_mb: 2048,  disk_gb: 50 },
  { label: "Large",  hintKey: "admin.specHintLarge",  hintFallback: "DB / 中等负载",    cpu: 4, memory_mb: 4096,  disk_gb: 100 },
  { label: "XLarge", hintKey: "admin.specHintXLarge", hintFallback: "重计算 / 高并发",  cpu: 8, memory_mb: 8192,  disk_gb: 200 },
];

const COUNT_PRESETS = [1, 4, 8, 16];

function CreateVMPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [preset, setPreset] = useState(1);
  const [osImage, setOsImage] = useState<string>(DEFAULT_OS_IMAGE);
  const [project, setProject] = useState("");
  const [count, setCount] = useState(1);
  const [namePrefix, setNamePrefix] = useState("");

  const { data: clustersData } = useClustersQuery();
  const clusters = clustersData?.clusters ?? [];
  const [clusterName, setClusterName] = useState<string>("");

  useEffect(() => {
    if (!clusterName && clusters.length > 0) {
      // clusterName 作 useClusterProjectsQuery 的 queryKey，需在状态而非 derived
      // eslint-disable-next-line react/set-state-in-effect
      setClusterName(clusters[0]!.name);
    }
  }, [clusterName, clusters]);

  const { data: projectsData } = useClusterProjectsQuery(clusterName);
  const projects = projectsData?.projects ?? [];

  useEffect(() => {
    if (project || projects.length === 0) return;
    const pref =
      projects.find((p) => p.name === "customers")
      ?? projects.find((p) => p.name === "default")
      ?? projects[0]!;
    // project 是 mutation payload + Select value，既要受用户选择控制也要随 cluster 切换重置
    // eslint-disable-next-line react/set-state-in-effect
    setProject(pref.name);
  }, [projects, project]);

  const [result, setResult] = useState<AdminCreateVMResult | null>(null);
  const createMutation = useAdminCreateVMMutation(clusterName);

  const selected = PRESETS[preset]!;
  const osLabel = useOsImageLabel(osImage);

  const totalCpu = selected.cpu * count;
  const totalMem = (selected.memory_mb / 1024) * count;
  const totalDisk = selected.disk_gb * count;

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
    <PageShell className="pb-24 md:pb-0">
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

      {result
        ? (
            <PageContent>
              <ResultPanel
                result={result}
                onDone={() => navigate({ to: "/admin/vms" })}
                onCreateAnother={() => setResult(null)}
              />
            </PageContent>
          )
        : (
            <PageContent>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 左：表单本体（4 段） */}
                <div className="lg:col-span-2 flex flex-col gap-6">
                  {clusters.length > 1 ? (
                    <FormSection
                      title={t("vm.cluster", { defaultValue: "集群" })}
                      hint={t("admin.clusterHint", { defaultValue: "VM 将创建在该集群" })}
                    >
                      <Select value={clusterName} onValueChange={(v) => setClusterName(String(v))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {clusters.map((c) => (
                            <SelectItem key={c.name} value={c.name}>
                              {c.display_name || c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormSection>
                  ) : null}

                  <FormSection
                    title={t("admin.computeTitle", { defaultValue: "规格 (Compute)" })}
                    hint={t("admin.computeHint", { defaultValue: "vCPU / 内存 / SSD 三件套，后续不可在线扩容" })}
                  >
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {PRESETS.map((p, i) => (
                        <SpecCard
                          key={p.label}
                          preset={p}
                          active={i === preset}
                          onSelect={() => setPreset(i)}
                          hint={t(p.hintKey, { defaultValue: p.hintFallback })}
                        />
                      ))}
                    </div>
                  </FormSection>

                  <FormSection
                    title={t("vm.osImage", { defaultValue: "系统镜像" })}
                    hint={t("admin.osImageHint", { defaultValue: "搜索发行版或版本快速定位" })}
                  >
                    <OsImagePicker
                      value={osImage}
                      onChange={setOsImage}
                      ariaLabel={t("vm.osImage", { defaultValue: "系统镜像" })}
                    />
                  </FormSection>

                  <FormSection
                    title={t("vm.project", { defaultValue: "项目" })}
                    hint={t("admin.projectHint", { defaultValue: "VM 落入该 Incus project，影响配额与隔离" })}
                  >
                    <Select
                      value={project || undefined}
                      onValueChange={(v) => setProject(String(v))}
                    >
                      <SelectTrigger disabled={!clusterName}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((p) => (
                          <SelectItem key={p.name} value={p.name}>
                            <span className="font-mono">{p.name}</span>
                            {p.description ? (
                              <span className="text-text-tertiary">— {p.description}</span>
                            ) : null}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormSection>

                  <FormSection
                    title={t("admin.identifyTitle", { defaultValue: "标识 (Identify)" })}
                    hint={t("admin.identifyHint", {
                      defaultValue: "数量与名称前缀。批量时每台分到独立 IP，名字 = 前缀 + 序号。",
                    })}
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-caption font-emphasis text-text-tertiary">
                          {t("admin.batchCount", { defaultValue: "数量" })}
                        </Label>
                        <NumberStepper
                          value={count}
                          onChange={setCount}
                          min={1}
                          max={16}
                          presets={COUNT_PRESETS}
                          ariaLabel={t("admin.batchCount", { defaultValue: "数量" })}
                        />
                        {count > 1 ? (
                          <p className="text-caption text-text-tertiary">
                            {t("admin.batchCountHint", {
                              defaultValue: "将一次性入队 {{n}} 个 VM job；每个独立 IP / 独立进度。",
                              n: count,
                            })}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="name-prefix" className="text-caption font-emphasis text-text-tertiary">
                          {t("admin.namePrefix", { defaultValue: "名称前缀（可选）" })}
                        </Label>
                        <Input
                          id="name-prefix"
                          value={namePrefix}
                          onChange={(e) => setNamePrefix(e.target.value)}
                          placeholder={t("admin.namePrefixPlaceholder", {
                            defaultValue: "留空：后端自动生成 vm-xxxxxx",
                          })}
                        />
                        {namePrefix && count > 1 ? (
                          <p className="text-caption text-text-tertiary">
                            <Tag size={12} aria-hidden="true" className="inline-block mr-1 align-text-bottom" />
                            {t("admin.namePreview", {
                              defaultValue: "示例：{{a}}, {{b}} … {{c}}",
                              a: `${namePrefix}-001`,
                              b: `${namePrefix}-002`,
                              c: `${namePrefix}-${String(count).padStart(3, "0")}`,
                            })}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </FormSection>
                </div>

                {/* 右：Summary（sticky） */}
                <aside className="lg:col-span-1">
                  <div className="lg:sticky lg:top-20 flex flex-col gap-3">
                    <SummaryPanel
                      cluster={clusters.find((c) => c.name === clusterName)?.display_name ?? clusterName}
                      cpu={selected.cpu}
                      memMb={selected.memory_mb}
                      diskGb={selected.disk_gb}
                      osLabel={osLabel}
                      project={project}
                      count={count}
                      totalCpu={totalCpu}
                      totalMem={totalMem}
                      totalDisk={totalDisk}
                    />

                    {createMutation.isError ? (
                      <Alert variant="error">
                        <AlertDescription>{(createMutation.error as Error).message}</AlertDescription>
                      </Alert>
                    ) : null}

                    {/* desktop CTA：只此一个，避免双 CTA 错位 */}
                    <Button
                      variant="primary"
                      className="w-full hidden md:flex"
                      disabled={submitDisabled}
                      onClick={submit}
                      data-testid="create-vm-submit"
                    >
                      <Plus size={14} aria-hidden="true" />
                      {createMutation.isPending
                        ? t("admin.creatingVm", { defaultValue: "创建中..." })
                        : count > 1
                          ? t("admin.createVmsCta", { defaultValue: "创建 {{n}} 台", n: count })
                          : t("admin.createVmTitle", { defaultValue: "新建 VM" })}
                    </Button>
                  </div>
                </aside>
              </div>
            </PageContent>
          )}

      {!result ? (
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
      ) : null}
    </PageShell>
  );
}

function FormSection({
  title,
  hint,
  children,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-emphasis text-foreground">{title}</h2>
        {hint ? <p className="text-caption text-text-tertiary">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SpecCard({
  preset,
  active,
  onSelect,
  hint,
}: {
  preset: SpecPreset;
  active: boolean;
  onSelect: () => void;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      data-testid={`spec-preset-${preset.label.toLowerCase()}`}
      className={cn(
        "relative flex flex-col gap-2 p-3 rounded-lg border-2 text-left transition-colors",
        active
          ? "border-primary bg-primary/15 shadow-sm"
          : "border-border bg-surface-1 hover:bg-surface-2",
      )}
    >
      {active ? (
        <Check
          size={14}
          aria-hidden="true"
          className="absolute top-2 right-2 text-accent"
        />
      ) : null}
      <div className="font-strong text-body text-foreground">{preset.label}</div>
      <div className="flex flex-col gap-0.5 font-mono tabular-nums text-caption">
        <SpecLine icon={<Cpu size={12} aria-hidden="true" />} value={`${preset.cpu} vCPU`} />
        <SpecLine icon={<MemoryStick size={12} aria-hidden="true" />} value={`${(preset.memory_mb / 1024).toFixed(0)} GB`} />
        <SpecLine icon={<HardDrive size={12} aria-hidden="true" />} value={`${preset.disk_gb} GB SSD`} />
      </div>
      <div className="text-caption text-text-tertiary">{hint}</div>
    </button>
  );
}

function SpecLine({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-text-secondary">
      <span className="text-text-tertiary">{icon}</span>
      <span>{value}</span>
    </div>
  );
}

function SummaryPanel({
  cluster,
  cpu,
  memMb,
  diskGb,
  osLabel,
  project,
  count,
  totalCpu,
  totalMem,
  totalDisk,
}: {
  cluster: string;
  cpu: number;
  memMb: number;
  diskGb: number;
  osLabel: string | undefined;
  project: string;
  count: number;
  totalCpu: number;
  totalMem: number;
  totalDisk: number;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <h3 className="text-base font-emphasis text-foreground">
          {t("common.summary", { defaultValue: "概要" })}
        </h3>

        <div className="flex flex-col gap-2 text-sm">
          <SummaryRow label={t("vm.cluster")} value={cluster || "—"} />
          <SummaryRow
            label={t("vm.config")}
            value={`${cpu} vCPU / ${(memMb / 1024).toFixed(0)} GB / ${diskGb} GB`}
          />
          <SummaryRow label={t("vm.osImage")} value={osLabel ?? "—"} />
          <SummaryRow label={t("vm.project")} value={project || "—"} />
          <SummaryRow label={t("vm.ip")} value={t("admin.ipAuto", { defaultValue: "自动分配" })} />
          <SummaryRow label={t("admin.batchCount", { defaultValue: "数量" })} value={`× ${count}`} />
        </div>

        {count > 1 ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-1 p-3">
            <div className="inline-flex items-center gap-1.5 text-caption font-emphasis text-text-tertiary">
              <Layers size={12} aria-hidden="true" />
              {t("admin.batchTotal", { defaultValue: "总计资源" })}
            </div>
            <div className="font-mono tabular-nums text-body text-foreground">
              {totalCpu} vCPU · {totalMem.toFixed(0)} GB · {totalDisk} GB
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
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

function ResultPanel({
  result,
  onDone,
  onCreateAnother,
}: {
  result: AdminCreateVMResult;
  onDone: () => void;
  onCreateAnother: () => void;
}) {
  const { t } = useTranslation();
  const isBatch = !!(result.items && result.items.length > 0);

  return (
    <Card className="border-status-success/30 bg-status-success/8">
      <CardContent className="flex flex-col gap-4 p-5">
        <header className="flex items-center gap-2">
          <CheckCircle2 size={18} className="text-status-success" aria-hidden="true" />
          <h2 className="text-body-emphasis font-emphasis text-status-success">
            {isBatch
              ? t("admin.vmsCreated", { defaultValue: "已入队 {{n}} 台 VM", n: result.items?.length ?? 0 })
              : t("admin.vmCreated", { defaultValue: "VM 创建成功" })}
          </h2>
        </header>

        {isBatch
          ? (
              <>
                <p className="text-caption text-text-tertiary">
                  {t("admin.batchProvisioningHint", {
                    defaultValue: "异步入队，进度可在「订单」/「VM 列表」逐台查看：",
                  })}
                </p>
                <div className="overflow-x-auto rounded-md border border-border bg-surface-1">
                  <table className="w-full text-caption">
                    <thead className="text-text-tertiary">
                      <tr>
                        <th className="px-3 py-2 text-left font-emphasis">{t("vm.name")}</th>
                        <th className="px-3 py-2 text-left font-emphasis">{t("vm.ip")}</th>
                        <th className="px-3 py-2 text-left font-emphasis">job</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items!.map((it) => (
                        <tr key={it.job_id} className="border-t border-border">
                          <td className="px-3 py-1.5 font-mono">{it.vm_name}</td>
                          <td className="px-3 py-1.5 font-mono">{it.ip}</td>
                          <td className="px-3 py-1.5 font-mono text-text-tertiary">#{it.job_id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SecretReveal label={t("vm.name")} value={result.vm_name ?? ""} inline={false} />
                  <SecretReveal label={t("vm.ip")} value={result.ip ?? ""} inline={false} autoMaskMs={0} />
                  {result.username ? (
                    <SecretReveal label={t("vm.username")} value={result.username} inline={false} />
                  ) : null}
                  {result.password ? (
                    <SecretReveal label={t("vm.password")} value={result.password} inline={false} />
                  ) : null}
                </div>
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
              </>
            )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCreateAnother}>
            {t("admin.createAnother", { defaultValue: "再创建一台" })}
          </Button>
          <Button variant="primary" onClick={onDone}>
            {t("admin.goToAllVms", { defaultValue: "前往 VM 列表" })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
