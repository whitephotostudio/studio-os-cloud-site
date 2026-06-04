import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "./Reveal";

type Gallery = {
  title: string;
  text: string;
  className: string;
  href: string;
  image?: string;
  images?: string[];
  label: string;
};

const galleryHighlights: Gallery[] = [
  {
    title: "Wedding Gallery",
    label: "01",
    text: "A finished-story gallery for favorites, downloads, and elegant client delivery.",
    className: "from-neutral-950 via-neutral-800 to-red-950",
    href: "/sample-galleries#wedding-gallery",
    image: "/marketing/wedding-gallery-cover.jpg",
  },
  {
    title: "Portrait Gallery",
    label: "02",
    text: "A clean proofing and ordering experience for portrait, family, and studio work.",
    className: "from-neutral-900 via-zinc-700 to-zinc-950",
    href: "/sample-galleries#portrait-gallery",
    image: "/marketing/portrait-gallery-preview-v2.webp",
  },
  {
    title: "School Gallery",
    label: "03",
    text: "Private access and parent-friendly ordering without losing production structure.",
    className: "from-neutral-800 via-stone-700 to-neutral-950",
    href: "/sample-galleries#school-gallery",
    images: [
      "/marketing/school-gallery-cover.jpg",
      "/marketing/school-gallery-01.png",
      "/phone-gallery-student-1.png",
      "/marketing/school-gallery-02.png",
      "/phone-gallery-student-2.png",
      "/marketing/school-gallery-03.png",
    ],
  },
];

const proofPoints = [
  "Branded client presentation",
  "Favorites, ordering, and downloads",
  "Projects stay connected behind the gallery",
];

export function GalleryExperienceSection() {
  return (
    <section
      id="gallery-experience"
      className="bg-white px-4 py-16 text-neutral-950 sm:px-6 lg:px-8 lg:py-24"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-end">
          <Reveal className="max-w-2xl">
            <p className="marketing-kicker text-red-600">
              Gallery Experience
            </p>
            <h2 className="marketing-title mt-4">
              A quick look at premium gallery delivery.
            </h2>
            <p className="marketing-body mt-5 text-neutral-600">
              Studio OS Cloud gives photographers polished client galleries
              for weddings, portraits, schools, sports, events, and everyday
              studio work. Preview the core experience here, then explore the
              full gallery showroom by job type.
            </p>
            <Link
              href="/sample-galleries"
              data-marketing-event="cta_sample_galleries"
              data-marketing-label="Gallery experience section"
              data-marketing-placement="home_gallery_experience"
              className="marketing-button premium-button mt-8 inline-flex items-center gap-2 rounded-full bg-neutral-950 px-5 py-3 text-white transition hover:bg-black"
            >
              Explore Sample Galleries
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>

          <Reveal delay={120}>
            <div className="rounded-[1.5rem] border border-neutral-200 bg-neutral-50 p-5 sm:p-6">
              <p className="marketing-kicker text-neutral-500">
                Gallery highlights
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {proofPoints.map((point) => (
                  <div
                    key={point}
                    className="rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-sm font-semibold text-neutral-800 shadow-sm"
                  >
                    {point}
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal delay={160} className="mt-11">
          <div className="grid gap-4 md:grid-cols-3">
            {galleryHighlights.map((gallery, index) => (
              <GalleryCover key={gallery.title} gallery={gallery} index={index} />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function GalleryCover({
  gallery,
  index,
}: {
  gallery: Gallery;
  index: number;
}) {
  return (
    <Link
      href={gallery.href}
      data-marketing-event="sample_gallery_card"
      data-marketing-label={gallery.title}
      data-marketing-placement="home_gallery_experience"
      className={`gallery-cover premium-card group block h-[360px] overflow-hidden rounded-[1.5rem] bg-gradient-to-br ${gallery.className} p-px shadow-sm`}
    >
      <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-[1.45rem] border border-white/10 bg-black/10 p-5 text-white">
        {gallery.image ? (
          <Image
            src={gallery.image}
            alt=""
            fill
            sizes="(max-width: 639px) 92vw, (max-width: 1023px) 45vw, 240px"
            className="gallery-cover-art object-cover"
            priority={index === 0}
          />
        ) : gallery.images ? (
          <div className="gallery-cover-art relative z-10">
            <div className="grid grid-cols-3 gap-2">
              {gallery.images.map((src, itemIndex) => (
                <div
                  key={itemIndex}
                  className={`relative overflow-hidden rounded-xl bg-white/20 ${
                    itemIndex === 0 ? "col-span-2 row-span-2 aspect-square" : "aspect-square"
                  }`}
                >
                  <Image
                    src={src}
                    alt=""
                    fill
                    sizes="120px"
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="gallery-cover-art relative z-10">
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, itemIndex) => (
                <div
                  key={itemIndex}
                  className={`rounded-xl bg-white/20 ${
                    itemIndex === 0 ? "col-span-2 row-span-2 aspect-square" : "aspect-square"
                  }`}
                />
              ))}
            </div>
          </div>
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.36)_46%,rgba(0,0,0,0.78))]" />
        <div className="relative z-10 mt-auto">
          <p className="marketing-kicker text-white/50">
            {gallery.label}
          </p>
          <h3 className="marketing-card-title mt-2">
            {gallery.title}
          </h3>
          <p className="marketing-caption mt-3 text-white/70">{gallery.text}</p>
        </div>
      </div>
    </Link>
  );
}
