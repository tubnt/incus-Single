import type { NodeInfo, ProbeNodeResult } from "@/features/nodes/api";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useReducer } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useJobQuery } from "@/features/jobs/api";
import { JobProgress } from "@/features/jobs/components/job-progress";
import { useJobStream } from "@/features/jobs/use-job-stream";
import {
  useAddNodeMutation,
  useNodeCredentialsQuery,
  useProbeHostKeyMutation,
  useProbeNodeMutation,
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
import { Input, Textarea } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Stepper } from "@/shared/components/ui/stepper";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/admin/node-join")({
  component: NodeJoinPage,
});

/* ============================================================
 * PLAN-033 / OPS-039 — node add wizard.
 *
 * Stages:
 *   cred         operator picks credential + target host
 *   fingerprint  TOFU host-key confirmation
 *   confirm      review probe result + topology selection
 *   job          live SSE progress
 * ============================================================ */

type Stage = "cred" | "fingerprint" | "confirm" | "job";

type CredKind = "password" | "private_key" | "saved";

interface CredState {
  cluster: string;
  host: string;
  port: number;
  sshUser: string;
  kind: CredKind;
  password: string;
  keyData: string;
  savedID: number | null;
  savePersist: boolean;
  saveName: string;
}

interface FingerprintState {
  keyType: string;
  fingerprint: string;
  acknowledged: boolean;
}

interface ConfirmState {
  probeID: string;
  fingerprint: string;
  node: NodeInfo;
  nodeName: string;
  role: "osd" | "mon-mgr-osd";
  mgmtNIC: string;
  cephNIC: string;
  bridgeNIC: string;
  mgmtIP: string;
  cephPubIP: string;
  cephClusterIP: string;
  skipNetwork: boolean;
}

interface WizardState {
  stage: Stage;
  cred: CredState;
  fingerprint?: FingerprintState;
  confirm?: ConfirmState;
  jobID: number | null;
  lastError: string;
}

type Action =
  | { type: "cred/update"; patch: Partial<CredState> }
  | { type: "cred/reset" }
  | { type: "fingerprint/received"; key_type: string; fingerprint: string }
  | { type: "fingerprint/ack" }
  | { type: "probe/done"; result: ProbeNodeResult }
  | { type: "confirm/update"; patch: Partial<ConfirmState> }
  | { type: "stage/back"; to: Stage }
  | { type: "submit/started"; jobID: number }
  | { type: "error"; message: string };

const initialCred: CredState = {
  cluster: "cn-sz-01",
  host: "",
  port: 22,
  sshUser: "root",
  kind: "password",
  password: "",
  keyData: "",
  savedID: null,
  savePersist: false,
  saveName: "",
};

function initialState(): WizardState {
  return { stage: "cred", cred: initialCred, jobID: null, lastError: "" };
}

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "cred/update":
      return { ...state, cred: { ...state.cred, ...action.patch }, lastError: "" };
    case "cred/reset":
      return initialState();
    case "fingerprint/received":
      return {
        ...state,
        stage: "fingerprint",
        fingerprint: {
          keyType: action.key_type,
          fingerprint: action.fingerprint,
          acknowledged: false,
        },
        lastError: "",
      };
    case "fingerprint/ack":
      return state.fingerprint
        ? { ...state, fingerprint: { ...state.fingerprint, acknowledged: true } }
        : state;
    case "probe/done": {
      const node = action.result.node;
      const heuristics = computeHeuristics(node);
      return {
        ...state,
        stage: "confirm",
        confirm: {
          probeID: action.result.probe_id,
          fingerprint: action.result.fingerprint,
          node,
          nodeName: node.hostname || "",
          role: "osd",
          ...heuristics,
        },
        lastError: "",
      };
    }
    case "confirm/update":
      return state.confirm
        ? { ...state, confirm: { ...state.confirm, ...action.patch } }
        : state;
    case "stage/back":
      return { ...state, stage: action.to };
    case "submit/started":
      return { ...state, stage: "job", jobID: action.jobID };
    case "error":
      return { ...state, lastError: action.message };
    default:
      return state;
  }
}

