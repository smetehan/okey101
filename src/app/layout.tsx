import type { Metadata, Viewport } from "next";
import { Baloo_2, Manrope } from "next/font/google";
import "./globals.css";

const baloo = Baloo_2({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "700", "800"],
  variable: "--font-display",
});
const manrope = Manrope({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "600", "700"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "101 Okey Masası",
  description: "Arkadaşlarla özel masa — 101 okey, sesli sohbet",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={`${baloo.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  );
}
