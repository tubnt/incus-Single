import type { OSTemplate } from "@/features/templates/api";
import { Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { imageValueFromTemplate, useOSTemplatesQuery } from "@/features/templates/api";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

// Last-known fallback kept in sync with migration 009 seed. Used only while
// the /portal/os-templates query resolves, so the picker can render a stable
// default during first paint. Once the query finishes, the DB-backed list
// replaces it.
const FALLBACK_TEMPLATES = [
  { source: "ubuntu/24.04/cloud", name: "Ubuntu 24.04 LTS" },
  { source: "ubuntu/22.04/cloud", name: "Ubuntu 22.04 LTS" },
  { source: "debian/12/cloud",    name: "Debian 12" },
  { source: "rockylinux/9/cloud", name: "Rocky Linux 9" },
] as const;

const FALLBACK_VALUE = (t: { source: string }) => `images:${t.source}`;
export const DEFAULT_OS_IMAGE = FALLBACK_VALUE(FALLBACK_TEMPLATES[0]);

interface OsImagePickerProps {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  disabled?: boolean;
  /** Optional aria-label for the trigger when no <Label> is wired. */
  ariaLabel?: string;
}

interface NormalizedOption {
  value: string;
  label: string;
  family: string;
  version: string;
  source: string;
}

/**
 * Detect distro family from `source` like "ubuntu/24.04/cloud".
 * The first path segment names the family; we map common aliases to a
 * presentation name. Anything unknown lands in "Other".
 */
const FAMILY_DISPLAY: Record<string, string> = {
  ubuntu: "Ubuntu",
  debian: "Debian",
  rockylinux: "Rocky Linux",
  almalinux: "AlmaLinux",
  fedora: "Fedora",
  centos: "CentOS",
  opensuse: "openSUSE",
  archlinux: "Arch Linux",
  alpine: "Alpine",
  oracle: "Oracle Linux",
};

const FAMILY_ORDER = [
  "Ubuntu", "Debian", "Rocky Linux", "AlmaLinux", "Fedora", "CentOS",
  "openSUSE", "Arch Linux", "Alpine", "Oracle Linux", "Other",
];

function normalize(t: Pick<OSTemplate, "name" | "source">): NormalizedOption {
  const value = `images:${t.source}`;
  const head = (t.source.split("/")[0] ?? "").toLowerCase();
  const family = FAMILY_DISPLAY[head] ?? "Other";
  const version = t.source.split("/").slice(1).join(" / ");
  return { value, label: t.name, family, version, source: t.source };
}

export function OsImagePicker({ value, onChange, className, disabled, ariaLabel }: OsImagePickerProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useOSTemplatesQuery();
  const [open, setOpen] = useState(false);

  const options: NormalizedOption[] = useMemo(() => {
    const list = data?.templates?.length ? data.templates : FALLBACK_TEMPLATES;
    return list.map(normalize);
  }, [data]);

  const grouped = useMemo(() => {
    const groups = new Map<string, NormalizedOption[]>();
    for (const o of options) {
      const arr = groups.get(o.family) ?? [];
      arr.push(o);
      groups.set(o.family, arr);
    }
    return FAMILY_ORDER
      .map((fam) => [fam, groups.get(fam) ?? []] as const)
      .filter(([, items]) => items.length > 0);
  }, [options]);

  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled || isLoading}
            className={cn(
              "inline-flex h-9 w-full items-center justify-between gap-2 rounded-md",
              "border border-border bg-surface-1 px-3 py-1.5 text-sm",
              "text-foreground transition-colors hover:bg-surface-2",
              "focus:outline-none focus:border-ring",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              className,
            )}
          >
            <span className="truncate text-left">
              {selected
                ? selected.label
                : isLoading
                  ? t("common.loading", { defaultValue: "加载中..." })
                  : t("vm.osImagePlaceholder", { defaultValue: "选择系统镜像" })}
            </span>
            <ChevronDown size={14} className="shrink-0 text-text-tertiary" aria-hidden="true" />
          </button>
        }
      />
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-(--anchor-width) min-w-72 p-0"
      >
        <Command
          filter={(filterValue, search) => {
            // Match against label + source so users can type "24.04" or "rocky"
            const lower = filterValue.toLowerCase();
            return lower.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput
            placeholder={t("vm.osImageSearch", { defaultValue: "搜索发行版 / 版本" })}
          />
          <CommandList>
            <CommandEmpty>{t("common.noResults", { defaultValue: "无匹配结果" })}</CommandEmpty>
            {grouped.map(([family, items]) => (
              <CommandGroup key={family} heading={family}>
                {items.map((o) => {
                  const active = o.value === value;
                  return (
                    <CommandItem
                      key={o.value}
                      value={`${o.label} ${o.source}`}
                      onSelect={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                    >
                      <span className="flex-1 truncate">{o.label}</span>
                      <span className="ml-2 font-mono text-caption text-text-tertiary">
                        {o.version}
                      </span>
                      {active ? <Check size={14} className="ml-2 text-accent" aria-hidden="true" /> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Look up the human label for a picker value. Runs the same query so callers
// only hit the network once regardless of how many lookups they do.
export function useOsImageLabel(value: string): string | undefined {
  const { data } = useOSTemplatesQuery();
  const list = data?.templates ?? [];
  const match = list.find((tpl) => imageValueFromTemplate(tpl) === value);
  if (match) return match.name;
  const fb = FALLBACK_TEMPLATES.find((tpl) => FALLBACK_VALUE(tpl) === value);
  return fb?.name;
}
