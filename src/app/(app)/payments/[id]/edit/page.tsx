import type { Metadata } from "next";
import { EditPage } from "@/components/app/payments/pages";

export const metadata: Metadata = { title: "Change payment" };

type Params = Promise<{ id: string }>;

export default async function Page({ params }: { params: Params }) {
  const { id } = await params;
  return <EditPage kind="payment" id={id} />;
}
