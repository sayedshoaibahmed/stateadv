import type { Metadata } from "next";
import Link from "next/link";
import {
  Fold,
  SearchList,
  StayTypeForm,
} from "@/components/app/settings-forms";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Stay types" };

interface Stay {
  id: number;
  name: string;
  is_active: boolean;
  sort_order: number;
}

export default async function StayTypesPage() {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("stay_types")
    .select("id, name, is_active, sort_order")
    .order("sort_order")
    .order("name");
  const stays = (data ?? []) as Stay[];
  return (
    <main className="flex max-w-4xl flex-1 flex-col gap-4 p-4">
      <div>
        <Link href="/settings" className="text-sm underline underline-offset-4">
          Back to Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          Stay types ({stays.length})
        </h1>
        <p className="text-muted-foreground">
          Add any kind of stay and name it yourself. The first three are only
          examples. Renaming or switching one off never changes an old booking.
        </p>
      </div>
      <Fold title="Add a stay type">
        <StayTypeForm />
      </Fold>
      <SearchList
        placeholder="Search stay types"
        rows={stays.map((s) => ({
          id: s.id,
          label: s.name,
          active: s.is_active,
          sortOrder: s.sort_order,
          node: (
            <Fold title={s.name} hint={s.is_active ? "" : "switched off"}>
              <StayTypeForm stay={s} />
            </Fold>
          ),
        }))}
      />
    </main>
  );
}
