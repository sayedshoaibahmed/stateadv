"use client";

import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { filterOptions, type Option } from "@/lib/master-data/options";

/**
 * "Type to search, then pick": used by the booking forms for the resort, the C/O category, the C/O name and the stay
 * type. Only switched-on options are offered; the option a booking ALREADY has is always shown (even if it has been
 * switched off since) so an old booking can be opened and saved without losing its choice. The rules live in
 * src/lib/master-data/options.ts and are unit-tested.
 *
 * The chosen id is also sent with the form in a hidden field called `name`.
 */
export function OptionPicker({
  name,
  label,
  options,
  value,
  onChange,
  required,
  placeholder = "Type to search",
  error,
}: {
  name: string;
  label: string;
  options: readonly Option[];
  /** the current choice (id) or null */
  value: string | number | null;
  onChange?: (id: string | number | null) => void;
  required?: boolean;
  placeholder?: string;
  error?: string;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [selected, setSelected] = useState<string | number | null>(value);
  const current = options.find((o) => o.id === selected) ?? null;
  const [query, setQuery] = useState(current?.label ?? "");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  // while the person is typing, search; right after a choice, show the full short list
  const shown = useMemo(
    () =>
      filterOptions(options, current && query === current.label ? "" : query, {
        selectedId: value,
        limit: 20,
      }),
    [options, query, current, value],
  );

  function choose(o: Option | null) {
    setSelected(o ? o.id : null);
    setQuery(o ? o.label : "");
    setOpen(false);
    onChange?.(o ? o.id : null);
  }

  return (
    <div className="relative grid gap-2">
      <Label htmlFor={uid}>{label}</Label>
      <Input
        id={uid}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={error ? true : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        required={required && selected === null}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
          onChange?.(null);
          setOpen(true);
          setCursor(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setCursor((c) => Math.min(c + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === "Enter" && open && shown[cursor]) {
            e.preventDefault();
            choose(shown[cursor]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <input type="hidden" name={name} value={selected ?? ""} />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {shown.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              Nothing matches. Check the spelling, or add it in Settings.
            </li>
          ) : (
            shown.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={o.id === selected}
                className={`cursor-pointer rounded px-2 py-1.5 text-sm ${i === cursor ? "bg-accent" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
              >
                {o.label}
                {o.hint ? (
                  <span className="ml-2 text-muted-foreground">{o.hint}</span>
                ) : null}
                {!o.active ? (
                  <span className="ml-2 text-muted-foreground">
                    (switched off)
                  </span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
