import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "blast-radius — Supply Chain Compromise Analyzer",
  description: "Graph-native supply chain blast radius analysis powered by HydraDB",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
