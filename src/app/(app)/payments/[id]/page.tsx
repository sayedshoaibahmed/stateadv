import type { Metadata } from "next";
import { DetailPage } from "@/components/app/payments/pages";

export const metadata: Metadata = { title: "Payment" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  return <DetailPage kind="payment" id={id} sp={await searchParams} />;
}
