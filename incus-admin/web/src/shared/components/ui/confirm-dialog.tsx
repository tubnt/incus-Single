import type {ReactNode} from "react";
import { createContext, use, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";

interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * 类型化确认（A1 / H 矩阵）：
   * 用户必须输入 `typeToConfirm` 字符串才能解锁确认按钮。
   * 适用：删 VM、强制清理、重装、Floating IP 转移、Shadow Login、降级 admin。
   */
  typeToConfirm?: string;
  typeToConfirmLabel?: string;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ConfirmState>({ open: false, message: "" });
  const [typed, setTyped] = useState("");
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setTyped("");
      setState({ ...opts, open: true });
    });
  }, []);

  const finish = useCallback((value: boolean) => {
    setState((s) => ({ ...s, open: false }));
    resolverRef.current?.(value);
    resolverRef.current = null;
  }, []);

  const value = useMemo(() => confirm, [confirm]);
  const requireType = !!state.typeToConfirm;
  const typedOk = !requireType || typed.trim() === state.typeToConfirm;

  return (
    <ConfirmContext value={value}>
      {children}
      <AlertDialog open={state.open} onOpenChange={(open) => { if (!open) finish(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {state.title ?? t("confirmDialog.defaultTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>{state.message}</AlertDialogDescription>
          </AlertDialogHeader>

          {requireType ? (
            <div className="mt-2 space-y-2">
              <label className="text-caption text-muted-foreground">
                {state.typeToConfirmLabel ??
                  t("confirmDialog.typeToConfirm", {
                    defaultValue: "请输入 {{name}} 以确认",
                    name: state.typeToConfirm,
                  })}
              </label>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={state.typeToConfirm}
                autoFocus
                className={cn(
                  "h-9 w-full rounded-md border bg-surface-1 px-3 text-sm",
                  "text-foreground placeholder:text-text-tertiary",
                  "focus:outline-none focus:border-[color:var(--accent)]",
                  typedOk
                    ? "border-status-success/40"
                    : "border-border",
                )}
              />
            </div>
          ) : null}

          <AlertDialogFooter>
            <Button variant="ghost" onClick={() => finish(false)}>
              {state.cancelLabel ?? t("confirmDialog.cancel")}
            </Button>
            <Button
              variant={state.destructive ? "destructive" : "primary"}
              disabled={!typedOk}
              onClick={() => finish(true)}
              autoFocus={!requireType}
            >
              {state.confirmLabel ?? t("confirmDialog.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = use(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within ConfirmDialogProvider");
  }
  return ctx;
}
