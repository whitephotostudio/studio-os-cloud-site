import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Studio OS Mobile",
    short_name: "Studio OS Mobile",
    description: "Mobile control app for Studio OS Cloud photographers.",
    start_url: "/m",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#cc0000",
    icons: [
      {
        src: "/studio_os_logo_official.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/studio_os_logo_official_cropped.png",
        sizes: "700x700",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
