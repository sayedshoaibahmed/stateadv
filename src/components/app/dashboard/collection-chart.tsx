"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDisplayDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import type { ChartPoint } from "@/lib/dashboard/model";

const rupees = (paise: number) => Math.round(paise / 100);
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function label(start: string, grain: "day" | "month") {
  const [y, m, d] = start.split("-").map(Number);
  return grain === "month"
    ? `${MONTHS[m - 1]} ${String(y).slice(2)}`
    : `${d} ${MONTHS[m - 1]}`;
}

/**
 * Collection over time: Approved (green) and Waiting (amber) stacked, with Expected as a blue line. The table below
 * the chart holds the same numbers for people who cannot read a chart.
 */
export default function CollectionChart({
  points,
  grain,
}: {
  points: ChartPoint[];
  grain: "day" | "month";
}) {
  const data = points.map((p) => ({
    name: label(p.start, grain),
    full: grain === "day" ? formatDisplayDate(p.start) : label(p.start, grain),
    approved: rupees(p.totalCollectionPaise),
    waiting: rupees(p.waitingPaise),
    expected: rupees(p.expectedPaise),
  }));
  return (
    <div>
      <div
        className="h-64 w-full"
        role="img"
        aria-label="Chart of money collected over the chosen period; the same numbers are in the table below"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12 }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              width={56}
              tickFormatter={(v: number) =>
                formatPaise(v * 100).replace(/\.00$/, "")
              }
            />
            <Tooltip
              labelFormatter={(_, items) => items?.[0]?.payload?.full ?? ""}
              formatter={(v) => formatPaise(Number(v) * 100)}
            />
            <Legend />
            <Bar
              dataKey="approved"
              name="Approved"
              stackId="a"
              fill="var(--money-approved)"
            />
            <Bar
              dataKey="waiting"
              name="Waiting for Approval"
              stackId="a"
              fill="var(--money-waiting)"
            />
            <Line
              dataKey="expected"
              name="Expected"
              type="monotone"
              stroke="var(--money-pending)"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm">
        <summary className="min-h-11 cursor-pointer py-2">
          Show the numbers
        </summary>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-right tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">
                  {grain === "day" ? "Day" : "Month"}
                </th>
                <th className="font-medium">Approved</th>
                <th className="font-medium">Waiting</th>
                <th className="font-medium">Expected</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.start} className="border-t">
                  <td className="py-1 text-left">
                    {grain === "day"
                      ? formatDisplayDate(p.start)
                      : label(p.start, grain)}
                  </td>
                  <td>{formatPaise(p.totalCollectionPaise)}</td>
                  <td>{formatPaise(p.waitingPaise)}</td>
                  <td>{formatPaise(p.expectedPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
