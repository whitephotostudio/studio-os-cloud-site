import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { OrganizationJsonLd, WebSiteJsonLd } from "@/components/json-ld";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const baseUrl = "https://studiooscloud.com";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "Studio OS Cloud — Professional Photography Workflow Software",
    template: "%s | Studio OS Cloud",
  },
  description:
    "End-to-end photography workflow platform for school, event, and high-volume photographers. Camera tethering, roster management, online galleries, client ordering, AI backgrounds, and print fulfillment — all in one connected system.",
  keywords: [
    "photography workflow software",
    "school photography software",
    "school picture day software",
    "photography gallery platform",
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
    title: "Studio OS Cloud — Professional Photography Workflow Software",
    description:
      "Run your photography business from one connected system. Capture, organize, sell, and deliver — without juggling multiple tools.",
    images: [
      {
        url: "/studio_os_logo.png",
        width: 1200,
        height: 630,
        alt: "Studio OS Cloud — Photography Workflow Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Studio OS Cloud — Professional Photography Workflow Software",
    description:
      "Run your photography business from one connected system. Capture, organize, sell, and deliver.",
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
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <OrganizationJsonLd />
        <WebSiteJsonLd />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
