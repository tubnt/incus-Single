import type { SelectHTMLAttributes } from "react";
import { imageValueFromTemplate, useOSTemplatesQuery } from "@/features/templates/api";

// Last-known fallback kept in sync with migration 009 seed. Used only while
// the /portal/os-templates query resolves, so the picker can render a stable
// default during first paint. Once the query finishes, the DB-backed list
// replaces it.
const FALLBACK = [
  { value: "images:ubuntu/24.04/cloud", label: "Ubuntu 24.04 LTS" },
  { value: "images:ubuntu/22.04/cloud", label: "Ubuntu 22.04 LTS" },
  { value: "images:debian/12/cloud",    label: "Debian 12" },
  { value: "images:rockylinux/9/cloud", label: "Rocky Linux 9" },
] as const;

export const DEFAULT_OS_IMAGE = FALLBACK[0].value;

interface OsImagePickerProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  value: string;
  onChange: (v: string) => void;
}

export function OsImagePicker({ value, onChange, className, disabled, ...rest }: OsImagePickerProps) {
  const { data, isLoading } = useOSTemplatesQuery();
  const options = data?.templates?.length
    ? data.templates.map((t) => ({ value: imageValueFromTemplate(t), label: t.name }))
    : FALLBACK;

  return (
    <select
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || isLoading}
      className={className ?? "w-full px-2 py-1.5 text-xs rounded border border-border bg-card"}
    >
      {options.map((img) => (
        <option key={img.value} value={img.value}>{img.label}</option>
      ))}
    </select>
  );
}

// Look up the human label for a picker value. Runs the same query so callers
// only hit the network once regardless of how many lookups they do.
export function useOsImageLabel(value: string): string | undefined {
  const { data } = useOSTemplatesQuery();
  const list = data?.templates ?? [];
  const match = list.find((t) => imageValueFromTemplate(t) === value);
  if (match) return match.name;
  return FALLBACK.find((i) => i.value === value)?.label;
}
