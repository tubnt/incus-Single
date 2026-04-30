import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useExecSSHMutation, useTestSSHMutation } from "@/features/nodes/api";
import {
  PageContent,
  PageHeader,
  PageShell,
} from "@/shared/components/page/page-shell";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Stepper } from "@/shared/components/ui/stepper";
import { Textarea } from "@/shared/components/ui/input";

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

  const steps = [
    { value: "prepare", label: t("admin.nodeJoin.step1") },
    { value: "ssh-test", label: t("admin.nodeJoin.step2") },
    { value: "join", label: t("admin.nodeJoin.step3") },
    { value: "verify", label: t("admin.nodeJoin.step4") },
  ];

  return (
    <PageShell>
      <PageHeader
        title={t("admin.nodeJoin.title")}
        description={t("admin.nodeJoin.desc")}
      />
      <PageContent>
        <Stepper
          current={step}
          steps={steps}
          onChange={(v) => setStep(v as Step)}
        />

        {step === "prepare" && (
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.nodeJoin.prepareTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground space-y-2">
                <p>{t("admin.nodeJoin.prepareIntro")}</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>{t("admin.nodeJoin.prepareOS")}</li>
                  <li>
                    {t("admin.nodeJoin.prepareInstall")}
                    <code className="ml-1 px-1.5 py-0.5 rounded bg-surface-2 text-xs font-mono">
                      curl -fsSL https://pkgs.zabbly.com/get/incus-stable | sudo bash
                    </code>
                  </li>
                  <li>{t("admin.nodeJoin.prepareNetwork")}</li>
                  <li>{t("admin.nodeJoin.prepareSSH")}</li>
                </ol>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="node-join-host">{t("admin.nodeJoin.newNodeIp")}</Label>
                  <Input
                    id="node-join-host"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder={t("admin.nodeJoin.newNodeIpPlaceholder")}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="node-join-name">{t("admin.nodeJoin.nodeName")}</Label>
                  <Input
                    id="node-join-name"
                    value={nodeName}
                    onChange={(e) => setNodeName(e.target.value)}
                    placeholder={t("admin.nodeJoin.nodeNamePlaceholder")}
                    className="font-mono"
                  />
                </div>
              </div>
              <Button
                variant="primary"
                onClick={() => setStep("ssh-test")}
                disabled={!host || !nodeName}
              >
                {t("admin.nodeJoin.nextTestSsh")}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "ssh-test" && (
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.nodeJoin.sshTestTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("admin.nodeJoin.sshTestDescPrefix")}{" "}
                <code className="font-mono">{host}</code>{" "}
                {t("admin.nodeJoin.sshTestDescSuffix")}
              </p>
              <Button
                variant="primary"
                onClick={runSSHTest}
                disabled={sshTestMutation.isPending}
              >
                {sshTestMutation.isPending ? t("admin.nodeJoin.sshTesting") : t("admin.nodeJoin.sshTestBtn")}
              </Button>
              {sshOutput && (
                <pre className="p-3 text-xs font-mono bg-black text-green-400 rounded overflow-x-auto whitespace-pre-wrap max-h-48">
                  {sshOutput}
                </pre>
              )}
            </CardContent>
          </Card>
        )}

        {step === "join" && (
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.nodeJoin.joinTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("admin.nodeJoin.joinHintPrefix")}{" "}
                <code className="font-mono">incus cluster add {nodeName}</code>{" "}
                {t("admin.nodeJoin.joinHintSuffix")}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  onClick={runGenerateToken}
                  disabled={execMutation.isPending}
                >
                  {execMutation.isPending ? t("admin.nodeJoin.joinPending") : t("admin.nodeJoin.joinBtn")}
                </Button>
                <span className="text-xs text-muted-foreground self-center">{t("admin.nodeJoin.joinOrPaste")}</span>
              </div>
              <Textarea
                value={joinToken}
                onChange={(e) => setJoinToken(e.target.value)}
                placeholder={t("admin.nodeJoin.joinPlaceholder")}
                rows={3}
                className="font-mono text-xs"
              />
              {joinToken && (
                <Button
                  variant="primary"
                  onClick={() => setStep("verify")}
                >
                  {t("admin.nodeJoin.nextVerify")}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {step === "verify" && (
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.nodeJoin.verifyTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
                <Button
                  variant="subtle"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `sudo incus admin init --preseed <<EOF\ncluster:\n  enabled: true\n  server_name: ${nodeName}\n  cluster_token: "${joinToken}"\nEOF`,
                    );
                    toast.success(t("admin.nodeJoin.copied"));
                  }}
                >
                  {t("admin.nodeJoin.copy")}
                </Button>
              </div>
              <div className="text-sm text-muted-foreground">
                <p>{t("admin.nodeJoin.verifyCheck")}</p>
                <code className="block mt-1 px-3 py-2 bg-surface-2 rounded text-xs font-mono">
                  incus cluster list
                </code>
              </div>
              <Link
                to="/admin/nodes"
                className={buttonVariants({ variant: "primary" })}
              >
                {t("admin.nodeJoin.backToList")}
              </Link>
            </CardContent>
          </Card>
        )}
      </PageContent>
    </PageShell>
  );
}
