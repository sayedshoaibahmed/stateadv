import type { Metadata } from "next";
import { ListPage } from "@/components/app/payments/pages";

export const metadata: Metadata = { title: "Payments" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return <ListPage kind="payment" sp={await searchParams} />;
}
