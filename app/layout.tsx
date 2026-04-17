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
    default: "Studio OS Cloud | Premium Photography Gallery and Workflow Platform",
    template: "%s | Studio OS Cloud",
  },
  description:
    "Premium photography gallery and workflow platform for photographers who want branded online galleries, client ordering, digital delivery, and deeper workflow control. Connect desktop and cloud in one system.",
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
    title: "Studio OS Cloud | Premium Photography Gallery and Workflow Platform",
    description:
      "Great galleries for all photographers. Deeper workflow power for photographers who need more.",
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
    title: "Studio OS Cloud | Premium Photography Gallery and Workflow Platform",
    description:
      "Premium online galleries, client ordering, and connected desktop + cloud workflow.",
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
