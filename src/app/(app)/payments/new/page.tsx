import type { Metadata } from "next";
import { NewPage } from "@/components/app/payments/pages";

export const metadata: Metadata = { title: "Add payment" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return <NewPage kind="payment" sp={await searchParams} />;
}
