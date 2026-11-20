"use client";

/** A select that submits its form on change (the form's server action does the work). */
export function AutoSubmitSelect({ name, defaultValue, options, label }: { name: string; defaultValue: string; options: { value: string; label: string }[]; label: string }) {
  return (
    <select name={name} defaultValue={defaultValue} aria-label={label} className="input !min-h-8 max-w-44 !py-1 text-sm" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
