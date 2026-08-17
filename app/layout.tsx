import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import { OrganizationJsonLd, WebSiteJsonLd } from "@/components/json-ld";
import { MarketingEventTracker } from "@/components/marketing/MarketingEventTracker";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#cc0000",
};

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Editorial serif for refined headlines — opt-in via `--font-serif` / `font-serif` utility.
// Existing components don't reference this variable, so they continue to render unchanged.
const fraunces = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const baseUrl = "https://www.studiooscloud.com";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  applicationName: "Studio OS Cloud",
  title: {
    default: "Studio OS Cloud | Photography Workflow & Galleries",
    template: "%s | Studio OS Cloud",
  },
  description:
    "Photography workflow software with online galleries, booking, ordering, digital delivery, desktop capture, and production tools in one connected platform.",
  keywords: [
    "photography workflow software",
    "photographer workflow software",
    "online photo gallery ordering software",
    "premium online gallery for photographers",
    "photography gallery platform",
    "desktop and cloud photography workflow",
    "photography project organization",
    "school photography software",
    "school picture day software",
    "online school photography booking",
    "picture day appointment scheduling",
    "automatic photography roster",
    "client ordering system",
    "camera tethering software",
    "photography business management",
    "AI background removal photography",
    "online photo gallery",
    "photography print ordering",
    "event photography software",
    "sports photography software",
    "graduation photography software",
    "corporate headshot software",
    "portrait photography workflow",
    "multi-photographer capture",
    "school roster management",
    "photography print fulfillment",
    "ShootProof alternative",
    "Pixieset alternative",
    "GotPhoto alternative",
    "ZNO alternative",
    "SmugMug alternative",
    "Zenfolio alternative",
  ],
  authors: [{ name: "Studio OS Cloud" }],
  creator: "Studio OS Cloud",
  publisher: "Studio OS Cloud",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: baseUrl,
    siteName: "Studio OS Cloud",
    title: "Studio OS Cloud | Photography Workflow & Galleries",
    description:
      "Connect booking, desktop capture, online galleries, client ordering, digital delivery, and production in one photography platform.",
    images: [
      {
        url: "/studio_os_logo.png",
        width: 1200,
        height: 630,
        alt: "Studio OS Cloud | Photography Workflow Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Studio OS Cloud | Photography Workflow & Galleries",
    description:
      "Booking, online galleries, ordering, delivery, and desktop production in one connected photography workflow.",
    images: ["/studio_os_logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: baseUrl,
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Studio OS Mobile",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/studio_os_logo_official.png",
    apple: "/studio_os_logo_official_cropped.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <OrganizationJsonLd />
        <WebSiteJsonLd />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} antialiased`}>
        <MarketingEventTracker />
        {children}
      </body>
    </html>
  );
}
