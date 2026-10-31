import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PwaRegister } from "@/components/pwa";
import { publicEnv } from "@/lib/public-env";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Sora({ subsets: ["latin"], variable: "--font-display", display: "swap", weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: { default: "ClipPilot — Une longue vidéo. Plusieurs clips. Zéro montage.", template: "%s · ClipPilot" },
  description:
    "ClipPilot transforme vos longues vidéos en clips courts sous-titrés pour TikTok, Reels et YouTube Shorts, automatiquement.",
  applicationName: "ClipPilot",
  appleWebApp: { capable: true, title: "ClipPilot", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
  openGraph: { type: "website", siteName: "ClipPilot", locale: "fr_FR" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07060c" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-dvh font-sans">
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster richColors position="top-center" closeButton toastOptions={{ className: "font-sans" }} />
          </TooltipProvider>
        </ThemeProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
