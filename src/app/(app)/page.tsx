import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";

/** The home address is the dashboard. */
export default async function Home() {
  await requireUser();
  redirect("/dashboard");
}
