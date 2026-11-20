export const dynamic = "force-dynamic";
import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Newsreader } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const ui = Instrument_Sans({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const reading = Newsreader({ subsets: ["latin"], variable: "--font-reading", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Klierly", template: "%s · Klierly" },
  description: "Turn the course material you are allowed to use into a personal study system.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Klierly", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#2346c0" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("cl_theme")?.value;
  return (
    <html lang="en" data-theme={theme === "light" || theme === "dark" ? theme : undefined} className={`${ui.variable} ${reading.variable}`}>
      <body>{children}</body>
    </html>
  );
}
