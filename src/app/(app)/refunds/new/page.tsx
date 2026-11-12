import type { Metadata } from "next";
import { NewPage } from "@/components/app/payments/pages";

export const metadata: Metadata = { title: "Add refund" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return <NewPage kind="refund" sp={await searchParams} />;
}
