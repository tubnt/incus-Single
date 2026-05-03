import type { TFunction } from "i18next";

/**
 * 后端 enum 字符串 → i18n 文案映射。
 * 后端返回的 status / message 是英文常量字符串（如 `Running`, `Online`,
 * `Fully operational`），UI 需要做本地化展示但不能改后端协议。统一在此包装。
 *
 * 约定：i18n key 缺失时回退原值，避免新 enum 出现时 UI 显示空白。
 */

/** VM 实例状态 — `Running` / `Stopped` / `Frozen` / `Rescue` / `Starting` 等 */
export function formatVmStatus(t: TFunction, status: string | null | undefined): string {
  if (!status) return "—";
  const key = `vm.statusValue.${status.toLowerCase()}`;
  return t(key, { defaultValue: status });
}

/** 节点状态 — `Online` / `Offline` / `Evacuated` 等（后端可能 `ONLINE` 大写） */
export function formatNodeStatus(t: TFunction, status: string | null | undefined): string {
  if (!status) return "—";
  const key = `admin.nodes.statusValue.${status.toLowerCase()}`;
  return t(key, { defaultValue: status });
}

/** HA / 节点 message 文案 — 后端常量 e.g. `Fully operational`、`Cluster healthy` */
export function formatNodeMessage(t: TFunction, msg: string | null | undefined): string {
  if (!msg) return "";
  // 后端 message 是自由文本，仅命中已知常量做映射
  const map: Record<string, string> = {
    "Fully operational": "admin.nodes.messageFullyOperational",
    "Cluster healthy": "admin.nodes.messageClusterHealthy",
  };
  const key = map[msg];
  return key ? t(key, { defaultValue: msg }) : msg;
}

/** HA 启用状态 */
export function formatHaEnabled(t: TFunction, enabled: boolean): string {
  return enabled
    ? t("ha.enabled", { defaultValue: "已启用" })
    : t("ha.disabled", { defaultValue: "未启用" });
}

/** 工单状态 — `open` / `answered` / `pending` / `closed` */
export function formatTicketStatus(t: TFunction, status: string | null | undefined): string {
  if (!status) return "—";
  const key = `ticket.statusValue.${status.toLowerCase()}`;
  return t(key, { defaultValue: status });
}

/** 订单状态 — `pending` / `paid` / `provisioning` / `provisioned` / `active` / `expired` / `cancelled` */
export function formatOrderStatus(t: TFunction, status: string | null | undefined): string {
  if (!status) return "—";
  const key = `order.statusValue.${status.toLowerCase()}`;
  return t(key, { defaultValue: status });
}

/** 发票状态 — `paid` / `open` / `void` */
export function formatInvoiceStatus(t: TFunction, status: string | null | undefined): string {
  if (!status) return "—";
  const key = `invoice.statusValue.${status.toLowerCase()}`;
  return t(key, { defaultValue: status });
}
