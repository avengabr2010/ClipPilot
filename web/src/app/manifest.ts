import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ClipPilot",
    short_name: "ClipPilot",
    description: "Une longue vidéo. Plusieurs clips. Zéro montage.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#07060c",
    theme_color: "#07060c",
    lang: "fr",
    categories: ["productivity", "video", "photo"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [{ name: "Créer mes clips", url: "/create" }],
  };
}
