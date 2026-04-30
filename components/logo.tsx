import Image from "next/image";

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`${small ? "h-20 w-20" : "h-24 w-24"} flex shrink-0 items-center justify-center overflow-hidden`}
    >
      <Image
        src="/studio_os_logo_official_cropped.png"
        alt="Studio OS Cloud"
        width={700}
        height={700}
        priority
        className="block h-full w-full object-contain"
      />
    </span>
  );
}
