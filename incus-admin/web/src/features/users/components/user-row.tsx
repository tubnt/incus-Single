import type { User } from "@/shared/lib/auth";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { formatCurrency } from "@/shared/lib/utils";

/**
 * UserRow（PLAN-034 P1-C 重构）：行内不再展开充值/配额表单——所有详细操作
 * 走 UserDetailSheet 抽屉。这样切换其他用户时输入不会重置，且 toolbar 留出
 * 视觉空间给批量充值。
 */
export function UserRow({
  user,
  selected,
  onSelect,
  onOpen,
}: {
  user: User;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();

  return (
    <TableRow>
      <TableCell className="w-10">
        <Checkbox
          checked={selected}
          onCheckedChange={onSelect}
          aria-label={`Select user ${user.email}`}
        />
      </TableCell>
      <TableCell>{user.id}</TableCell>
      <TableCell className="font-mono text-xs">{user.email}</TableCell>
      <TableCell className="text-text-tertiary">{user.role}</TableCell>
      <TableCell className="text-right font-mono">
        {formatCurrency(user.balance)}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" onClick={onOpen}>
          {t("admin.users.openDetail", { defaultValue: "详情 / 充值" })}
        </Button>
      </TableCell>
    </TableRow>
  );
}
