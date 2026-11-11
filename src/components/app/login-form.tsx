"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/app/text-field";
import { login, type FormState } from "@/lib/auth/actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<
    FormState | undefined,
    FormData
  >(login, undefined);
  return (
    <form action={action} className="grid gap-4" noValidate>
      {state?.message ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
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
      <TextField
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        error={state?.errors?.password}
        required
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="underline underline-offset-4">
          Forgot your password? (Owners only)
        </Link>
      </p>
    </form>
  );
}
