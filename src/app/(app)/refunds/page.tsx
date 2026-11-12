import type { Metadata } from "next";
import { ListPage } from "@/components/app/payments/pages";

export const metadata: Metadata = { title: "Refunds" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return <ListPage kind="refund" sp={await searchParams} />;
}
