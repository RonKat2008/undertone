import type { Metadata } from "next";
import { Instrument_Serif, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BusProvider } from "@/lib/bus/use-bus";
import { Masthead } from "@/components/Masthead";
import { DirectorPanel } from "@/components/DirectorPanel";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
});

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Undertone",
  description: "A wearable speech coach",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${instrumentSerif.variable} ${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <BusProvider>
          <div className="min-h-screen flex flex-col">
            <Masthead />
            <main className="flex-grow">
              {children}
            </main>
          </div>
          <DirectorPanel />
        </BusProvider>
      </body>
    </html>
  );
}
