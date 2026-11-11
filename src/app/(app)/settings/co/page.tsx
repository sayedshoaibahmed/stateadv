import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  CategoryForm,
  EntryForm,
  Fold,
  SearchList,
} from "@/components/app/settings-forms";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "C/O settings" };

interface Category {
  id: number;
  name: string;
  name_mode: string;
  is_active: boolean;
  sort_order: number;
}
interface Entry {
  id: string;
  category_id: number;
  name: string;
  mobile: string | null;
  notes: string | null;
  is_active: boolean;
}

const MODE_TEXT: Record<string, string> = {
  listed: "bookings pick a name from this category's list",
  typed: "bookings type a name",
  none: "no name needed",
};

export default async function CoSettingsPage() {
  await requireUser();
  const supabase = await createClient();
  const [{ data: cats }, { data: ents }] = await Promise.all([
    supabase
      .from("co_categories")
      .select("id, name, name_mode, is_active, sort_order")
      .order("sort_order")
      .order("name"),
    supabase
      .from("co_entries")
      .select("id, category_id, name, mobile, notes, is_active")
      .order("name"),
  ]);
  const categories = (cats ?? []) as Category[];
  const entries = (ents ?? []) as Entry[];

  return (
    <main className="flex max-w-4xl flex-1 flex-col gap-4 p-4">
      <div>
        <Link href="/settings" className="text-sm underline underline-offset-4">
          Back to Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          C/O: who brought the booking
        </h1>
        <p className="text-muted-foreground">
          Make as many categories as you like and name them yourself. Renaming
          or switching something off never changes an old booking.
        </p>
      </div>

      <Fold title="Add a category" defaultOpen={categories.length === 0}>
        <CategoryForm />
      </Fold>

      {categories.length === 0 ? (
        <Alert role="status">
          <AlertDescription>
            No categories yet. Add the first one above.
          </AlertDescription>
        </Alert>
      ) : null}

      {categories.map((c) => {
        const list = entries.filter((e) => e.category_id === c.id);
        return (
          <section
            key={c.id}
            aria-labelledby={`cat-${c.id}`}
            className="grid gap-3 rounded-lg border p-4"
          >
            <h2
              id={`cat-${c.id}`}
              className="flex flex-wrap items-center gap-2 text-lg font-semibold"
            >
              {c.name}
              <Badge variant={c.is_active ? "outline" : "destructive"}>
                {c.is_active ? "Switched on" : "Switched off"}
              </Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              {MODE_TEXT[c.name_mode]}
            </p>
            <Fold title="Change this category">
              <CategoryForm category={c} />
            </Fold>
            {c.name_mode === "listed" ? (
              <div className="grid gap-3">
                <h3 className="font-medium">
                  Names in {c.name} ({list.length})
                </h3>
                <Fold title={`Add a name to ${c.name}`}>
                  <EntryForm categoryId={c.id} />
                </Fold>
                <SearchList
                  placeholder={`Search ${c.name} names`}
                  rows={list.map((e) => ({
                    id: e.id,
                    label: e.name,
                    hint: e.mobile ?? undefined,
                    active: e.is_active,
                    node: (
                      <Fold
                        title={e.name}
                        hint={`${e.is_active ? "" : "switched off · "}${e.mobile ?? ""}`}
                      >
                        <EntryForm categoryId={c.id} entry={e} />
                      </Fold>
                    ),
                  }))}
                />
              </div>
            ) : null}
          </section>
        );
      })}
    </main>
  );
}