const STORAGE_KEY = "node-join-wizard:v1";

function NodeJoinPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    if (typeof window === "undefined") return initialState();
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return initialState();
      const parsed = JSON.parse(raw) as WizardState;
      // never re-hydrate inline secrets
      const safe: WizardState = {
        ...parsed,
        cred: {
          ...parsed.cred,
          password: "",
          keyData: "",
        },
      };
      return safe;
    } catch {
      return initialState();
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const safe: WizardState = {
      ...state,
      cred: { ...state.cred, password: "", keyData: "" },
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  }, [state]);

  const probeHostKey = useProbeHostKeyMutation(state.cred.cluster);
  const probeNode = useProbeNodeMutation(state.cred.cluster);
  const addNode = useAddNodeMutation(state.cred.cluster);
  const credentialsQuery = useNodeCredentialsQuery();

  const stream = useJobStream(state.jobID);
  const jobQuery = useJobQuery(stream.terminal != null ? state.jobID : null);

  useEffect(() => {
    if (stream.terminal === "succeeded" && jobQuery.data?.job?.status === "succeeded") {
      const name = state.confirm?.nodeName ?? "";
      toast.success(t("admin.nodes.add.done", { defaultValue: "节点 {{name}} 已加入集群", name }));
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
    if (stream.terminal === "failed" || stream.terminal === "partial") {
      const lastFailed = stream.steps.slice().reverse().find((s) => s.status === "failed");
      toast.error(lastFailed?.detail ?? t("admin.nodes.add.failed", "节点加入失败，请查看进度卡详情"));
    }
  }, [stream.terminal, jobQuery.data, stream.steps, state.confirm?.nodeName, t]);

  const stepperItems = [
    { value: "cred", label: t("admin.nodes.add.wizard.stepCred", "凭据") },
    { value: "fingerprint", label: t("admin.nodes.add.wizard.stepFingerprint", "主机指纹") },
    { value: "confirm", label: t("admin.nodes.add.wizard.stepConfirm", "确认拓扑") },
    { value: "job", label: t("admin.nodes.add.wizard.stepJob", "执行进度") },
  ];

  const onConnect = () => {
    if (!state.cred.host) {
      dispatch({ type: "error", message: t("admin.nodes.add.errMissingIP", "公网 IP 必填") });
      return;
    }
    probeHostKey.mutate(
      { host: state.cred.host, port: state.cred.port, user: state.cred.sshUser },
      {
        onSuccess: (res) =>
          dispatch({ type: "fingerprint/received", key_type: res.key_type, fingerprint: res.fingerprint }),
        onError: (err) =>
          dispatch({ type: "error", message: (err as Error).message }),
      },
    );
  };

  const onProbe = () => {
    const c = state.cred;
    const fp = state.fingerprint;
    if (!fp || !fp.acknowledged) return;
    const body = {
      host: c.host,
      port: c.port,
      user: c.sshUser,
      accepted_host_key_sha256: fp.fingerprint,
      ...(c.kind === "saved" && c.savedID
        ? { credential_id: c.savedID }
        : c.kind === "password"
          ? { inline_kind: "password" as const, inline_password: c.password }
          : { inline_kind: "private_key" as const, inline_key_data: c.keyData }),
    };
    probeNode.mutate(body, {
      onSuccess: (res) => dispatch({ type: "probe/done", result: res }),
      onError: (err) => dispatch({ type: "error", message: (err as Error).message }),
    });
  };

  const onSubmit = () => {
    const c = state.cred;
    const cf = state.confirm;
    if (!cf) return;
    addNode.mutate(
      {
        node_name: cf.nodeName,
        public_ip: c.host,
        ssh_user: c.sshUser,
        role: cf.role,
        nic_primary: cf.mgmtNIC || undefined,
        nic_cluster: cf.cephNIC || undefined,
        bridge_name: cf.bridgeNIC || undefined,
        mgmt_ip: cf.mgmtIP || undefined,
        ceph_pub_ip: cf.cephPubIP || undefined,
        ceph_cluster_ip: cf.cephClusterIP || undefined,
        skip_network: cf.skipNetwork || undefined,
        probe_id: cf.probeID,
        accepted_host_key_sha256: cf.fingerprint,
        ...(c.kind === "saved" && c.savedID
          ? { credential_id: c.savedID }
          : c.kind === "password"
            ? { inline_kind: "password" as const, inline_password: c.password }
            : { inline_kind: "private_key" as const, inline_key_data: c.keyData }),
      },
      {
        onSuccess: (res) => {
          if (res.job_id) {
            dispatch({ type: "submit/started", jobID: res.job_id });
            toast.info(
              t("admin.nodes.add.enqueued", {
                defaultValue: "已入队，job #{{id}}",
                id: res.job_id,
              }),
            );
          }
        },
        onError: (err) => dispatch({ type: "error", message: (err as Error).message }),
      },
    );
  };

  return (
    <PageShell>
      <PageHeader
        title={t("admin.nodes.add.title", "添加节点")}
        actions={
          <div className="flex items-center gap-2">
            <Link
              to="/admin/node-credentials"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t("admin.nodes.add.wizard.manageCredentials", "管理凭据")}
            </Link>
            <Link
              to="/admin/nodes"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t("common.back", "返回")}
            </Link>
          </div>
        }
      />
      <PageContent>
        <Card>
          <CardHeader className="space-y-3">
            <CardTitle>{t("admin.nodes.add.wizard.title", "节点接入向导")}</CardTitle>
            <Stepper steps={stepperItems} current={state.stage} />
          </CardHeader>

          {state.stage === "cred" ? (
            <CredStep
              state={state.cred}
              credentials={credentialsQuery.data?.credentials ?? []}
              busy={probeHostKey.isPending}
              error={state.lastError}
              dispatch={dispatch}
              onConnect={onConnect}
              navigate={navigate}
            />
          ) : null}

          {state.stage === "fingerprint" && state.fingerprint ? (
            <FingerprintStep
              info={state.fingerprint}
              busy={probeNode.isPending}
              error={state.lastError}
              onAck={() => dispatch({ type: "fingerprint/ack" })}
              onBack={() => dispatch({ type: "stage/back", to: "cred" })}
              onProbe={onProbe}
            />
          ) : null}

          {state.stage === "confirm" && state.confirm ? (
            <ConfirmStep
              data={state.confirm}
              busy={addNode.isPending}
              error={state.lastError}
              dispatch={dispatch}
              onSubmit={onSubmit}
              onBack={() => dispatch({ type: "stage/back", to: "cred" })}
            />
          ) : null}

          {state.stage === "job" ? (
            <JobStep
              steps={stream.steps}
              terminal={stream.terminal}
              nodeName={state.confirm?.nodeName ?? ""}
            />
          ) : null}
        </Card>
      </PageContent>
    </PageShell>
  );
}

