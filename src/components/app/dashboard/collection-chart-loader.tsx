"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChartPoint } from "@/lib/dashboard/model";

const Chart = dynamic(
  () => import("@/components/app/dashboard/collection-chart"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64 w-full" />,
  },
);

/** Loads the chart code only in the browser (it measures the screen), keeping the page itself light. */
export default function CollectionChartLoader({
  points,
  grain,
}: {
  points: ChartPoint[];
  grain: "day" | "month";
}) {
  return <Chart points={points} grain={grain} />;
}
