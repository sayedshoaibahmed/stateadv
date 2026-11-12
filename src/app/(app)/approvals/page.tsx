import type { Metadata } from "next";
import { ApprovalsPage } from "@/components/app/payments/pages";

export const metadata: Metadata = { title: "Waiting for Approval" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return <ApprovalsPage sp={await searchParams} />;
}
