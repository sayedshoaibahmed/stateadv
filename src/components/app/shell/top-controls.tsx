"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { showsResortFilter } from "@/lib/nav";

/**
 * Search box in the top bar (M4). It opens the Search page with what was typed: bookings (Booking ID, guest name,
 * mobile number, C/O name) and guests. Extra spaces are removed; an empty box does nothing.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [text, setText] = useState("");
  return (
    <form
      role="search"
      className="relative min-w-0 flex-1 sm:max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.replace(/\s+/g, " ").trim().slice(0, 100);
        if (q !== "") router.push("/search?q=" + encodeURIComponent(q));
      }}
    >
      <label htmlFor="global-search" className="sr-only">
        Search bookings and guests
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        id="global-search"
        type="search"
        value={text}
        maxLength={100}
        placeholder="Search guest, mobile or booking no."
        onChange={(e) => setText(e.target.value)}
        className="h-11 w-full rounded-lg border bg-background pr-3 pl-9 text-base sm:text-sm"
      />
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
