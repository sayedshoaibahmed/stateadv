"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OptionPicker } from "@/components/app/option-picker";
import {
  PlanEditor,
  type LockedRow,
} from "@/components/app/bookings/plan-editor";
import { PlanChangeSection } from "@/components/app/bookings/plan-change";
import {
  createBookingAction,
  findGuestsAction,
  quickAddCoEntryAction,
  updateBookingAction,
  type GuestSuggestion,
} from "@/lib/bookings/actions";
import {
  checkPlan,
  nightsOf,
  nightsText,
  previewAmounts,
  suggestDueDates,
  validateBooking,
  type BookingFormValues,
  type FormErrors,
  type PlanRowInput,
} from "@/lib/bookings/form";
import type { EditPlanCheck } from "@/lib/bookings/plan";
import type { FormOptions } from "@/lib/bookings/data";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface EditInfo {
  bookingId: string;
  version: number;
  code: string;
  resortName: string;
  /** the year of the booking date: it cannot change */
  bookingYear: number;
  originalFinalPaise: number;
  locked: LockedRow[];
}

const field = "min-h-11";
const toggle = (on: boolean) =>
  cn(
    "min-h-12 rounded-xl border-2 px-4 py-2 text-base font-medium transition-colors",
    on
      ? "border-primary bg-primary text-primary-foreground"
      : "border-input bg-background hover:bg-muted",
  );

function Err({ id, text }: { id: string; text?: string }) {
  return text ? (
    <p id={id} role="alert" className="text-sm text-destructive">
      {text}
    </p>
  ) : null;
}

/**
 * Add / Edit Booking (UI spec 3.4). One column on a phone. The screen sends only the inputs; nights and every amount
 * are worked out here for a live preview AND again by the database, which has the final say.
 */
