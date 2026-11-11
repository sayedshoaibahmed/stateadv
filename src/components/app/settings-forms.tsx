"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/app/text-field";
import {
  saveCoCategory,
  saveCoEntry,
  saveResort,
  saveStayType,
  switchResort,
  type SettingsState,
} from "@/lib/settings/actions";
import { confirmLogoUpload, prepareLogoUpload } from "@/lib/storage/actions";
import { createClient } from "@/lib/supabase/client";
import { filterOptions, type Option } from "@/lib/master-data/options";

type Action = (
  prev: SettingsState | undefined,
  fd: FormData,
) => Promise<SettingsState>;
const useForm = (action: Action) =>
  useActionState<SettingsState | undefined, FormData>(action, undefined);

function Result({ state }: { state?: SettingsState }) {
  if (!state?.message) return null;
  return (
    <Alert
      variant={state.ok ? "default" : "destructive"}
      role={state.ok ? "status" : "alert"}
    >
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4"
      />
      {label}
    </label>
  );
}

/** Collapsed block; a title line always visible (works without scripts). */
export function Fold({
  title,
  hint,
  children,
  defaultOpen,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="rounded-lg border" open={defaultOpen}>
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 px-4 py-3 font-medium">
        {title}
        {hint ? (
          <span className="text-sm font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </summary>
      <div className="grid gap-4 border-t p-4">{children}</div>
    </details>
  );
}

/**
 * A list with a "type to search" box. The server page prepares each row (including its edit form) and sends it in;
 * this component only decides which rows to show. It lists everything, switched-off rows too (it is for managing).
 */
export function SearchList({
  rows,
  placeholder,
}: {
  rows: Array<Option & { node: ReactNode }>;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const shown = filterOptions(rows, query, {
    includeInactive: true,
    limit: 200,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor="list-search" className="sr-only">
          Search
        </Label>
        <Input
          id="list-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? "Nothing here yet."
            : "Nothing matches what you typed."}
        </p>
      ) : (
        <ul className="grid gap-2">
          {shown.map((o) => (
            <li key={o.id}>{byId.get(o.id)?.node}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- C/O
export function CategoryForm({
  category,
}: {
  category?: {
    id: number;
    name: string;
    name_mode: string;
    is_active: boolean;
  };
}) {
  const [state, action, pending] = useForm(saveCoCategory);
  return (
    <form action={action} className="grid gap-3" noValidate>
      {category ? <input type="hidden" name="id" value={category.id} /> : null}
      <Result state={state} />
      <TextField
        id="name"
        label="Category name"
        defaultValue={category?.name}
        error={state?.errors?.name}
        required
      />
      <div className="grid gap-2">
        <Label htmlFor={`mode-${category?.id ?? "new"}`}>
          How do bookings use it?
        </Label>
        <select
          id={`mode-${category?.id ?? "new"}`}
          name="name_mode"
          defaultValue={category?.name_mode ?? "listed"}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="listed">Pick a name from a list (like Agent)</option>
          <option value="typed">Type a name on the booking (like Own)</option>
          <option value="none">No name needed (like Direct)</option>
        </select>
        {state?.errors?.name_mode ? (
          <p role="alert" className="text-sm text-destructive">
            {state.errors.name_mode}
          </p>
        ) : null}
      </div>
      <Check
        name="active"
        label="Switched on (can be chosen for new bookings)"
        defaultChecked={category?.is_active ?? true}
      />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : category ? "Save category" : "Add category"}
      </Button>
    </form>
  );
}

export function EntryForm({
  categoryId,
  entry,
}: {
  categoryId: number;
  entry?: {
    id: string;
    name: string;
    mobile: string | null;
    notes: string | null;
    is_active: boolean;
  };
}) {
  const [state, action, pending] = useForm(saveCoEntry);
  return (
    <form action={action} className="grid gap-3" noValidate>
      {entry ? <input type="hidden" name="id" value={entry.id} /> : null}
      <input type="hidden" name="category_id" value={categoryId} />
      <Result state={state} />
      <TextField
        id="name"
        label="Name"
        defaultValue={entry?.name}
        error={state?.errors?.name}
        required
      />
      <TextField
        id="mobile"
        label="Phone (optional)"
        type="tel"
        defaultValue={entry?.mobile ?? ""}
        error={state?.errors?.mobile}
      />
      <TextField
        id="notes"
        label="Notes (optional)"
        defaultValue={entry?.notes ?? ""}
        error={state?.errors?.notes}
      />
      <Check
        name="active"
        label="Switched on"
        defaultChecked={entry?.is_active ?? true}
      />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : entry ? "Save" : "Add name"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- resorts
export function ResortForm({
  resort,
  codeLocked,
}: {
  resort?: {
    id: string;
    code: string;
    name: string;
    location: string | null;
    contact_number: string | null;
  };
  codeLocked?: boolean;
}) {
  const [state, action, pending] = useForm(saveResort);
  return (
    <form action={action} className="grid gap-3" noValidate>
      {resort ? <input type="hidden" name="id" value={resort.id} /> : null}
      <Result state={state} />
      <TextField
        id="name"
        label="Resort name"
        defaultValue={resort?.name}
        error={state?.errors?.name}
        required
      />
      {/* a locked code is still sent (the database needs it) but cannot be typed over */}
      <TextField
        id="code"
        label="Code (the start of every Booking ID)"
        defaultValue={resort?.code}
        readOnly={codeLocked}
        hint={
          codeLocked
            ? "This resort already has bookings, so its code can no longer change."
            : "2 to 10 letters or numbers. Can be changed until the first booking."
        }
        error={state?.errors?.code}
        required
        maxLength={10}
      />
      <TextField
        id="location"
        label="Location (optional)"
        defaultValue={resort?.location ?? ""}
        error={state?.errors?.location}
      />
      <TextField
        id="contact_number"
        label="Contact number (optional)"
        type="tel"
        defaultValue={resort?.contact_number ?? ""}
        error={state?.errors?.contact_number}
      />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : resort ? "Save resort" : "Add resort"}
      </Button>
    </form>
  );
}

export function ResortSwitch({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useForm(switchResort);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <Result state={state} />
      <p className="text-sm">
        {active
          ? "Switching a resort off stops NEW bookings. Its past bookings, payments and history stay exactly as they are."
          : "Switching it on lets people make new bookings here again."}
      </p>
      <Button
        type="submit"
        variant={active ? "destructive" : "default"}
        disabled={pending}
        className="w-fit"
      >
        {pending
          ? "Please wait…"
          : active
            ? "Yes, switch this resort off"
            : "Switch this resort on"}
      </Button>
    </form>
  );
}

/** Chooses a picture, sends it straight to private storage, then the server checks it and saves it on the resort. */
export function LogoUploader({ resortId }: { resortId: string }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  async function onPick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const prep = await prepareLogoUpload(resortId, {
        name: file.name,
        size: file.size,
        type: file.type,
      });
      if (!prep.ok) return setMessage({ ok: false, text: prep.message });
      const t = prep.tickets[0];
      const { error } = await createClient()
        .storage.from("resort-logos")
        .uploadToSignedUrl(t.path, t.token, file, { contentType: t.mime });
      if (error)
        return setMessage({
          ok: false,
          text: "The picture did not upload. Please try again.",
        });
      const done = await confirmLogoUpload(resortId, t.path, t.mime);
      setMessage(
        done.ok
          ? { ok: true, text: "The logo was saved." }
          : { ok: false, text: done.message },
      );
    } catch {
      setMessage({
        ok: false,
        text: "Something went wrong. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2">
      <Label htmlFor={`logo-${resortId}`}>
        Logo (JPG, PNG or WEBP, up to 2 MB)
      </Label>
      <Input
        id={`logo-${resortId}`}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      {message ? (
        <Alert
          variant={message.ok ? "default" : "destructive"}
          role={message.ok ? "status" : "alert"}
        >
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- stay types
export function StayTypeForm({
  stay,
}: {
  stay?: { id: number; name: string; is_active: boolean };
}) {
  const [state, action, pending] = useForm(saveStayType);
  return (
    <form action={action} className="grid gap-3" noValidate>
      {stay ? <input type="hidden" name="id" value={stay.id} /> : null}
      <Result state={state} />
      <TextField
        id="name"
        label="Stay type name"
        defaultValue={stay?.name}
        error={state?.errors?.name}
        required
      />
      <Check
        name="active"
        label="Switched on (can be chosen for new bookings)"
        defaultChecked={stay?.is_active ?? true}
      />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : stay ? "Save" : "Add stay type"}
      </Button>
    </form>
  );
}
