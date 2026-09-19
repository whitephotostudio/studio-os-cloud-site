"use client";

import { useId, useState, type CSSProperties } from "react";

export type ProductBackdrop = {
  url: string;
  fallbackUrl: string;
  foregroundUrl: string;
  landscape: boolean;
  foregroundScale: number;
  foregroundVerticalOffset: number;
  blurPx: number;
};

type Props = {
  imageUrl?: string | null;
  style?: CSSProperties;
  imageFilter?: string;
  backdrop?: ProductBackdrop | null;
};

export function ProductPhotoSurface(props: Props) {
  // A new pose/backdrop gets fresh loading state immediately. A late image
  // event from the previous selection cannot reveal an incomplete preview.
  const key = JSON.stringify([
    props.imageUrl,
    props.backdrop?.url,
    props.backdrop?.fallbackUrl,
    props.backdrop?.foregroundUrl,
  ]);
  return <PhotoSurface key={key} {...props} />;
}

function PhotoSurface({ imageUrl, style, imageFilter, backdrop }: Props) {
  const blurId = useId();
  const [backdropSrc, setBackdropSrc] = useState(backdrop?.url || backdrop?.fallbackUrl || "");
  const [backgroundLoaded, setBackgroundLoaded] = useState(false);
  const [foregroundLoaded, setForegroundLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = backgroundLoaded && foregroundLoaded && !failed;
  const width = backdrop?.landscape ? 1067 : 600;
  const height = 800;
  const scale = backdrop?.landscape ? backdrop.foregroundScale : 1;
  const offset = backdrop?.landscape ? backdrop.foregroundVerticalOffset : 0;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        ...style,
        position: "relative",
        overflow: "hidden",
        filter: imageFilter,
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: style?.objectFit ?? "contain",
            objectPosition: style?.objectPosition,
            display: "block",
            visibility: backdrop && ready ? "hidden" : "visible",
          }}
        />
      ) : (
        <div style={{ display: "grid", placeItems: "center", height: "100%", color: "#aaa", fontSize: 11 }}>
          Preview
        </div>
      )}
      {backdrop && !failed ? (
        // Render both images directly. Signed storage images can be displayed
        // without CORS permission to export canvas pixels via toDataURL().
        <svg
          aria-hidden="true"
          width="100%"
          height="100%"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio={style?.objectFit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
          style={{ position: "absolute", inset: 0, display: "block", opacity: ready ? 1 : 0 }}
        >
          <defs>
            <filter id={blurId} colorInterpolationFilters="sRGB">
              <feGaussianBlur stdDeviation={backdrop.blurPx} />
            </filter>
          </defs>
          <image
            key={backdropSrc}
            href={backdropSrc}
            width={width}
            height={height}
            preserveAspectRatio="xMidYMid slice"
            filter={backdrop.blurPx > 0 ? `url(#${blurId})` : undefined}
            onLoad={() => setBackgroundLoaded(true)}
            onError={() => {
              if (backdrop.fallbackUrl && backdropSrc !== backdrop.fallbackUrl) {
                setBackgroundLoaded(false);
                setBackdropSrc(backdrop.fallbackUrl);
              } else {
                setFailed(true);
              }
            }}
          />
          <image
            href={backdrop.foregroundUrl}
            x={(width - width * scale) / 2}
            y={(height - height * scale) / 2 + height * offset}
            width={width * scale}
            height={height * scale}
            preserveAspectRatio={backdrop.landscape ? "xMidYMid meet" : "xMidYMid slice"}
            onLoad={() => setForegroundLoaded(true)}
            onError={() => setFailed(true)}
          />
        </svg>
      ) : null}
    </div>
  );
}
