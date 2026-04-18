import type { AuditLog } from "./api";

export function targetLabel(log: Pick<AuditLog, "target_type" | "target_id" | "details">): string {
  try {
    const d = JSON.parse(log.details || "{}");
    const human =
      d?.name ??
      d?.target ??
      d?.vm ??
      d?.vm_name ??
      d?.host ??
      (d?.osd_id != null ? `osd.${d.osd_id}` : undefined);
    if (typeof human === "string" && human) return `${log.target_type} ${human}`;
    if (typeof human === "number") return `${log.target_type} ${human}`;
  } catch {
    // details is not JSON — fall through
  }
  if (log.target_id && log.target_id > 0) return `${log.target_type} #${log.target_id}`;
  return log.target_type || "—";
}

export function stripCidrSuffix(ip: string | undefined | null): string {
  if (!ip) return "—";
  return ip.replace(/\/(32|128)$/, "");
}
