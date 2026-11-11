import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "People" };

interface Row {
  id: string;
  full_name: string;
  email: string;
  role: "owner" | "manager";
  is_active: boolean;
}

export default async function UsersPage() {
  const me = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, full_name, email, role, is_active")
    .order("is_active", { ascending: false })
    .order("full_name");
  const { data: owners } = await supabase.rpc("active_owner_count");
  const rows = (data ?? []) as Row[];

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">People</h1>
        <Link href="/users/new" className={buttonVariants()}>
          Add person
        </Link>
      </div>

      {me.role === "owner" && owners === 1 ? (
        <Alert role="status">
          <AlertDescription>
            Only one Owner account exists. Add a second Owner so access can be
            recovered if one of you cannot sign in.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            We could not load the list. Please try again.
          </AlertDescription>
        </Alert>
      ) : null}

      {rows.length === 0 && !error ? (
        <p className="text-muted-foreground">No one has been added yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Link
                      href={`/users/${u.id}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {u.full_name}
                    </Link>
                    {u.id === me.id ? (
                      <span className="ml-2 text-sm text-muted-foreground">
                        (you)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant={u.role === "owner" ? "default" : "secondary"}
                    >
                      {u.role === "owner" ? "Owner" : "Manager"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.is_active ? "outline" : "destructive"}>
                      {u.is_active ? "Active" : "Switched off"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
