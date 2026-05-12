import { useTranslation } from "react-i18next";
import { formatNodeStatus, isStatus, isStatusOneOf } from "@/shared/lib/status-i18n";
import { cn } from "@/shared/lib/utils";
import { useAdminNodesQuery } from "./api";

export interface NodePickerProps {
  clusterName: string;
  value: string;
  onChange: (nodeName: string) => void;
  excludeNodes?: string[];
  className?: string;
  placeholder?: string;
}

export function NodePicker({
  clusterName,
  value,
  onChange,
  excludeNodes = [],
  className,
  placeholder,
}: NodePickerProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useAdminNodesQuery();
  const nodes = (data?.nodes ?? []).filter(
    (n) => (!clusterName || n.cluster === clusterName) && !excludeNodes.includes(n.server_name),
  );

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={isLoading}
      className={cn("w-full px-3 py-2 rounded border border-border bg-card text-sm disabled:opacity-50", className)}
    >
      <option value="" disabled>
        {placeholder ?? t("node.select", { defaultValue: "选择节点" })}
      </option>
      {nodes.map((n) => {
        // Session-2 N-06 / PLAN-051 §2-I：归一比较代替大小写敏感的多 OR 链
        const online = isStatusOneOf(n.status, "Online", "Evacuated");
        const evacuated = isStatus(n.status, "Evacuated");
        return (
          <option key={`${n.cluster}:${n.server_name}`} value={n.server_name}>
            {n.server_name}
            {evacuated ? ` — ${formatNodeStatus(t, "Evacuated")}` : online ? "" : ` — ${formatNodeStatus(t, n.status)}`}
          </option>
        );
      })}
    </select>
  );
}
