import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing for Galleries, Online Booking & Workflow",
  description:
    "Compare Studio OS Cloud plans in USD for US businesses and CAD for businesses in Canada, with premium galleries, online booking, desktop capture, AI tools, and connected production.",
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
