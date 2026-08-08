import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";

const manrope = localFont({
  src: [
    { path: "../fonts/manrope/Manrope-Regular.ttf", weight: "400", style: "normal" },
    { path: "../fonts/manrope/Manrope-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../fonts/manrope/Manrope-ExtraBold.ttf", weight: "800", style: "normal" },
  ],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata = {
  title: "Keen Africa Partner Portal",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
