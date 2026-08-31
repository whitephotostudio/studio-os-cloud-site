import type { Metadata } from "next";
import { GalleryDemoExperience } from "@/components/marketing/GalleryDemoExperience";

export const metadata: Metadata = {
  title: "Interactive Client Gallery Demo",
  description:
    "Try a safe Studio OS Cloud gallery demonstration with photo viewing, favorites, download controls, and ordering guidance.",
  alternates: { canonical: "https://www.studiooscloud.com/sample-galleries/demo" },
  robots: { index: true, follow: true },
};

export default function GalleryDemoPage() {
  return <GalleryDemoExperience />;
}
