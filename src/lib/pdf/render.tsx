import { renderToBuffer } from "@react-pdf/renderer";
import { BookingPdf, registerFonts, type Logo } from "@/lib/pdf/document";
import type { PdfModel } from "@/lib/pdf/model";

/** Makes the PDF file. Throws if the library fails (the pipeline catches it: the booking is already saved). */
export async function renderBookingPdf(
  model: PdfModel,
  logo?: Logo | null,
): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<BookingPdf model={model} logo={logo ?? null} />);
}
