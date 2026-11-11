"use server";

import { fieldErrors, type FieldErrors } from "@/lib/auth/schemas";
import { requireUser } from "@/lib/auth/session";
import type { Result } from "@/lib/db/call";
import {
  setResortActive,
  upsertCoCategory,
  upsertCoEntry,
  upsertResort,
  upsertStayType,
} from "@/lib/db/actions";
import {
  coCategorySchema,
  coEntrySchema,
  formToObject,
  resortSchema,
  stayTypeSchema,
} from "@/lib/settings/schemas";

/**
 * Settings: C/O categories and names, resorts, stay types.
 * Normal everyday work for Managers AND Owners (owner requirement 2026-11-11): any signed-in, active person.
 * Each action checks the session on the server, validates the form, then calls the database function with the
 * person's own login; the database applies the real rules (unique names, locked resort code, switched-off choices ...).
 */
export interface SettingsState {
  ok?: boolean;
  message?: string;
  errors?: FieldErrors;
}

const bad = (message: string, errors?: FieldErrors): SettingsState => ({
  message,
  errors,
});
const finish = (r: Result<unknown>, success: string): SettingsState =>
  r.ok ? { ok: true, message: success } : { message: r.message };

export async function saveCoCategory(
  _prev: SettingsState | undefined,
  fd: FormData,
): Promise<SettingsState> {
  await requireUser();
  const p = coCategorySchema.safeParse(formToObject(fd));
  if (!p.success) return bad("Please check the form.", fieldErrors(p.error));
  return finish(
    await upsertCoCategory({
      id: p.data.id,
      name: p.data.name,
      nameMode: p.data.name_mode,
      active: p.data.active,
    }),
    p.data.id ? "Saved." : "The category was added.",
  );
}

export async function saveCoEntry(
  _prev: SettingsState | undefined,
  fd: FormData,
): Promise<SettingsState> {
  await requireUser();
  const p = coEntrySchema.safeParse(formToObject(fd));
  if (!p.success) return bad("Please check the form.", fieldErrors(p.error));
  return finish(
    await upsertCoEntry({
      id: p.data.id,
      categoryId: p.data.category_id,
      name: p.data.name,
      mobile: p.data.mobile,
      notes: p.data.notes,
      active: p.data.active,
    }),
    p.data.id ? "Saved." : "The name was added.",
  );
}

export async function saveResort(
  _prev: SettingsState | undefined,
  fd: FormData,
): Promise<SettingsState> {
  await requireUser();
  const p = resortSchema.safeParse(formToObject(fd));
  if (!p.success) return bad("Please check the form.", fieldErrors(p.error));
  return finish(
    await upsertResort({
      id: p.data.id,
      code: p.data.code,
      name: p.data.name,
      location: p.data.location ?? "",
      contactNumber: p.data.contact_number ?? "",
    }),
    p.data.id ? "Saved." : "The resort was added.",
  );
}

export async function switchResort(
  _prev: SettingsState | undefined,
  fd: FormData,
): Promise<SettingsState> {
  await requireUser();
  const id = String(fd.get("id") ?? "");
  const active = fd.get("active") === "true";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return bad("That resort was not found.");
  return finish(
    await setResortActive(id, active),
    active
      ? "The resort is switched on."
      : "The resort is switched off. Its past bookings stay.",
  );
}

export async function saveStayType(
  _prev: SettingsState | undefined,
  fd: FormData,
): Promise<SettingsState> {
  await requireUser();
  const p = stayTypeSchema.safeParse(formToObject(fd));
  if (!p.success) return bad("Please check the form.", fieldErrors(p.error));
  return finish(
    await upsertStayType({
      id: p.data.id,
      name: p.data.name,
      active: p.data.active,
    }),
    p.data.id ? "Saved." : "The stay type was added.",
  );
}
