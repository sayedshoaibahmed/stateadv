"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/app/text-field";
import {
  addUser,
  changeOwnEmail,
  changeOwnPassword,
  changeRole,
  changeUserEmail,
  editUser,
  resetUserPassword,
  setUserActive,
  type AccountState,
} from "@/lib/accounts/actions";
import { PASSWORD_MIN } from "@/lib/auth/schemas";

type Action = (
  prev: AccountState | undefined,
  fd: FormData,
) => Promise<AccountState>;

function useAccountAction(action: Action) {
  return useActionState<AccountState | undefined, FormData>(action, undefined);
}

function Result({ state }: { state?: AccountState }) {
  if (!state?.message) return null;
  const bad = !state.ok;
  return (
    <Alert
      variant={bad ? "destructive" : "default"}
      role={bad ? "alert" : "status"}
    >
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

/** A temporary password is shown ONCE, to the person who created or reset the account. */
function TempPassword({ value }: { value?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <Alert role="status">
      <AlertTitle>Temporary password (shown only once)</AlertTitle>
      <AlertDescription>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 font-mono text-base select-all">
            {value}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-2 text-sm">
          Give it to the person in private. They must choose their own password
          the first time they sign in. We cannot show it again.
        </p>
      </AlertDescription>
    </Alert>
  );
}

/** Reason + the acting person's own password: required for actions on Owner accounts (O3). */
function ProtectedFields({
  state,
  needed,
}: {
  state?: AccountState;
  needed: boolean;
}) {
  if (!needed) return null;
  return (
    <div className="grid gap-4 rounded-md border p-3">
      <p className="text-sm text-muted-foreground">
        This is a protected action. Everyone will see a notice about it on the
        home page.
      </p>
      <TextField
        id="reason"
        label="Why are you doing this?"
        hint="At least 10 characters."
        error={state?.errors?.reason}
        required
        minLength={10}
        maxLength={500}
      />
      <TextField
        id="actor_password"
        label="Your own password"
        type="password"
        autoComplete="current-password"
        error={state?.errors?.actor_password}
        required
      />
    </div>
  );
}

/** A collapsed section: opening it is the first confirmation step for a sensitive action. */
export function Section({
  title,
  children,
  danger,
}: {
  title: string;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <details className="rounded-lg border">
      <summary
        className={`cursor-pointer px-4 py-3 font-medium ${danger ? "text-destructive" : ""}`}
      >
        {title}
      </summary>
      <div className="grid gap-4 border-t p-4">{children}</div>
    </details>
  );
}

// ------------------------------------------------------------------ add user
export function AddUserForm({ actorIsOwner }: { actorIsOwner: boolean }) {
  const [state, action, pending] = useAccountAction(addUser);
  const [role, setRole] = useState("manager");
  return (
    <form action={action} className="grid max-w-xl gap-4" noValidate>
      <Result state={state} />
      <TempPassword value={state?.tempPassword} />
      <TextField
        id="full_name"
        label="Full name"
        autoComplete="off"
        error={state?.errors?.full_name}
        required
      />
      <TextField
        id="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="off"
        error={state?.errors?.email}
        required
      />
      <TextField
        id="phone"
        label="Phone (optional)"
        type="tel"
        autoComplete="off"
        error={state?.errors?.phone}
      />
      <div className="grid gap-2">
        <Label htmlFor="role">Role</Label>
        <select
          id="role"
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="manager">Manager</option>
          {actorIsOwner ? <option value="owner">Owner</option> : null}
        </select>
        <p className="text-sm text-muted-foreground">
          Managers and Owners can do the same daily work. Owners have extra
          protection for their own accounts.
          {actorIsOwner ? "" : " Only an Owner can add another Owner."}
        </p>
        {state?.errors?.role ? (
          <p role="alert" className="text-sm text-destructive">
            {state.errors.role}
          </p>
        ) : null}
      </div>
      <ProtectedFields state={state} needed={role === "owner"} />
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add person"}
      </Button>
    </form>
  );
}

// ----------------------------------------------------------- user detail pieces
export function EditDetailsForm({
  id,
  fullName,
  phone,
}: {
  id: string;
  fullName: string;
  phone: string | null;
}) {
  const [state, action, pending] = useAccountAction(editUser);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="id" value={id} />
      <Result state={state} />
      <TextField
        id="full_name"
        label="Full name"
        defaultValue={fullName}
        error={state?.errors?.full_name}
        required
      />
      <TextField
        id="phone"
        label="Phone"
        type="tel"
        defaultValue={phone ?? ""}
        error={state?.errors?.phone}
      />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function ChangeRoleForm({
  id,
  role,
  targetIsOwner,
  actorIsOwner,
}: {
  id: string;
  role: string;
  targetIsOwner: boolean;
  actorIsOwner: boolean;
}) {
  const [state, action, pending] = useAccountAction(changeRole);
  const [chosen, setChosen] = useState(role);
  const protectedAction = targetIsOwner || chosen === "owner";
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="id" value={id} />
      <Result state={state} />
      <div className="grid gap-2">
        <Label htmlFor="role">Role</Label>
        <select
          id="role"
          name="role"
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="manager">Manager</option>
          <option value="owner" disabled={!actorIsOwner}>
            Owner
          </option>
        </select>
      </div>
      {protectedAction ? (
        <ProtectedFields state={state} needed />
      ) : (
        <TextField
          id="reason"
          label="Reason"
          hint="At least 10 characters."
          error={state?.errors?.reason}
          required
          minLength={10}
        />
      )}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Change role"}
      </Button>
    </form>
  );
}

export function SwitchForm({
  id,
  active,
  targetIsOwner,
}: {
  id: string;
  active: boolean;
  targetIsOwner: boolean;
}) {
  const [state, action, pending] = useAccountAction(setUserActive);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <Result state={state} />
      <p className="text-sm">
        {active
          ? "A person who is switched off can no longer sign in or do anything. Their past records and name stay."
          : "The person will be able to sign in again."}
      </p>
      {targetIsOwner ? (
        <ProtectedFields state={state} needed />
      ) : (
        <TextField
          id="reason"
          label="Reason (optional)"
          error={state?.errors?.reason}
        />
      )}
      <Button
        type="submit"
        variant={active ? "destructive" : "default"}
        disabled={pending}
        className="w-fit"
      >
        {pending
          ? "Please wait…"
          : active
            ? "Yes, switch off this account"
            : "Yes, switch on this account"}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({
  id,
  targetIsOwner,
}: {
  id: string;
  targetIsOwner: boolean;
}) {
  const [state, action, pending] = useAccountAction(resetUserPassword);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="id" value={id} />
      <Result state={state} />
      <TempPassword value={state?.tempPassword} />
      <p className="text-sm">
        The old password stops working. You will get a temporary password to
        give to the person.
      </p>
      {targetIsOwner ? (
        <ProtectedFields state={state} needed />
      ) : (
        <TextField
          id="reason"
          label="Reason (optional)"
          error={state?.errors?.reason}
        />
      )}
      <Button
        type="submit"
        variant="destructive"
        disabled={pending}
        className="w-fit"
      >
        {pending ? "Please wait…" : "Yes, reset the password"}
      </Button>
    </form>
  );
}

export function ChangeUserEmailForm({
  id,
  targetIsOwner,
}: {
  id: string;
  targetIsOwner: boolean;
}) {
  const [state, action, pending] = useAccountAction(changeUserEmail);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="id" value={id} />
      <Result state={state} />
      <TextField
        id="new_email"
        label="New email"
        type="email"
        inputMode="email"
        error={state?.errors?.new_email}
        required
      />
      {targetIsOwner ? (
        <ProtectedFields state={state} needed />
      ) : (
        <TextField
          id="reason"
          label="Why is the email being changed?"
          hint="At least 10 characters."
          error={state?.errors?.reason}
          required
          minLength={10}
        />
      )}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Change email"}
      </Button>
    </form>
  );
}

// ------------------------------------------------------------------ My Account
export function OwnPasswordForm() {
  const [state, action, pending] = useAccountAction(changeOwnPassword);
  return (
    <form action={action} className="grid max-w-xl gap-4" noValidate>
      <Result state={state} />
      <TextField
        id="current_password"
        label="Current password"
        type="password"
        autoComplete="current-password"
        error={state?.errors?.current_password}
        required
      />
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
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Change my password"}
      </Button>
    </form>
  );
}

export function OwnEmailForm({ currentEmail }: { currentEmail: string }) {
  const [state, action, pending] = useAccountAction(changeOwnEmail);
  return (
    <form action={action} className="grid max-w-xl gap-4" noValidate>
      <Result state={state} />
      <p className="text-sm">
        Your email now: <strong>{currentEmail}</strong>
      </p>
      <TextField
        id="new_email"
        label="New email"
        type="email"
        inputMode="email"
        error={state?.errors?.new_email}
        required
      />
      <TextField
        id="current_password"
        label="Your password"
        type="password"
        autoComplete="current-password"
        error={state?.errors?.current_password}
        required
      />
      <p className="text-sm text-muted-foreground">
        We send a link to the new address and to your current address. Your
        email changes only after you open both links.
      </p>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Sending…" : "Send the links"}
      </Button>
    </form>
  );
}
