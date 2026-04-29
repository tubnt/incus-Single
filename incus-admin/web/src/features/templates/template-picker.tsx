import type { SelectHTMLAttributes } from "react";
import { useOSTemplatesQuery } from "./api";

// TemplatePicker emits the template slug (e.g. "ubuntu-24-04") — the wire
// format PLAN-021 Phase B reinstall/create APIs prefer. Separate from
// OsImagePicker (which still emits "images:<source>") so we can migrate
// callers one-by-one without changing two semantics at once.
//
// Defaults to the first enabled template while the query is loading; callers
// that need a stable default can pass value=""and let the picker fill it.
interface TemplatePickerProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  value: string;
  onChange: (slug: string) => void;
}

export function TemplatePicker({ value, onChange, className, disabled, ...rest }: TemplatePickerProps) {
  const { data, isLoading } = useOSTemplatesQuery();
  const templates = data?.templates ?? [];

  return (
    <select
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || isLoading || templates.length === 0}
      className={className ?? "w-full px-2 py-1.5 text-xs rounded border border-border bg-card"}
    >
      {templates.length === 0 && (
        <option value="">{isLoading ? "..." : "no templates"}</option>
      )}
      {templates.map((t) => (
        <option key={t.slug} value={t.slug}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

// DEFAULT_TEMPLATE_SLUG mirrors migration 009 seed ordering. Reinstall dialogs
// use this as the initial picker value so the select renders something stable
// before the templates query resolves.
export const DEFAULT_TEMPLATE_SLUG = "ubuntu-24-04";
