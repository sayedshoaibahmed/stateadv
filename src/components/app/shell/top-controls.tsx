"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { showsResortFilter } from "@/lib/nav";

/**
 * Search box in the top bar. Bookings do not exist yet, so for now it only says so (stub); it will search guest name,
 * mobile number and booking number once bookings are added.
 */
export function GlobalSearch() {
  const [shown, setShown] = useState(false);
  return (
    <form
      role="search"
      className="relative min-w-0 flex-1 sm:max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        setShown(true);
      }}
    >
      <label htmlFor="global-search" className="sr-only">
        Search bookings
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        id="global-search"
        type="search"
        placeholder="Search guest, mobile or booking no."
        onChange={() => setShown(false)}
        className="h-11 w-full rounded-lg border bg-background pr-3 pl-9 text-base sm:text-sm"
      />
      {shown ? (
        <p
          role="status"
          className="absolute top-12 left-0 z-50 w-full rounded-lg border bg-popover p-3 text-sm shadow-md"
        >
          Search will work once bookings are added.
        </p>
      ) : null}
    </form>
  );
}

/** Choose one resort or all resorts. Only shown on pages that use it; it changes ?resort= in the address. */
export function ResortFilter({
  resorts,
}: {
  resorts: { id: string; name: string }[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  if (!showsResortFilter(pathname)) return null;
  const value = params.get("resort") ?? "all";
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="resort-filter"
        className="sr-only sm:not-sr-only sm:text-sm"
      >
        Resort
      </label>
      <select
        id="resort-filter"
        value={resorts.some((r) => r.id === value) ? value : "all"}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value === "all") next.delete("resort");
          else next.set("resort", e.target.value);
          router.push(`${pathname}?${next.toString()}`);
        }}
        className="h-11 max-w-40 rounded-lg border bg-background px-2 text-base sm:max-w-56 sm:text-sm"
      >
        <option value="all">All resorts</option>
        {resorts.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  );
}
