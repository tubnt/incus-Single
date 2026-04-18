import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useExecSSHMutation, useTestSSHMutation } from "@/features/nodes/api";

export const Route = createFileRoute("/admin/node-join")({
  component: NodeJoinWizard,
});

type Step = "prepare" | "ssh-test" | "join" | "verify";

function NodeJoinWizard() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("prepare");
  const [host, setHost] = useState("");
  const [nodeName, setNodeName] = useState("");
  const [sshOutput, setSSHOutput] = useState("");
  const [joinToken, setJoinToken] = useState("");

  const sshTestMutation = useTestSSHMutation();
  const execMutation = useExecSSHMutation();

  const runSSHTest = () =>
    sshTestMutation.mutate(host, {
      onSuccess: (data) => {
        setSSHOutput(data.output + (data.error ? `\nError: ${data.error}` : ""));
        if (data.status === "ok") {
          toast.success(t("admin.nodeJoin.sshSuccess"));
          setStep("join");
        } else {
          toast.error(t("admin.nodeJoin.sshFailed"));
        }
      },
    });

  const runGenerateToken = () =>
    execMutation.mutate(
      { host, command: `incus cluster add ${nodeName}` },
      {
        onSuccess: (data) => {
          if (data.output) {
            setJoinToken(data.output.trim());
            toast.success(t("admin.nodeJoin.tokenGenerated"));
            setStep("verify");
          }
        },
        onError: () => toast.error(t("admin.nodeJoin.tokenFailed")),
      },
    );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{t("admin.nodeJoin.title")}</h1>
      <p className="text-sm text-muted-foreground mb-6">{t("admin.nodeJoin.desc")}</p>

      <div className="flex gap-2 mb-8">
        {(
          [
            ["prepare", t("admin.nodeJoin.step1")],
            ["ssh-test", t("admin.nodeJoin.step2")],
            ["join", t("admin.nodeJoin.step3")],
            ["verify", t("admin.nodeJoin.step4")],
          ] as const
        ).map(([s, label]) => (
          <button
            key={s}
            onClick={() => setStep(s as Step)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition ${
              step === s
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {step === "prepare" && (
        <div className="border border-border rounded-lg bg-card p-6 space-y-4">
          <h3 className="font-semibold">{t("admin.nodeJoin.prepareTitle")}</h3>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>{t("admin.nodeJoin.prepareIntro")}</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>{t("admin.nodeJoin.prepareOS")}</li>
              <li>
                {t("admin.nodeJoin.prepareInstall")}
                <code className="ml-1 px-1.5 py-0.5 rounded bg-muted text-xs font-mono">
                  curl -fsSL https://pkgs.zabbly.com/get/incus-stable | sudo bash
                </code>
              </li>
              <li>{t("admin.nodeJoin.prepareNetwork")}</li>
              <li>{t("admin.nodeJoin.prepareSSH")}</li>
            </ol>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">{t("admin.nodeJoin.newNodeIp")}</label>
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder={t("admin.nodeJoin.newNodeIpPlaceholder")}
                className="w-full mt-1 px-3 py-2 rounded border border-border bg-card text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("admin.nodeJoin.nodeName")}</label>
              <input
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                placeholder={t("admin.nodeJoin.nodeNamePlaceholder")}
                className="w-full mt-1 px-3 py-2 rounded border border-border bg-card text-sm font-mono"
              />
            </div>
          </div>
          <button
            onClick={() => setStep("ssh-test")}
            disabled={!host || !nodeName}
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
          >
            {t("admin.nodeJoin.nextTestSsh")}
          </button>
        </div>
      )}

      {step === "ssh-test" && (
        <div className="border border-border rounded-lg bg-card p-6 space-y-4">
          <h3 className="font-semibold">{t("admin.nodeJoin.sshTestTitle")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("admin.nodeJoin.sshTestDescPrefix")}{" "}
            <code className="font-mono">{host}</code>{" "}
            {t("admin.nodeJoin.sshTestDescSuffix")}
          </p>
          <button
            onClick={runSSHTest}
            disabled={sshTestMutation.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
          >
            {sshTestMutation.isPending ? t("admin.nodeJoin.sshTesting") : t("admin.nodeJoin.sshTestBtn")}
          </button>
          {sshOutput && (
            <pre className="p-3 text-xs font-mono bg-black text-green-400 rounded overflow-x-auto whitespace-pre-wrap max-h-48">
              {sshOutput}
            </pre>
          )}
        </div>
      )}

      {step === "join" && (
        <div className="border border-border rounded-lg bg-card p-6 space-y-4">
          <h3 className="font-semibold">{t("admin.nodeJoin.joinTitle")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("admin.nodeJoin.joinHintPrefix")}{" "}
            <code className="font-mono">incus cluster add {nodeName}</code>{" "}
            {t("admin.nodeJoin.joinHintSuffix")}
          </p>
          <div className="flex gap-2">
            <button
              onClick={runGenerateToken}
              disabled={execMutation.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50"
            >
              {execMutation.isPending ? t("admin.nodeJoin.joinPending") : t("admin.nodeJoin.joinBtn")}
            </button>
            <span className="text-xs text-muted-foreground self-center">{t("admin.nodeJoin.joinOrPaste")}</span>
          </div>
          <textarea
            value={joinToken}
            onChange={(e) => setJoinToken(e.target.value)}
            placeholder={t("admin.nodeJoin.joinPlaceholder")}
            rows={3}
            className="w-full px-3 py-2 rounded border border-border bg-card text-xs font-mono"
          />
          {joinToken && (
            <button
              onClick={() => setStep("verify")}
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium"
            >
              {t("admin.nodeJoin.nextVerify")}
            </button>
          )}
        </div>
      )}

      {step === "verify" && (
        <div className="border border-border rounded-lg bg-card p-6 space-y-4">
          <h3 className="font-semibold">{t("admin.nodeJoin.verifyTitle")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("admin.nodeJoin.verifyIntroPrefix")}{" "}
            <code className="font-mono">{host}</code>{" "}
            {t("admin.nodeJoin.verifyIntroSuffix")}
          </p>
          <div className="relative">
            <pre className="p-3 text-xs font-mono bg-black text-green-400 rounded overflow-x-auto whitespace-pre-wrap">
              {`sudo incus admin init --preseed <<EOF
cluster:
  enabled: true
  server_name: ${nodeName}
  cluster_token: "${joinToken}"
EOF`}
            </pre>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  `sudo incus admin init --preseed <<EOF\ncluster:\n  enabled: true\n  server_name: ${nodeName}\n  cluster_token: "${joinToken}"\nEOF`,
                );
                toast.success(t("admin.nodeJoin.copied"));
              }}
              className="absolute top-2 right-2 px-2 py-1 text-xs bg-muted/80 rounded hover:bg-muted"
            >
              {t("admin.nodeJoin.copy")}
            </button>
          </div>
          <div className="text-sm text-muted-foreground">
            <p>{t("admin.nodeJoin.verifyCheck")}</p>
            <code className="block mt-1 px-3 py-2 bg-muted rounded text-xs font-mono">
              incus cluster list
            </code>
          </div>
          <a
            href="/admin/nodes"
            className="inline-block px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:opacity-90"
          >
            {t("admin.nodeJoin.backToList")}
          </a>
        </div>
      )}
    </div>
  );
}