/* ============================================================
 *  Stage components
 * ============================================================ */

function CredStep({
  state, credentials, busy, error, dispatch, onConnect, navigate,
}: {
  state: CredState;
  credentials: { id: number; name: string; kind: string; fingerprint?: string }[];
  busy: boolean;
  error: string;
  dispatch: React.Dispatch<Action>;
  onConnect: () => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4">
      <FormField label={t("admin.nodes.add.cluster", "目标集群")}>
        <Select value={state.cluster} onValueChange={(v) => dispatch({ type: "cred/update", patch: { cluster: String(v) } })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cn-sz-01">cn-sz-01</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormField label={t("admin.nodes.add.publicIP", "公网 IP")} className="sm:col-span-2">
          <Input
            value={state.host}
            placeholder="202.151.179.231"
            onChange={(e) => dispatch({ type: "cred/update", patch: { host: e.target.value } })}
          />
        </FormField>
        <FormField label={t("admin.nodes.add.wizard.port", "SSH 端口")}>
          <Input
            type="number"
            value={state.port}
            onChange={(e) => dispatch({ type: "cred/update", patch: { port: Number(e.target.value) || 22 } })}
          />
        </FormField>
      </div>

      <FormField label={t("admin.nodes.add.sshUser", "SSH 用户（默认 root）")}>
        <Input
          value={state.sshUser}
          onChange={(e) => dispatch({ type: "cred/update", patch: { sshUser: e.target.value } })}
          placeholder="root"
        />
      </FormField>

      <div className="space-y-2">
        <Label>{t("admin.nodes.add.wizard.credKind", "凭据形式")}</Label>
        <div className="flex flex-wrap gap-2">
          {(["password", "private_key", "saved"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => dispatch({ type: "cred/update", patch: { kind } })}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm border transition-colors",
                state.kind === kind
                  ? "border-primary bg-primary/10 text-text-primary"
                  : "border-border bg-surface-1 text-text-secondary hover:bg-surface-2",
              )}
            >
              {kind === "password"
                ? t("admin.nodes.add.wizard.credPassword", "密码")
                : kind === "private_key"
                  ? t("admin.nodes.add.wizard.credPrivateKey", "私钥粘贴")
                  : t("admin.nodes.add.wizard.credSaved", "已存凭据")}
            </button>
          ))}
        </div>
      </div>

      {state.kind === "password" ? (
        <FormField label={t("admin.nodes.add.wizard.password", "SSH 密码")}>
          <Input
            type="password"
            value={state.password}
            autoComplete="off"
            onChange={(e) => dispatch({ type: "cred/update", patch: { password: e.target.value } })}
          />
          <PersistFields state={state} dispatch={dispatch} />
        </FormField>
      ) : null}

      {state.kind === "private_key" ? (
        <FormField label={t("admin.nodes.add.wizard.privateKey", "粘贴私钥（PEM）")}>
          <Textarea
            value={state.keyData}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----"
            spellCheck={false}
            autoComplete="off"
            rows={6}
            onChange={(e) => dispatch({ type: "cred/update", patch: { keyData: e.target.value } })}
          />
          <PersistFields state={state} dispatch={dispatch} />
        </FormField>
      ) : null}

      {state.kind === "saved" ? (
        <FormField label={t("admin.nodes.add.wizard.savedCred", "选择已保存凭据")}>
          <Select
            value={state.savedID ? String(state.savedID) : ""}
            onValueChange={(v) => dispatch({ type: "cred/update", patch: { savedID: Number(v) || null } })}
          >
            <SelectTrigger>
              <SelectValue>
                {state.savedID ? credentials.find((c) => c.id === state.savedID)?.name ?? null : t("admin.nodes.add.wizard.savedCredPlaceholder", "选择凭据")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {credentials.length === 0 ? (
                <SelectItem value="empty" disabled>
                  {t("admin.nodes.add.wizard.noSavedCreds", "暂无凭据，先去管理凭据页面创建")}
                </SelectItem>
              ) : null}
              {credentials.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name} · {c.kind === "password" ? t("admin.nodes.add.wizard.credPassword", "密码") : t("admin.nodes.add.wizard.credPrivateKey", "私钥粘贴")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {credentials.length === 0 ? (
            <button
              type="button"
              className="mt-2 text-caption text-accent hover:underline"
              onClick={() => navigate({ to: "/admin/node-credentials" })}
            >
              {t("admin.nodes.add.wizard.manageCredentials", "管理凭据")} →
            </button>
          ) : null}
        </FormField>
      ) : null}

      {error ? (
        <div className="rounded-md border border-status-error/30 bg-status-error/8 p-3 text-sm text-status-error">
          {error}
        </div>
      ) : null}

      <div className="rounded-md border border-status-warning/30 bg-status-warning/8 p-3 text-caption text-status-warning">
        {t(
          "admin.nodes.add.wizard.credSecurityNote",
          "密码在传输给 admin 后即用 AES-256-GCM 加密保存；建议改用 SSH key 后吊销密码并删除本条凭据。",
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Link
          to="/admin/nodes"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t("common.cancel", "取消")}
        </Link>
        <Button variant="primary" disabled={busy || !state.host} onClick={onConnect}>
          {busy ? t("admin.nodes.add.testing", "测试中...") : t("admin.nodes.add.wizard.connect", "连接并取指纹")}
        </Button>
      </div>
    </CardContent>
  );
}

function PersistFields({ state, dispatch }: { state: CredState; dispatch: React.Dispatch<Action> }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 mt-2">
      <label className="flex items-center gap-2 text-caption text-text-secondary">
        <input
          type="checkbox"
          checked={state.savePersist}
          className="size-4"
          onChange={(e) => dispatch({ type: "cred/update", patch: { savePersist: e.target.checked } })}
        />
        {t("admin.nodes.add.wizard.savePersist", "保存为命名凭据（加密入库）")}
      </label>
      {state.savePersist ? (
        <Input
          value={state.saveName}
          placeholder={t("admin.nodes.add.wizard.savePersistName", "凭据名（如 node6-deploy-key）") ?? ""}
          onChange={(e) => dispatch({ type: "cred/update", patch: { saveName: e.target.value } })}
        />
      ) : null}
    </div>
  );
}

