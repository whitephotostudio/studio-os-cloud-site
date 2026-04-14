"use client";

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

type VisualSlotProps = {
  src?: string;
  alt: string;
  label?: string;
  hint?: string;
  fallback?: ReactNode;
  className?: string;
  imageClassName?: string;
  aspectRatio?: string;
  sizes?: string;
  priority?: boolean;
  dark?: boolean;
  fit?: "cover" | "contain";
  objectPosition?: CSSProperties["objectPosition"];
};

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function VisualSlot({
  src,
  alt,
  label,
  hint,
  fallback,
  className,
  imageClassName,
  aspectRatio = "16 / 10",
  sizes = "(min-width: 1024px) 50vw, 100vw",
  priority = false,
  dark = false,
  fit = "cover",
  objectPosition = "center",
}: VisualSlotProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <div
      className={joinClasses(
        "relative overflow-hidden",
        dark ? "bg-neutral-950" : "bg-white",
        className,
      )}
      style={{ aspectRatio }}
    >
      {showImage ? (
        <Image
          fill
          alt={alt}
          src={src!}
          sizes={sizes}
          priority={priority}
          onError={() => setFailedSrc(src ?? null)}
          className={joinClasses(
            fit === "contain" ? "object-contain" : "object-cover",
            imageClassName,
          )}
          style={{ objectPosition }}
        />
      ) : (
        <div
          className={joinClasses(
            "absolute inset-0 flex flex-col justify-end p-4",
            dark
              ? "bg-[linear-gradient(180deg,rgba(38,38,38,0.96)_0%,rgba(10,10,10,1)_100%)] text-white"
              : "bg-[linear-gradient(180deg,#faf9f7_0%,#f1eee8_100%)] text-neutral-900",
          )}
        >
          <div
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
          {fallback ? <div className="relative z-10">{fallback}</div> : null}
          {!fallback ? (
            <div className="relative z-10 max-w-[16rem] space-y-1.5">
              {label ? (
                <div className="text-sm font-semibold tracking-tight">{label}</div>
              ) : null}
              {hint ? (
                <div
                  className={joinClasses(
                    "text-xs leading-5",
                    dark ? "text-neutral-300" : "text-neutral-500",
                  )}
                >
                  {hint}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
