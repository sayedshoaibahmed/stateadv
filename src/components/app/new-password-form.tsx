"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/app/text-field";
import { setNewPassword, type FormState } from "@/lib/auth/actions";
import { PASSWORD_MIN } from "@/lib/auth/schemas";

export function NewPasswordForm() {
  const [state, action, pending] = useActionState<
    FormState | undefined,
    FormData
  >(setNewPassword, undefined);
  return (
    <form action={action} className="grid gap-4" noValidate>
      {state?.message ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <TextField
        id="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN} characters. A few words together work well.`}
        error={state?.errors?.password}
        required
      />
      <TextField
        id="confirm"
        label="New password again"
        type="password"
        autoComplete="new-password"
        error={state?.errors?.confirm}
        required
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