function FingerprintStep({
  info, busy, error, onAck, onBack, onProbe,
}: {
  info: FingerprintState;
  busy: boolean;
  error: string;
  onAck: () => void;
  onBack: () => void;
  onProbe: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-4">
      <div className="rounded-md border border-border bg-surface-1 p-4 space-y-2">
        <div className="text-caption text-text-tertiary">{t("admin.nodes.add.wizard.keyType", "主机密钥类型")}</div>
        <div className="text-body-emphasis">{info.keyType}</div>
        <div className="text-caption text-text-tertiary mt-2">
          {t("admin.nodes.add.wizard.fingerprint", "SHA256 指纹")}
        </div>
        <div className="font-mono text-sm break-all">{info.fingerprint}</div>
      </div>
      <div className="rounded-md border border-status-warning/30 bg-status-warning/8 p-3 text-caption text-status-warning">
        {t(
          "admin.nodes.add.wizard.fingerprintNote",
          "首次添加节点必须确认主机密钥（防 MITM）。确认后 admin 会写入 known_hosts，后续严格校验。",
        )}
      </div>
      <label className="flex items-center gap-2 text-small">
        <input type="checkbox" checked={info.acknowledged} onChange={onAck} className="size-4" />
        {t("admin.nodes.add.wizard.fingerprintAck", "我已确认这是预期的目标主机")}
      </label>
      {error ? (
        <div className="rounded-md border border-status-error/30 bg-status-error/8 p-3 text-sm text-status-error">{error}</div>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t("common.back", "返回")}
        </Button>
        <Button variant="primary" disabled={!info.acknowledged || busy} onClick={onProbe}>
          {busy ? t("admin.nodes.add.testing", "测试中...") : t("admin.nodes.add.wizard.probe", "探测节点信息")}
        </Button>
      </div>
    </CardContent>
  );
}

function ConfirmStep({
  data, busy, error, dispatch, onSubmit, onBack,
}: {
  data: ConfirmState;
  busy: boolean;
  error: string;
  dispatch: React.Dispatch<Action>;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const node = data.node;
  return (
    <CardContent className="space-y-4">
      <SummaryGrid
        items={[
          [t("admin.nodes.add.wizard.detectedHostname", "Hostname"), node.hostname || "—"],
          [t("admin.nodes.add.wizard.detectedOS", "操作系统"), `${node.os.id ?? ""} ${node.os.version ?? ""}`.trim() || "—"],
          [t("admin.nodes.add.wizard.detectedKernel", "内核"), node.os.kernel ?? "—"],
          [t("admin.nodes.add.wizard.detectedCPU", "CPU"), `${node.cpu.cores ?? "?"} cores / ${node.cpu.threads ?? "?"} threads`],
          [t("admin.nodes.add.wizard.detectedMemory", "内存"), formatMemory(node.memory_kb)],
          [t("admin.nodes.add.wizard.detectedDisks", "磁盘"), `${node.disks.length} 块`],
        ]}
      />

      {node.incus_installed ? (
        <div className="rounded-md border border-status-error/30 bg-status-error/8 p-3 text-sm text-status-error">
          {t(
            "admin.nodes.add.wizard.warnIncusInstalled",
            "⚠ 节点已安装 Incus；加入会重置当前配置。请先确认节点尚未承载工作负载。",
          )}
        </div>
      ) : null}

      <FormField label={t("admin.nodes.add.nodeName", "节点名（如 node6）")}>
        <Input value={data.nodeName} onChange={(e) => dispatch({ type: "confirm/update", patch: { nodeName: e.target.value } })} />
      </FormField>

      <FormField label={t("admin.nodes.add.role", "Ceph 角色")}>
        <Select value={data.role} onValueChange={(v) => dispatch({ type: "confirm/update", patch: { role: v as ConfirmState["role"] } })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="osd">osd（仅存储）</SelectItem>
            <SelectItem value="mon-mgr-osd">mon-mgr-osd（含 MON）</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <NICTable interfaces={node.interfaces} data={data} dispatch={dispatch} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormField label={t("admin.nodes.add.mgmtIP", "mgmt IP")}>
          <Input value={data.mgmtIP} onChange={(e) => dispatch({ type: "confirm/update", patch: { mgmtIP: e.target.value } })} />
        </FormField>
        <FormField label={t("admin.nodes.add.cephPubIP", "Ceph public IP")}>
          <Input value={data.cephPubIP} onChange={(e) => dispatch({ type: "confirm/update", patch: { cephPubIP: e.target.value } })} />
        </FormField>
        <FormField label={t("admin.nodes.add.cephClusterIP", "Ceph cluster IP")}>
          <Input value={data.cephClusterIP} onChange={(e) => dispatch({ type: "confirm/update", patch: { cephClusterIP: e.target.value } })} />
        </FormField>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-1 p-3">
        <div className="text-small">
          <div className="font-emphasis">
            {t("admin.nodes.add.skipNetwork", "跳过网络配置（节点已由运维预配 IP / 路由 / 桥接）")}
          </div>
          <div className="text-caption text-text-tertiary mt-0.5">
            {t(
              "admin.nodes.add.wizard.skipNetworkHint",
              "推断结果：mgmt + 默认路由都已就位，建议保持开启。",
            )}
          </div>
        </div>
        <Switch checked={data.skipNetwork} onCheckedChange={(checked) => dispatch({ type: "confirm/update", patch: { skipNetwork: !!checked } })} />
      </label>

      {error ? (
        <div className="rounded-md border border-status-error/30 bg-status-error/8 p-3 text-sm text-status-error">{error}</div>
      ) : null}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t("common.back", "返回")}
        </Button>
        <Button variant="primary" disabled={busy || !data.nodeName} onClick={onSubmit}>
          {busy ? t("common.processing", "处理中...") : t("admin.nodes.add.submit", "开始添加")}
        </Button>
      </div>
    </CardContent>
  );
}

function NICTable({
  interfaces, data, dispatch,
}: {
  interfaces: NodeInfo["interfaces"];
  data: ConfirmState;
  dispatch: React.Dispatch<Action>;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label>{t("admin.nodes.add.wizard.nicTable", "网卡（探测自节点）")}</Label>
      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-caption">
          <thead className="bg-surface-1 text-text-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">{t("admin.nodes.add.wizard.nicName", "名称")}</th>
              <th className="px-3 py-2 text-left">{t("admin.nodes.add.wizard.nicKind", "类型")}</th>
              <th className="px-3 py-2 text-left">{t("admin.nodes.add.wizard.nicAddr", "IPv4")}</th>
              <th className="px-3 py-2 text-left">{t("admin.nodes.add.wizard.nicRoles", "角色")}</th>
            </tr>
          </thead>
          <tbody>
            {interfaces.map((iface) => (
              <tr key={iface.name} className="border-t border-border">
                <td className="px-3 py-2 font-mono">{iface.name}</td>
                <td className="px-3 py-2 text-text-secondary">{iface.kind}{iface.is_default_route ? " · default" : ""}</td>
                <td className="px-3 py-2 text-text-secondary">{(iface.addresses ?? []).join(", ") || "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <RoleChip
                      active={data.mgmtNIC === iface.name}
                      label={t("admin.nodes.add.wizard.roleMgmt", "mgmt")}
                      onClick={() => dispatch({ type: "confirm/update", patch: { mgmtNIC: iface.name } })}
                    />
                    <RoleChip
                      active={data.cephNIC === iface.name}
                      label={t("admin.nodes.add.wizard.roleCeph", "ceph")}
                      onClick={() => dispatch({ type: "confirm/update", patch: { cephNIC: iface.name } })}
                    />
                    <RoleChip
                      active={data.bridgeNIC === iface.name}
                      label={t("admin.nodes.add.wizard.roleBridge", "bridge")}
                      onClick={() => dispatch({ type: "confirm/update", patch: { bridgeNIC: iface.name } })}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-pill px-2 py-0.5 text-label border transition-colors",
        active
          ? "border-primary bg-primary/15 text-text-primary"
          : "border-border bg-surface-2 text-text-tertiary hover:bg-surface-3",
      )}
    >
      {label}
    </button>
  );
}

function JobStep({
  steps, terminal, nodeName,
}: {
  steps: ReturnType<typeof useJobStream>["steps"];
  terminal: ReturnType<typeof useJobStream>["terminal"];
  nodeName: string;
}) {
  const { t } = useTranslation();
  return (
    <CardContent className="space-y-3">
      <div className="text-body-emphasis">
        {t("admin.nodes.add.progressTitle", { defaultValue: "正在加入节点 {{name}}", name: nodeName })}
      </div>
      <JobProgress steps={steps} />
      {terminal != null ? (
        <div className="flex justify-end">
          <Link to="/admin/nodes" className={buttonVariants({ variant: "primary", size: "sm" })}>
            {t("common.done", "完成")}
          </Link>
        </div>
      ) : (
        <div className="text-caption text-text-tertiary">
          {t("admin.nodes.add.progressHint", "进度实时更新中。可关闭本页稍后回来查看")}
        </div>
      )}
    </CardContent>
  );
}

/* ============================================================
 * helpers
 * ============================================================ */

function FormField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SummaryGrid({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-md border border-border bg-surface-1 p-3">
          <div className="text-caption text-text-tertiary">{k}</div>
          <div className="text-small text-text-primary mt-1 break-words">{v}</div>
        </div>
      ))}
    </div>
  );
}

function formatMemory(kb: number): string {
  if (!kb) return "—";
  const gb = kb / (1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

function computeHeuristics(node: NodeInfo): {
  mgmtNIC: string;
  cephNIC: string;
  bridgeNIC: string;
  mgmtIP: string;
  cephPubIP: string;
  cephClusterIP: string;
  skipNetwork: boolean;
} {
  let mgmtNIC = "";
  let cephNIC = "";
  let bridgeNIC = "";
  let mgmtIP = "";
  let cephPubIP = "";
  let cephClusterIP = "";
  for (const iface of node.interfaces) {
    for (const a of iface.addresses ?? []) {
      const ip = a.split("/")[0] ?? "";
      if (ip.startsWith("10.0.10.") && !mgmtIP) {
        mgmtIP = ip;
        mgmtNIC = iface.name;
      }
      if (ip.startsWith("10.0.20.") && !cephPubIP) {
        cephPubIP = ip;
        cephNIC = iface.name;
      }
      if (ip.startsWith("10.0.30.") && !cephClusterIP) {
        cephClusterIP = ip;
      }
    }
    if (iface.is_default_route && !bridgeNIC) {
      bridgeNIC = iface.name;
    }
  }
  return {
    mgmtNIC,
    cephNIC,
    bridgeNIC,
    mgmtIP,
    cephPubIP,
    cephClusterIP,
    skipNetwork: !!mgmtIP && !!node.default_route,
  };
}
