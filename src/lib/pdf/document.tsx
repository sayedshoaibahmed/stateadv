import path from "node:path";
import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { Pair, PdfModel, Table } from "@/lib/pdf/model";

/**
 * The booking PDF layout (A4, portrait). It only DRAWS the strings the model holds; it never formats money or dates
 * and never calculates anything. Noto Sans is bundled (src/lib/pdf/fonts, SIL Open Font License) because the standard
 * PDF fonts have no ₹ sign. Long words are given break points so a long guest name or note wraps instead of running
 * off the page; table rows are never split across two pages; every page has the disclaimer, the version and the page
 * number at the bottom.
 */
const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf", "fonts");
let registered = false;
export function registerFonts(): void {
  if (registered) return;
  Font.register({
    family: "NotoSans",
    fonts: [
      { src: path.join(FONT_DIR, "NotoSans-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "NotoSans-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // a very long unbroken word (a name, a reference, a note) is cut into pieces of 14 letters so it can wrap
  Font.registerHyphenationCallback((word) =>
    word.length > 14 ? (word.match(/.{1,14}/g) ?? [word]) : [word],
  );
  registered = true;
}

const INK = "#1a1a1a";
const MUTED = "#555555";
const LINE = "#cccccc";
const s = StyleSheet.create({
  page: {
    fontFamily: "NotoSans",
    fontSize: 9.5,
    color: INK,
    paddingTop: 36,
    paddingBottom: 64,
    paddingHorizontal: 36,
    lineHeight: 1.35,
  },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1.5,
    borderBottomColor: INK,
    paddingBottom: 8,
    marginBottom: 10,
  },
  headText: { flexGrow: 1, flexShrink: 1, paddingRight: 10 },
  resort: { fontSize: 16, fontWeight: 700 },
  title: { fontSize: 11, color: MUTED },
  code: { fontSize: 14, fontWeight: 700, textAlign: "right" },
  status: { fontSize: 10, textAlign: "right" },
  logo: { width: 54, height: 54, objectFit: "contain", marginRight: 10 },
  section: { marginBottom: 10 },
  h2: {
    fontSize: 11,
    fontWeight: 700,
    borderBottomWidth: 0.7,
    borderBottomColor: LINE,
    paddingBottom: 2,
    marginBottom: 4,
  },
  pair: { flexDirection: "row", paddingVertical: 1.5 },
  pairLabel: { width: "46%", color: MUTED, paddingRight: 6 },
  pairValue: { width: "54%", flexShrink: 1 },
  pairValueR: { width: "54%", textAlign: "right" },
  two: { flexDirection: "row" },
  col: { width: "50%", paddingRight: 10 },
  finalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: INK,
    marginTop: 3,
    paddingTop: 3,
    fontWeight: 700,
  },
  th: {
    flexDirection: "row",
    borderBottomWidth: 0.7,
    borderBottomColor: INK,
    paddingBottom: 2,
    fontWeight: 700,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.4,
    borderBottomColor: LINE,
    paddingVertical: 2,
  },
  empty: { color: MUTED },
  note: { color: MUTED },
  box: { borderWidth: 1, borderColor: "#b00020", padding: 6, marginBottom: 10 },
  foot: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 24,
    borderTopWidth: 0.7,
    borderTopColor: LINE,
    paddingTop: 4,
    fontSize: 8,
    color: MUTED,
  },
  footRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
});

function Pairs({ rows, right = false }: { rows: Pair[]; right?: boolean }) {
  return (
    <View>
      {rows.map((r) => (
        <View key={r.label} style={s.pair} wrap={false}>
          <Text style={s.pairLabel}>{r.label}</Text>
          <Text style={right ? s.pairValueR : s.pairValue}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** Column widths in percent: the first column (a name or a number) is wide, amounts are right-aligned. */
function widths(n: number): string[] {
  if (n === 3) return ["46%", "27%", "27%"];
  if (n === 5) return ["22%", "14%", "22%", "17%", "25%"];
  return Array.from({ length: n }, () => `${100 / n}%`);
}
function TableView({ t, rightCols = [] }: { t: Table; rightCols?: number[] }) {
  const w = widths(t.head.length);
  if (t.rows.length === 0) return <Text style={s.empty}>{t.empty}</Text>;
  return (
    <View>
      <View style={s.th} wrap={false}>
        {t.head.map((h, i) => (
          <Text
            key={h}
            style={{
              width: w[i],
              textAlign: rightCols.includes(i) ? "right" : "left",
              paddingRight: 4,
            }}
          >
            {h}
          </Text>
        ))}
      </View>
      {t.rows.map((row, ri) => (
        <View key={ri} style={s.tr} wrap={false}>
          {row.map((cell, i) => (
            <Text
              key={i}
              style={{
                width: w[i],
                textAlign: rightCols.includes(i) ? "right" : "left",
                paddingRight: 4,
              }}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export interface Logo {
  data: Buffer;
  format: "png" | "jpg";
}

export function BookingPdf({
  model,
  logo,
}: {
  model: PdfModel;
  logo?: Logo | null;
}) {
  return (
    <Document
      title={`${model.code} booking statement`}
      author={model.resortName}
      subject="Internal booking and payment statement"
      creator="StateAdv"
      producer="StateAdv"
    >
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          {logo ? (
            // a PDF image, not an HTML <img>: it has no alt text
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image
              src={{ data: logo.data, format: logo.format }}
              style={s.logo}
            />
          ) : null}
          <View style={s.headText}>
            <Text style={s.resort}>{model.resortName}</Text>
            <Text style={s.title}>Booking statement</Text>
          </View>
          <View>
            <Text style={s.code}>{model.code}</Text>
            <Text style={s.status}>{model.statusLabel}</Text>
          </View>
        </View>

        {model.cancellationBlock ? (
          <View style={s.box}>
            <Text style={{ fontWeight: 700, marginBottom: 2 }}>
              {model.statusLabel}
            </Text>
            <Pairs rows={model.cancellationBlock} />
          </View>
        ) : null}

        <View style={[s.section, s.two]}>
          <View style={s.col}>
            <Text style={s.h2}>Guest</Text>
            <Pairs rows={model.guestBlock} />
          </View>
          <View style={s.col}>
            <Text style={s.h2}>Stay</Text>
            <Pairs rows={model.stayBlock} />
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Booking amount</Text>
          <Pairs rows={model.amountBlock} right />
          <View style={s.finalRow} wrap={false}>
            <Text>{model.finalLine.label}</Text>
            <Text>{model.finalLine.value}</Text>
          </View>
          {model.remarks ? (
            <Text style={[s.note, { marginTop: 4 }]}>
              Remarks: {model.remarks}
            </Text>
          ) : null}
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Payment plan</Text>
          <TableView t={model.plan} rightCols={[2]} />
          {model.adjustments ? (
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontWeight: 700, marginBottom: 2 }}>
                Expected Adjustments
              </Text>
              <TableView t={model.adjustments} rightCols={[1]} />
            </View>
          ) : null}
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Payments</Text>
          <TableView t={model.payments} rightCols={[1]} />
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Refunds</Text>
          <TableView t={model.refunds} rightCols={[1]} />
        </View>

        {model.corrections.length > 0 ? (
          <View style={s.section}>
            <Text style={s.h2}>Files added after approval</Text>
            {model.corrections.map((c, i) => (
              <Text key={i} style={{ marginBottom: 2 }} wrap={false}>
                {c}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={s.section} wrap={false}>
          <Text style={s.h2}>Totals</Text>
          <Pairs rows={model.totals} right />
        </View>

        <View style={s.foot} fixed>
          <Text>{model.footer}</Text>
          <View style={s.footRow}>
            <Text>
              {model.code} · {model.generatedLine}
            </Text>
            <Text
              render={({ pageNumber, totalPages }) =>
                `Page ${pageNumber} of ${totalPages}`
              }
            />
          </View>
        </View>
      </Page>
    </Document>
  );
}