export function BookingForm({
  mode,
  options,
  initial,
  edit,
}: {
  mode: "create" | "edit";
  options: FormOptions;
  initial: BookingFormValues;
  edit?: EditInfo;
}) {
  const router = useRouter();
  const [v, setV] = useState<BookingFormValues>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [idemKey] = useState(() => crypto.randomUUID());
  const [categories, setCategories] = useState(options.categories);
  const [pickerKey, setPickerKey] = useState(0);
  const [suggestions, setSuggestions] = useState<GuestSuggestion[]>([]);
  const [editCheck, setEditCheck] = useState<EditPlanCheck | null>(null);
  const [movePaise, setMovePaise] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addMessage, setAddMessage] = useState<string | null>(null);

  const set = (patch: Partial<BookingFormValues>) =>
    setV((x) => ({ ...x, ...patch }));
  const amounts = useMemo(() => previewAmounts(v), [v]);
  const nights = nightsOf(v.checkInDate, v.checkOutDate);
  const category =
    categories.find((c) => String(c.id) === v.coCategoryId) ?? null;
  const amountChanged =
    mode === "edit" &&
    edit &&
    amounts.ok &&
    amounts.finalPaise !== edit.originalFinalPaise;
  const planCheck = useMemo(
    () =>
      mode === "create"
        ? checkPlan(v.plan, amounts.ok ? amounts.finalPaise : null)
        : null,
    [mode, v.plan, amounts],
  );

  // guests who already have this mobile number: "Use this guest"
  const canSuggest = !v.guestId && v.guestMobile.replace(/\D/g, "").length >= 5;
  useEffect(() => {
    if (!canSuggest) return;
    let live = true;
    const t = setTimeout(() => {
      findGuestsAction(v.guestMobile).then((g) => live && setSuggestions(g));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [v.guestMobile, canSuggest]);
  const shownSuggestions = canSuggest ? suggestions : [];

  function chooseCategory(id: number) {
    set({ coCategoryId: String(id), coEntryId: null, coName: "" });
    setAdding(false);
    setPickerKey((k) => k + 1);
  }

  async function addEntry() {
    if (!category) return;
    setAddMessage(null);
    const r = await quickAddCoEntryAction(category.id, newName, "");
    if (!r.ok) {
      setAddMessage(r.message);
      return;
    }
    setCategories((cs) =>
      cs.map((c) =>
        c.id === category.id
          ? {
              ...c,
              entries: [
                ...c.entries,
                { id: r.id, name: r.name, mobile: null, active: true },
              ],
            }
          : c,
      ),
    );
    set({ coEntryId: r.id });
    setPickerKey((k) => k + 1);
    setAdding(false);
    setNewName("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errs = validateBooking(v, { mode, amountChanged: !!amountChanged });
    if (amountChanged && editCheck && editCheck.problems.length > 0)
      errs.plan = editCheck.problems[0];
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setMessage("Please check the highlighted fields.");
      return;
    }
    startTransition(async () => {
      const res =
        mode === "create"
          ? await createBookingAction({ values: v, idempotencyKey: idemKey })
          : await updateBookingAction({
              bookingId: edit!.bookingId,
              expectedVersion: edit!.version,
              values: v,
              sendPlan: !!amountChanged || movePaise > 0,
              movePaise,
            });
      if (!res.ok) {
        setMessage(res.message);
        if (res.errors) setErrors(res.errors);
        return;
      }
      const id =
        mode === "create" ? (res as { id: string }).id : edit!.bookingId;
      router.push(`/bookings/${id}?saved=1`);
    });
  }

  const activeCategories = categories.filter(
    (c) => c.active || String(c.id) === v.coCategoryId,
  );
  const pickerOptions = (category?.entries ?? []).map((x) => ({
    id: x.id,
    label: x.name,
    active: x.active,
    hint: x.mobile ?? undefined,
  }));
  const yearMin = edit ? `${edit.bookingYear}-01-01` : undefined;
  const yearMax = edit ? `${edit.bookingYear}-12-31` : undefined;
  const lockedPlan = edit?.locked ?? [];

  return (
    <form
      onSubmit={submit}
      className="grid max-w-3xl gap-8"
      noValidate
      aria-label={mode === "create" ? "Add booking" : "Edit booking"}
    >
      {message ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-rejected-soft px-3 py-2 text-sm font-medium"
        >
          {message}
        </p>
      ) : null}

      {/* 1. Resort */}
      <fieldset className="grid gap-3">
        <legend className="text-lg font-semibold">1. Resort</legend>
        {mode === "create" ? (
          <OptionPicker
            name="resortId"
            label="Resort"
            required
            options={options.resorts.map((r) => ({
              id: r.id,
              label: r.name,
              active: r.active,
              hint: r.code,
            }))}
            value={v.resortId || null}
            onChange={(id) => set({ resortId: id ? String(id) : "" })}
            error={errors.resortId}
          />
        ) : (
          <div className="grid gap-1">
            <p className="font-medium">{edit?.resortName}</p>
            <p className="text-sm text-muted-foreground">
              The resort cannot be changed after the Booking ID is issued. To
              fix it, cancel this booking and create a new one.
            </p>
          </div>
        )}
      </fieldset>

      {/* 2. Guest */}
      <fieldset className="grid gap-3">
        <legend className="text-lg font-semibold">2. Guest</legend>
        {v.guestId ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted p-3">
            <p className="font-medium">
              {v.guestName}{" "}
              <span className="text-muted-foreground">· {v.guestMobile}</span>
            </p>
            <Button
              type="button"
              variant="outline"
              className={field}
              onClick={() =>
                set({
                  guestId: null,
                  guestName: "",
                  guestMobile: "",
                  guestEmail: "",
                })
              }
            >
              Use a different guest
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-1">
              <Label htmlFor="guestMobile">Mobile number</Label>
              <Input
                id="guestMobile"
                inputMode="tel"
                autoComplete="off"
                value={v.guestMobile}
                onChange={(e) => set({ guestMobile: e.target.value })}
                aria-invalid={errors.guestMobile ? true : undefined}
                className={field}
              />
              <Err id="guestMobile-err" text={errors.guestMobile} />
            </div>
            {shownSuggestions.length > 0 ? (
              <ul
                className="grid gap-2"
                aria-label="Guests with this mobile number"
              >
                {shownSuggestions.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 p-3"
                  >
                    <span>
                      <span className="font-medium">{g.fullName}</span> ·{" "}
                      {g.mobile} ·{" "}
                      {g.bookings === 0
                        ? "no bookings yet"
                        : `${g.bookings} ${g.bookings === 1 ? "booking" : "bookings"}`}
                    </span>
                    <Button
                      type="button"
                      className={field}
                      onClick={() =>
                        set({
                          guestId: g.id,
                          guestName: g.fullName,
                          guestMobile: g.mobile,
                        })
                      }
                    >
                      Use this guest
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid gap-1">
              <Label htmlFor="guestName">Guest name</Label>
              <Input
                id="guestName"
                value={v.guestName}
                maxLength={120}
                onChange={(e) => set({ guestName: e.target.value })}
                aria-invalid={errors.guestName ? true : undefined}
                className={field}
              />
              <Err id="guestName-err" text={errors.guestName} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="guestEmail">Email (optional)</Label>
              <Input
                id="guestEmail"
                type="email"
                value={v.guestEmail}
                onChange={(e) => set({ guestEmail: e.target.value })}
                aria-invalid={errors.guestEmail ? true : undefined}
                className={field}
              />
              <Err id="guestEmail-err" text={errors.guestEmail} />
            </div>
          </>
        )}
      </fieldset>

      {/* 3. Stay (includes the Amount and the Payment plan) */}
      <fieldset className="grid gap-3">
        <legend className="text-lg font-semibold">3. Stay</legend>
        <div className="grid gap-1">
          <Label htmlFor="bookingDate">Booking date</Label>
          <Input
            id="bookingDate"
            type="date"
            value={v.bookingDate}
            min={yearMin}
            max={yearMax}
            onChange={(e) => set({ bookingDate: e.target.value })}
            aria-invalid={errors.bookingDate ? true : undefined}
            className={cn(field, "max-w-56")}
          />
          {mode === "edit" ? (
            <p className="text-sm text-muted-foreground">
              Only dates in {edit?.bookingYear} can be picked (the year is part
              of the Booking ID).
            </p>
          ) : null}
          <Err id="bookingDate-err" text={errors.bookingDate} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="checkInDate">Check-in date</Label>
            <Input
              id="checkInDate"
              type="date"
              value={v.checkInDate}
              onChange={(e) =>
                set({
                  checkInDate: e.target.value,
                  plan: suggestDueDates(v.plan, e.target.value),
                })
              }
              aria-invalid={errors.checkInDate ? true : undefined}
              className={field}
            />
            <Err id="checkInDate-err" text={errors.checkInDate} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="checkInTime">Check-in time</Label>
            <Input
              id="checkInTime"
              type="time"
              value={v.checkInTime}
              onChange={(e) => set({ checkInTime: e.target.value })}
              aria-invalid={errors.checkInTime ? true : undefined}
              className={field}
            />
            <Err id="checkInTime-err" text={errors.checkInTime} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="checkOutDate">Check-out date</Label>
            <Input
              id="checkOutDate"
              type="date"
              value={v.checkOutDate}
              min={v.checkInDate || undefined}
              onChange={(e) => set({ checkOutDate: e.target.value })}
              aria-invalid={errors.checkOutDate ? true : undefined}
              className={field}
            />
            <Err id="checkOutDate-err" text={errors.checkOutDate} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="checkOutTime">Check-out time</Label>
            <Input
              id="checkOutTime"
              type="time"
              value={v.checkOutTime}
              onChange={(e) => set({ checkOutTime: e.target.value })}
              aria-invalid={errors.checkOutTime ? true : undefined}
              className={field}
            />
            <Err id="checkOutTime-err" text={errors.checkOutTime} />
          </div>
        </div>
        {nights !== null && nights >= 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="nights">
            {nightsText(nights)} (worked out from the dates)
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="pax">Number of people (PAX)</Label>
            <Input
              id="pax"
              inputMode="numeric"
              value={v.pax}
              onChange={(e) => set({ pax: e.target.value })}
              aria-invalid={errors.pax ? true : undefined}
              className={field}
            />
            <Err id="pax-err" text={errors.pax} />
          </div>
          <OptionPicker
            name="stayTypeId"
            label="Stay type"
            required
            options={options.stayTypes.map((s) => ({
              id: String(s.id),
              label: s.name,
              active: s.active,
            }))}
            value={v.stayTypeId || null}
            onChange={(id) => set({ stayTypeId: id ? String(id) : "" })}
            error={errors.stayTypeId}
          />
        </div>
        <div className="grid gap-1 sm:max-w-64">
          <Label htmlFor="tariff">Tariff per person (₹)</Label>
          <Input
            id="tariff"
            inputMode="decimal"
            value={v.tariff}
            onChange={(e) => set({ tariff: e.target.value })}
            aria-invalid={errors.tariff ? true : undefined}
            className={field}
          />
          <Err id="tariff-err" text={errors.tariff} />
        </div>
        {amounts.ok ? (
          <p
            className="rounded-lg bg-muted px-3 py-2 font-medium"
            data-testid="amount-line"
          >
            {amounts.line}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="extra">Extra charges (₹, optional)</Label>
            <Input
              id="extra"
              inputMode="decimal"
              value={v.extra}
              onChange={(e) => set({ extra: e.target.value })}
              className={field}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="extraNote">What are the extra charges for?</Label>
            <Input
              id="extraNote"
              value={v.extraNote}
              maxLength={200}
              onChange={(e) => set({ extraNote: e.target.value })}
              className={field}
            />
          </div>
        </div>
        {amounts.ok ? (
          <p>
            Total Amount:{" "}
            <strong className="tabular-nums">
              {formatPaise(amounts.totalPaise)}
            </strong>
          </p>
        ) : null}
        <div className="grid gap-1 sm:max-w-64">
          <Label htmlFor="discount">Discount (₹, optional)</Label>
          <Input
            id="discount"
            inputMode="decimal"
            value={v.discount}
            onChange={(e) => set({ discount: e.target.value })}
            className={field}
          />
        </div>
        {errors.amount ? <Err id="amount-err" text={errors.amount} /> : null}
        {amounts.ok ? (
          <div className="grid gap-1">
            <p className="text-sm text-muted-foreground">
              Final Booking Amount
            </p>
            <p
              className="text-3xl font-semibold tabular-nums"
              data-testid="final-amount"
            >
              {formatPaise(amounts.finalPaise)}
            </p>
            {amounts.manualAdjustmentPaise !== 0 ? (
              <p className="text-sm" data-testid="adjusted-line">
                Calculated {formatPaise(amounts.calculatedFinalPaise)} → Final{" "}
                {formatPaise(amounts.finalPaise)} (Adjusted{" "}
                {amounts.manualAdjustmentPaise < 0 ? "−" : "+"}
                {formatPaise(Math.abs(amounts.manualAdjustmentPaise))})
              </p>
            ) : null}
          </div>
        ) : null}
        {!v.changeFinal ? (
          <Button
            type="button"
            variant="outline"
            className={cn(field, "justify-self-start")}
            onClick={() => set({ changeFinal: true })}
            disabled={!amounts.ok}
          >
            Change final amount
          </Button>
        ) : (
          <div className="grid gap-3 rounded-lg border p-3">
            <div className="grid gap-1 sm:max-w-64">
              <Label htmlFor="finalOverride">New final amount (₹)</Label>
              <Input
                id="finalOverride"
                inputMode="decimal"
                value={v.finalOverride}
                onChange={(e) => set({ finalOverride: e.target.value })}
                aria-invalid={errors.finalOverride ? true : undefined}
                className={field}
              />
              <Err id="finalOverride-err" text={errors.finalOverride} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="adjustmentReason">
                Why is the final amount changed?
              </Label>
              <Input
                id="adjustmentReason"
                value={v.adjustmentReason}
                maxLength={300}
                onChange={(e) => set({ adjustmentReason: e.target.value })}
                aria-invalid={errors.adjustmentReason ? true : undefined}
                className={field}
              />
              <Err id="adjustmentReason-err" text={errors.adjustmentReason} />
            </div>
            <Button
              type="button"
              variant="outline"
              className={cn(field, "justify-self-start")}
              onClick={() =>
                set({
                  changeFinal: false,
                  finalOverride: "",
                  adjustmentReason: "",
                })
              }
            >
              Go back to the calculated amount
            </Button>
          </div>
        )}

        {mode === "create" ? (
          <div className="grid gap-2">
            <PlanEditor
              idPrefix="plan"
              rows={v.plan}
              onChange={(plan) => set({ plan })}
              check={planCheck}
            />
            <Err
              id="plan-err"
              text={
                errors.plan && planCheck?.state === "ok" ? errors.plan : undefined
              }
            />
            <p className="text-sm text-muted-foreground">
              Both amounts start empty. Fill them in so the plan adds up to the
              Final Booking Amount.
            </p>
          </div>
        ) : amountChanged && edit ? (
          <PlanChangeSection
            idPrefix="editplan"
            bookingId={edit.bookingId}
            newAmountDuePaise={amounts.ok ? amounts.finalPaise : null}
            locked={lockedPlan}
            rows={v.plan}
            onRows={(plan: PlanRowInput[]) => set({ plan })}
            reason={v.changeReason}
            onCheck={(c, m) => {
              setEditCheck(c);
              setMovePaise(m);
            }}
            highlight="Final Amount changed. Please update the payment plan."
          />
        ) : null}
        {errors.plan && mode === "edit" ? (
          <Err id="plan-err2" text={errors.plan} />
        ) : null}
      </fieldset>

      {/* 4. C/O */}
      <fieldset className="grid gap-3">
        <legend className="text-lg font-semibold">
          4. Who brought this booking (C/O)
        </legend>
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          role="group"
          aria-label="C/O type"
        >
          {activeCategories.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={String(c.id) === v.coCategoryId}
              className={toggle(String(c.id) === v.coCategoryId)}
              onClick={() => chooseCategory(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <Err id="coCategoryId-err" text={errors.coCategoryId} />
        {category?.nameMode === "listed" ? (
          <div className="grid gap-2">
            <OptionPicker
              key={`${category.id}-${pickerKey}`}
              name="coEntryId"
              label={`${category.name} name`}
              options={pickerOptions}
              value={v.coEntryId}
              onChange={(id) => set({ coEntryId: id ? String(id) : null })}
              placeholder="Type to search"
            />
            {!adding ? (
              <Button
                type="button"
                variant="outline"
                className={cn(field, "justify-self-start")}
                onClick={() => setAdding(true)}
              >
                + Add a new {category.name.toLowerCase()}
              </Button>
            ) : (
              <div className="grid gap-2 rounded-lg border p-3">
                <Label htmlFor="newCoName">
                  New {category.name.toLowerCase()} name
                </Label>
                <Input
                  id="newCoName"
                  value={newName}
                  maxLength={120}
                  onChange={(e) => setNewName(e.target.value)}
                  className={field}
                />
                {addMessage ? (
                  <p role="alert" className="text-sm text-destructive">
                    {addMessage}
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <Button type="button" className={field} onClick={addEntry}>
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className={field}
                    onClick={() => setAdding(false)}
                  >
                    Not now
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}
        {category?.nameMode === "typed" ? (
          <div className="grid gap-1">
            <Label htmlFor="coName">Person / source name</Label>
            <Input
              id="coName"
              value={v.coName}
              maxLength={120}
              onChange={(e) => set({ coName: e.target.value })}
              className={field}
            />
          </div>
        ) : null}
      </fieldset>

      {/* 5. Remarks */}
      <fieldset className="grid gap-2">
        <legend className="text-lg font-semibold">5. Remarks</legend>
        <Textarea
          id="remarks"
          aria-label="Remarks"
          value={v.remarks}
          maxLength={1000}
          onChange={(e) => set({ remarks: e.target.value })}
        />
      </fieldset>

      {/* Reason for change (edit) */}
      {mode === "edit" ? (
        <div className="grid gap-1">
          <Label htmlFor="changeReason">
            Reason for change{" "}
            {amountChanged
              ? "(needed because an amount changed)"
              : "(optional)"}
          </Label>
          <Input
            id="changeReason"
            value={v.changeReason}
            maxLength={300}
            onChange={(e) => set({ changeReason: e.target.value })}
            aria-invalid={errors.changeReason ? true : undefined}
            className={field}
          />
          <Err id="changeReason-err" text={errors.changeReason} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          className="min-h-12 px-6 text-base"
          disabled={pending}
        >
          {pending ? "Saving…" : "Save Booking"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-12 px-6 text-base"
          disabled={pending}
          onClick={() =>
            router.push(edit ? `/bookings/${edit.bookingId}` : "/bookings")
          }
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
