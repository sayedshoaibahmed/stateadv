"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TextField } from "@/components/app/text-field";
import { saveGuestAction, type GuestFormState } from "@/lib/bookings/actions";

/** Add or edit a guest. Changing a guest's details never changes the name or mobile number already printed on old bookings. */
export function GuestForm({
  guest,
}: {
  guest?: {
    id: string;
    full_name: string;
    mobile: string;
    email: string | null;
    address: string | null;
    notes: string | null;
  };
}) {
  const [state, action, pending] = useActionState<
    GuestFormState | undefined,
    FormData
  >(saveGuestAction, undefined);
  const e = state?.errors ?? {};
  return (
    <form
      action={action}
      className="grid max-w-xl gap-4"
      aria-label={guest ? "Edit guest" : "Add guest"}
    >
      {guest ? <input type="hidden" name="id" value={guest.id} /> : null}
      <TextField
        id="fullName"
        label="Guest name"
        defaultValue={guest?.full_name}
        maxLength={120}
        required
        error={e.fullName}
        className="min-h-11"
      />
      <TextField
        id="mobile"
        label="Mobile number"
        inputMode="tel"
        defaultValue={guest?.mobile}
        maxLength={30}
        required
        error={e.mobile}
        className="min-h-11"
      />
      <TextField
        id="email"
        label="Email (optional)"
        type="email"
        defaultValue={guest?.email ?? ""}
        maxLength={200}
        error={e.email}
        className="min-h-11"
      />
      <TextField
        id="address"
        label="Address (optional)"
        defaultValue={guest?.address ?? ""}
        maxLength={300}
        error={e.address}
        className="min-h-11"
      />
      <div className="grid gap-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={guest?.notes ?? ""}
          maxLength={1000}
        />
      </div>
      {state?.message ? (
        <Alert
          variant={state.ok ? "default" : "destructive"}
          role={state.ok ? "status" : "alert"}
        >
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="submit"
        className="min-h-12 justify-self-start px-6"
        disabled={pending}
      >
        {pending ? "Saving…" : guest ? "Save" : "Add guest"}
      </Button>
    </form>
  );
}
