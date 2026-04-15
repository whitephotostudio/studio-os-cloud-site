import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In to Your Account",
  description:
    "Sign in to your Studio OS Cloud account to manage galleries, orders, and your photography workflow.",
  alternates: {
    canonical: "https://studiooscloud.com/sign-in",
  },
  openGraph: {
    title: "Sign In — Studio OS Cloud",
    description:
      "Access your Studio OS Cloud dashboard. Manage galleries, orders, and your full photography workflow.",
    url: "https://studiooscloud.com/sign-in",
  },
};

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
