import Image from "next/image";

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center justify-center leading-none ${
        small ? "scale-95 origin-left" : ""
      }`}
    >
      <Image
        src="/studio_os_logo.png"
        alt="Studio OS Cloud"
        width={85}
        height={24}
        priority
        className="block h-auto w-auto object-contain"
      />

      <span className="mt-0 text-[11px] font-medium tracking-tight text-neutral-500">
        Studio OS Cloud
      </span>
    </div>
  );
}