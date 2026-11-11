import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Fold,
  LogoUploader,
  ResortForm,
  ResortSwitch,
  SearchList,
} from "@/components/app/settings-forms";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Resorts" };

interface Resort {
  id: string;
  code: string;
  name: string;
  location: string | null;
  contact_number: string | null;
  logo_path: string | null;
  is_active: boolean;
}

export default async function ResortsPage() {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("resorts")
    .select("id, code, name, location, contact_number, logo_path, is_active")
    .order("is_active", { ascending: false })
    .order("name");
  const resorts = (data ?? []) as Resort[];
  // a resort that already has a booking can no longer change its code (the Booking IDs use it)
  const { data: used } = await supabase
    .from("bookings")
    .select("resort_id")
    .in(
      "resort_id",
      resorts.map((r) => r.id),
    );
  const locked = new Set(
    (used ?? []).map((b: { resort_id: string }) => b.resort_id),
  );

  return (
    <main className="flex max-w-4xl flex-1 flex-col gap-4 p-4">
      <div>
        <Link href="/settings" className="text-sm underline underline-offset-4">
          Back to Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          Resorts ({resorts.length})
        </h1>
        <p className="text-muted-foreground">
          Add as many resorts as you need. The first four are only examples:
          rename them, or switch them off. A resort&apos;s code starts every
          Booking ID, so it stays fixed once the resort has a booking. Changing
          a name never changes an old Booking ID.
        </p>
      </div>

      <Fold title="Add a resort">
        <ResortForm />
      </Fold>

      <SearchList
        placeholder="Search resorts"
        rows={resorts.map((r) => ({
          id: r.id,
          label: r.name,
          hint: [r.code, r.location].filter(Boolean).join(" "),
          active: r.is_active,
          node: (
            <Fold
              title={r.name}
              hint={`${r.code}${r.location ? " · " + r.location : ""}${r.is_active ? "" : " · switched off"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Code {r.code}</Badge>
                <Badge variant={r.is_active ? "outline" : "destructive"}>
                  {r.is_active ? "Switched on" : "Switched off"}
                </Badge>
                {r.logo_path ? (
                  <Badge variant="secondary">Has a logo</Badge>
                ) : null}
              </div>
              <ResortForm resort={r} codeLocked={locked.has(r.id)} />
              <LogoUploader resortId={r.id} />
              <ResortSwitch id={r.id} active={r.is_active} />
            </Fold>
          ),
        }))}
      />
    </main>
  );
}
