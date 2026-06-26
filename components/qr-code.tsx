"use client";

// Lightweight QR code — renders an SVG QR using @zxing/library's
// BrowserQRCodeSvgWriter (already a dependency for barcode scanning), so it adds
// no new packages. Used to show a scannable gallery link clients can point a
// phone at to open their photos.

import { useEffect, useRef } from "react";
import { BrowserQRCodeSvgWriter } from "@zxing/library";

export default function QrCode({
  value,
  size = 196,
}: {
  value: string;
  size?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    const v = (value ?? "").trim();
    if (!v) return;
    try {
      const writer = new BrowserQRCodeSvgWriter();
      const svg = writer.write(v, size, size);
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
      svg.style.display = "block";
      el.appendChild(svg);
    } catch {
      el.textContent = "QR unavailable";
    }
    return () => {
      el.innerHTML = "";
    };
  }, [value, size]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label="Gallery QR code"
      style={{ width: size, height: size }}
    />
  );
}
