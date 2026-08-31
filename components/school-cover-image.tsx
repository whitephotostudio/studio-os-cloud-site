"use client";

import { useMemo, useState } from "react";
import { proxiedPhotoUrl } from "@/lib/photo-url";

type SchoolCoverImageProps = {
  sources: string[];
  brightness?: number;
};

export default function SchoolCoverImage({
  sources,
  brightness = 0.85,
}: SchoolCoverImageProps) {
  const normalizedSources = useMemo(
    () =>
      Array.from(
        new Set(
          sources.map((source) => proxiedPhotoUrl(source)).filter(Boolean),
        ),
      ),
    [sources],
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = normalizedSources[sourceIndex];

  if (!source) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={source}
      src={source}
      alt=""
      onError={() => setSourceIndex((current) => current + 1)}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        filter: `brightness(${brightness})`,
      }}
    />
  );
}
