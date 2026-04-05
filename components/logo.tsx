import Image from "next/image";

export function Logo({
  small = false,
  caption = "brand",
}: {
  small?: boolean;
  caption?: "brand" | "powered";
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center leading-none ${
        small ? "origin-left" : ""
      }`}
    >
      <Image
        src="/studio_os_logo.png"
        alt="Studio OS Cloud"
        width={small ? 56 : 85}
        height={small ? 39 : 24}
        priority
        className="block h-auto w-auto object-contain"
      />

      <span
        className={`text-neutral-500 ${
          small
            ? "mt-1 text-[8px] font-semibold uppercase tracking-[0.14em]"
            : "mt-0 text-[11px] font-medium tracking-tight"
        }`}
      >
        {caption === "powered" ? "Powered by Studio OS Cloud" : "Studio OS Cloud"}
      </span>
    </div>
  );
}
