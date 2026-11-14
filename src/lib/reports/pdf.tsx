import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { registerFonts } from "@/lib/pdf/document";
import type { ReportPdfModel } from "@/lib/reports/pdf-model";

/**
 * The report PDF layout (A4 landscape). It only DRAWS the strings the model holds; it never formats money or dates and
 * never calculates anything. The font is the bundled Noto Sans (it has the ₹ sign), shared with the booking PDF. The header
 * row repeats on every page, rows are never split across two pages, and every page has the page number and the time zone.
 */
const INK = "#1a1a1a";
const MUTED = "#555555";
const LINE = "#cccccc";
const s = StyleSheet.create({
  page: {
    fontFamily: "NotoSans",
    fontSize: 8,
    color: INK,
    paddingTop: 28,
    paddingBottom: 42,
    paddingHorizontal: 28,
    lineHeight: 1.3,
  },
  title: { fontSize: 15, fontWeight: 700, marginBottom: 3 },
  line: { color: MUTED, marginBottom: 1.5 },
  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 6,
    marginBottom: 8,
  },
  box: {
    borderWidth: 0.7,
    borderColor: LINE,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginRight: 6,
    marginBottom: 4,
    minWidth: 110,
  },
  boxLabel: { color: MUTED, fontSize: 7 },
  boxValue: { fontSize: 10, fontWeight: 700 },
  th: {
    flexDirection: "row",
    borderBottomWidth: 0.9,
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
  total: {
    flexDirection: "row",
    borderTopWidth: 0.9,
    borderTopColor: INK,
    paddingTop: 3,
    marginTop: 1,
    fontWeight: 700,
  },
  empty: { color: MUTED, marginTop: 6 },
  foot: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 18,
    borderTopWidth: 0.7,
    borderTopColor: LINE,
    paddingTop: 3,
    fontSize: 7,
    color: MUTED,
  },
});

function widths(m: ReportPdfModel): string[] {
  let sum = 0;
  for (const c of m.columns) sum += c.weight;
  return m.columns.map((c) => `${((c.weight / sum) * 100).toFixed(3)}%`);
}

/*
 * NOTE: the header row, the rows and the totals row are direct children of the page, NOT inside one container View. A
 * container that has to be split over a few hundred rows (many pages) makes the PDF library fail ("unsupported number"); as
 * direct children the same rows lay out without limit (1,000 rows take about 10 seconds; the time grows faster than the rows, so 1,000 is the most a report PDF holds).
 */
export function ReportPdf({ model }: { model: ReportPdfModel }) {
  const w = widths(model);
  const cell = (i: number, text: string, key: string | number) => (
    <Text
      key={key}
      style={{
        width: w[i],
        textAlign: model.columns[i].align,
        paddingRight: 4,
      }}
    >
      {text}
    </Text>
  );
  return (
    <Document title={model.title} author="StateAdv">
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.title}>{model.title}</Text>
        <Text style={s.line}>{model.dateLine}</Text>
        <Text style={s.line}>{model.ruleLine}</Text>
        <Text style={s.line}>{model.filterLine}</Text>
        <Text style={s.line}>{model.generatedLine}</Text>
        {model.note ? <Text style={s.line}>{model.note}</Text> : null}
        {model.summary.length > 0 ? (
          <View style={s.summary}>
            {model.summary.map((x) => (
              <View key={x.label} style={s.box} wrap={false}>
                <Text style={s.boxLabel}>{x.label}</Text>
                <Text style={s.boxValue}>{x.value}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {model.rows.length === 0 ? (
          <Text style={s.empty}>Nothing to show for these choices.</Text>
        ) : (
          <>
            <View style={s.th} fixed>
              {model.columns.map((c, i) => cell(i, c.label, c.label))}
            </View>
            {model.rows.map((row, ri) => (
              <View key={ri} style={s.tr} wrap={false}>
                {row.map((t, i) => cell(i, t, i))}
              </View>
            ))}
            {model.totalsRow ? (
              <View style={s.total} wrap={false}>
                {model.totalsRow.map((t, i) => cell(i, t, i))}
              </View>
            ) : null}
          </>
        )}
        {/* A fixed footer with a page-number render function makes react-pdf fail on long reports, so the footer is plain text. */}
        <Text style={s.foot} fixed>
          StateAdv · Time zone: India (IST)
        </Text>
      </Page>
    </Document>
  );
}

/** Makes the PDF file. Throws if the library fails (the export route turns that into a plain message). */
export async function renderReportPdf(model: ReportPdfModel): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ReportPdf model={model} />);
}
