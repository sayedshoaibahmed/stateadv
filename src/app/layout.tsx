import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Resort Management",
    template: "%s · Resort Management",
  },
  description:
    "Internal booking, payment and collection records for all resorts.",
  robots: { index: false, follow: false }, // internal app — never indexed
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-IN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-base text-foreground">
        {/*
          Every page reads the login session at request time (Cache Components
          requires a Suspense boundary for that). Nothing about who is signed in
          is ever cached or prerendered.
        */}
        <Suspense
          fallback={
            <main className="flex flex-1 items-center justify-center p-4 text-muted-foreground">
              Loading…
            </main>
          }
        >
          {children}
        </Suspense>
      </body>
    </html>
  );
}
