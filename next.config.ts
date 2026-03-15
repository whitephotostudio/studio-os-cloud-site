import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "bwqhzczxoevouiondjak.supabase.co",
      },
    ],
  },
};

export default nextConfig;
