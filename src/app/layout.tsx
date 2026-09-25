import type { Metadata } from "next";
import { TrpcProvider } from "@/lib/trpc/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Document reader",
  description: "Extract line items from a PDF only when each quantity can be traced to the page.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
