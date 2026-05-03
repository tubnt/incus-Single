import type { User } from "@/shared/lib/auth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Textarea } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { http } from "@/shared/lib/http";

export function ShadowLoginDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: User;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setReason("");
    setSubmitting(false);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const resp = await http.post<{ redirect_url: string }>(
        `/admin/users/${user.id}/shadow-login`,
        { reason: trimmed },
      );
      // 服务端 OIDC 跳转，必须用 window.location.href
      window.location.href = resp.redirect_url;
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("shadow.confirmTitle", { defaultValue: "Shadow Login 确认" })}
          </DialogTitle>
          <DialogDescription>
            {t("shadow.reasonWarning", {
              defaultValue:
                "你将以 {{email}} 的身份登入，所有操作都会按 admin shadow 审计记录。请填写本次操作原因。",
              email: user.email,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`shadow-reason-${user.id}`} required>
            {t("shadow.reasonLabel", {
              defaultValue: "原因（必填，审计记录用）",
            })}
          </Label>
          <Textarea
            id={`shadow-reason-${user.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            autoFocus
            data-testid={`shadow-reason-${user.id}`}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || submitting}
            onClick={submit}
            data-testid={`shadow-submit-${user.id}`}
          >
            {submitting
              ? "..."
              : t("shadow.submit", { defaultValue: "确认登入" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
