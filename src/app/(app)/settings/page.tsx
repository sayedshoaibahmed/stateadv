import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Settings" };

const AREAS = [
  {
    href: "/settings/resorts",
    title: "Resorts",
    text: "Add resorts, change names, locations, contact numbers and logos, switch resorts on or off.",
  },
  {
    href: "/settings/co",
    title: "C/O (who brought the booking)",
    text: "Add your own C/O categories and the names inside them, such as agents and partners.",
  },
  {
    href: "/settings/stay-types",
    title: "Stay types",
    text: "Add, rename and switch off the kinds of stay you offer.",
  },
];

export default async function SettingsPage() {
  await requireUser();
  return (
    <main className="flex max-w-4xl flex-1 flex-col gap-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">
          You decide these lists yourself. Changing a name here never changes an
          old booking: every booking keeps the names it was made with.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {AREAS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="rounded-xl focus-visible:outline-2"
          >
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle>{a.title}</CardTitle>
                <CardDescription>{a.text}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
