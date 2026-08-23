import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "liju thomas",
  description: "liju thomas — site reliability engineer",
  icons: { icon: "/favicon.ico" },
  alternates: {
    types: { "application/atom+xml": "/feed.xml" },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Analytics />
        {children}
      </body>
    </html>
  );
}
