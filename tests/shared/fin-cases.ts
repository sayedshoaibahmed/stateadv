/**
 * TEST_PLAN section 2.9 golden table (whole rupees), shared by the unit tests (src/lib/calc.ts)
 * and the database tests (booking_financials view) so both are held to the SAME numbers.
 * Fictional amounts.
 */
export type FinCase = [
  id: string,
  input: [D: number, A: number, W: number, RA: number, RW: number],
  expected: {
    pending: number;
    verified: number;
    extra: number;
    refundDue: number;
    total: number;
    net: number;
    stillToRecord?: number;
  },
];

export const FIN_CASES: Array<
  [
    id: string,
    input: [D: number, A: number, W: number, RA: number, RW: number],
    expected: {
      pending: number;
      verified: number;
      extra: number;
      refundDue: number;
      total: number;
      net: number;
      stillToRecord?: number;
    },
  ]
> = [
  [
    "FIN-01",
    [5000, 0, 0, 0, 0],
    { pending: 5000, verified: 5000, extra: 0, refundDue: 0, total: 0, net: 0 },
  ],
  [
    "FIN-02",
    [5000, 0, 5000, 0, 0],
    { pending: 0, verified: 5000, extra: 0, refundDue: 0, total: 0, net: 0 },
  ],
  [
    "FIN-03",
    [5000, 1500, 3500, 0, 0],
    {
      pending: 0,
      verified: 3500,
      extra: 0,
      refundDue: 0,
      total: 1500,
      net: 1500,
    },
  ],
  [
    "FIN-04",
    [5000, 0, 3500, 0, 0],
    { pending: 1500, verified: 5000, extra: 0, refundDue: 0, total: 0, net: 0 },
  ],
  [
    "FIN-05",
    [5000, 5000, 0, 0, 0],
    { pending: 0, verified: 0, extra: 0, refundDue: 0, total: 5000, net: 5000 },
  ],
  [
    "FIN-06",
    [5000, 5000, 1000, 0, 0],
    {
      pending: 0,
      verified: 0,
      extra: 1000,
      refundDue: 0,
      total: 5000,
      net: 5000,
    },
  ],
  [
    "FIN-07",
    [5000, 6000, 0, 0, 0],
    {
      pending: 0,
      verified: 0,
      extra: 1000,
      refundDue: 1000,
      total: 6000,
      net: 6000,
    },
  ],
  [
    "FIN-08",
    [5000, 6000, 0, 0, 1000],
    {
      pending: 0,
      verified: 0,
      extra: 1000,
      refundDue: 1000,
      total: 6000,
      net: 6000,
      stillToRecord: 0,
    },
  ],
  [
    "FIN-09",
    [5000, 6000, 0, 1000, 0],
    { pending: 0, verified: 0, extra: 0, refundDue: 0, total: 6000, net: 5000 },
  ],
  [
    "FIN-10",
    [5000, 2000, 0, 0, 0],
    {
      pending: 3000,
      verified: 3000,
      extra: 0,
      refundDue: 0,
      total: 2000,
      net: 2000,
    },
  ],
  [
    "FIN-11",
    [1000, 3000, 0, 0, 0],
    {
      pending: 0,
      verified: 0,
      extra: 2000,
      refundDue: 2000,
      total: 3000,
      net: 3000,
    },
  ],
  [
    "FIN-12",
    [1000, 3000, 0, 2000, 0],
    { pending: 0, verified: 0, extra: 0, refundDue: 0, total: 3000, net: 1000 },
  ],
  [
    "FIN-13",
    [5000, 1000, 0, 0, 0],
    {
      pending: 4000,
      verified: 4000,
      extra: 0,
      refundDue: 0,
      total: 1000,
      net: 1000,
    },
  ],
  [
    "FIN-14",
    [0, 0, 0, 0, 0],
    { pending: 0, verified: 0, extra: 0, refundDue: 0, total: 0, net: 0 },
  ],
  [
    "FIN-15",
    [4000, 5000, 0, 0, 0],
    {
      pending: 0,
      verified: 0,
      extra: 1000,
      refundDue: 1000,
      total: 5000,
      net: 5000,
    },
  ],
  [
    "FIN-16",
    [5000, 6000, 0, 0, 1500],
    {
      pending: 0,
      verified: 0,
      extra: 1000,
      refundDue: 1000,
      total: 6000,
      net: 6000,
    },
  ],
  [
    "FIN-17",
    [5000, 6000, 0, 1500, 0],
    {
      pending: 500,
      verified: 500,
      extra: 0,
      refundDue: 0,
      total: 6000,
      net: 4500,
    },
  ],
  [
    "FIN-18",
    [1000, 3000, 0, 0, 2000],
    {
      pending: 0,
      verified: 0,
      extra: 2000,
      refundDue: 2000,
      total: 3000,
      net: 3000,
      stillToRecord: 0,
    },
  ],
  [
    "FIN-19",
    [1000, 3000, 0, 0, 0],
    {
      pending: 0,
      verified: 0,
      extra: 2000,
      refundDue: 2000,
      total: 3000,
      net: 3000,
      stillToRecord: 2000,
    },
  ],
];
