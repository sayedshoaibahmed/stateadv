"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/app/text-field";
import { saveProviderAction, type ProviderState } from "@/lib/bookings/actions";

/** Add or edit a payment app (the UPI and card apps shown when a payment is recorded later). */
export function ProviderForm({
  provider,
}: {
  provider?: {
    id: number;
    name: string;
    method: "upi" | "card";
    is_active: boolean;
  };
}) {
  const [state, action, pending] = useActionState<
    ProviderState | undefined,
    FormData
  >(saveProviderAction, undefined);
  return (
    <form action={action} className="grid gap-3" noValidate>
      {provider ? <input type="hidden" name="id" value={provider.id} /> : null}
      {state?.message ? (
        <Alert
          variant={state.ok ? "default" : "destructive"}
          role={state.ok ? "status" : "alert"}
        >
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <TextField
        id="name"
        label="App name"
        defaultValue={provider?.name}
        maxLength={60}
        required
        error={state?.errors?.name}
        className="min-h-11"
      />
      {provider ? (
        <input type="hidden" name="method" value={provider.method} />
      ) : (
        <div className="grid gap-2">
          <Label htmlFor="method">Used for</Label>
          <select
            id="method"
            name="method"
            defaultValue="upi"
            className="min-h-11 rounded-lg border bg-background px-2 text-base sm:text-sm"
          >
            <option value="upi">UPI</option>
            <option value="card">Card</option>
          </select>
          {state?.errors?.method ? (
            <p role="alert" className="text-sm text-destructive">
              {state.errors.method}
            </p>
          ) : null}
        </div>
      )}
      {provider ? (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={provider.is_active}
            className="size-5"
          />
          Switched on (can be chosen when a payment is recorded)
        </label>
      ) : null}
      <Button type="submit" disabled={pending} className="min-h-11 w-fit">
        {pending ? "Saving…" : provider ? "Save" : "Add app"}
      </Button>
    </form>
  );
}
