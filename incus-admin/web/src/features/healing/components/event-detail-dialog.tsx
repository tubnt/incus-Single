import { Dialog } from "@base-ui-components/react/dialog";
import { useTranslation } from "react-i18next";
import { useHealingEventDetailQuery } from "@/features/healing/api";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { capitalize, cn, formatDateTime } from "@/shared/lib/utils";

export function EventDetailDialog({
  id,
  onClose,
}: {
  id: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const open = id != null;
  const { data: event, isLoading } = useHealingEventDetailQuery(id);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-surface-elevated border border-border rounded-xl shadow-dialog p-6 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0">
          <Dialog.Title className="text-base font-emphasis mb-4">
            {t("ha.detailTitle", { id })}
          </Dialog.Title>
          {isLoading && <Skeleton className="h-32" />}
          {event && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <DetailField label={t("ha.colCluster")} value={event.cluster_name || `#${event.cluster_id}`} />
                <DetailField label={t("ha.colNode")} value={event.node_name} mono />
                <DetailField label={t("ha.colTrigger")} value={t(`ha.trigger${capitalize(event.trigger)}`)} />
                <DetailField label={t("ha.colStatus")} value={t(`ha.status${capitalize(event.status.replace(/_/g, ""))}`)} />
                <DetailField
                  label={t("ha.colTime")}
                  value={formatDateTime(event.started_at)}
                />
                <DetailField
                  label={t("ha.colDuration")}
                  value={event.duration_seconds != null ? `${event.duration_seconds}s` : "—"}
                />
                <DetailField
                  label={t("ha.colActor")}
                  value={event.actor_id ? `#${event.actor_id}` : "—"}
                />
              </div>
              {event.error && (
                <div className="rounded-md border border-status-error/30 bg-status-error/8 p-3 text-sm">
                  <div className="font-strong text-status-error mb-1">{t("ha.errorHeading")}</div>
                  <code className="text-caption break-all">{event.error}</code>
                </div>
              )}
              <div>
                <div className="text-sm font-emphasis mb-2">
                  {t("ha.evacuatedVMsHeading")} ({event.evacuated_vms?.length ?? 0})
                </div>
                {(event.evacuated_vms?.length ?? 0) === 0 ? (
                  <div className="text-xs text-muted-foreground">{t("ha.noVMsMoved")}</div>
                ) : (
                  <div className="border border-border rounded overflow-x-auto">
                    <table className="w-full text-xs [&_tbody>tr]:transition-colors [&_tbody>tr]:hover:bg-surface-1">
                      <thead className="bg-surface-1 border-b border-border">
                        <tr>
                          <th className="text-left px-3 py-1.5 text-label font-emphasis text-text-tertiary">ID</th>
                          <th className="text-left px-3 py-1.5 text-label font-emphasis text-text-tertiary">{t("ha.vmName")}</th>
                          <th className="text-left px-3 py-1.5 text-label font-emphasis text-text-tertiary">{t("ha.vmFrom")}</th>
                          <th className="text-left px-3 py-1.5 text-label font-emphasis text-text-tertiary">{t("ha.vmTo")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {event.evacuated_vms!.map((v) => (
                          <tr key={v.vm_id} className="border-t border-border">
                            <td className="px-3 py-1.5 font-mono">{v.vm_id}</td>
                            <td className="px-3 py-1.5 font-mono">{v.name}</td>
                            <td className="px-3 py-1.5 font-mono">{v.from_node}</td>
                            <td className="px-3 py-1.5 font-mono">{v.to_node}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="flex justify-end mt-6">
            <Dialog.Close className={cn("px-4 h-9 rounded-md text-sm font-emphasis bg-surface-1 border border-border hover:bg-surface-2 transition-colors")}>
              {t("common.close")}
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
