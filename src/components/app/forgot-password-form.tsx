"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/app/text-field";
import { requestPasswordReset, type FormState } from "@/lib/auth/actions";

export function ForgotPasswordForm({ linkProblem }: { linkProblem?: boolean }) {
  const [state, action, pending] = useActionState<
    FormState | undefined,
    FormData
  >(requestPasswordReset, undefined);
  return (
    <form action={action} className="grid gap-4" noValidate>
      {linkProblem && !state ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            That link has expired or was already used. Enter your email to get a
            new one.
          </AlertDescription>
        </Alert>
      ) : null}
      {state?.ok ? (
        <Alert role="status">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <TextField
        id="email"
        label="Email"
        type="email"
        autoComplete="username"
        inputMode="email"
        defaultValue={state?.email}
        error={state?.errors?.email}
        required
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send me a link"}
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
