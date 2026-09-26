import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Travel Manager",
  description: "Coordinate multi-person business travel with clarity."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
