import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing for Galleries, Online Booking & Workflow",
  description:
    "Studio OS Cloud pricing in Canadian dollars for online school booking, automatic student rosters, premium galleries, ordering, desktop capture, AI tools, and connected production.",
  alternates: {
    canonical: "https://www.studiooscloud.com/pricing",
  },
  openGraph: {
    title: "Studio OS Cloud Pricing",
    description:
      "Compare Studio OS Cloud plans for galleries, online booking, automatic student rosters, ordering, desktop workflow, and production control.",
    url: "https://www.studiooscloud.com/pricing",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
