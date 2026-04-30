import Image from "next/image";
import { Reveal } from "./Reveal";

type Gallery = {
  title: string;
  text: string;
  className: string;
  image?: string;
  images?: string[];
};

const galleries: Gallery[] = [
  {
    title: "Wedding Gallery",
    text: "Elegant delivery for finished stories, favorites, and downloads.",
    className: "from-neutral-950 via-neutral-800 to-red-950",
    image: "/marketing/wedding-gallery-cover.jpg",
  },
  {
    title: "School Gallery",
    text: "Private access, parent-friendly ordering, and organized jobs.",
    className: "from-neutral-800 via-stone-700 to-neutral-950",
    images: [
      "/marketing/school-gallery-01.png",
      "/marketing/school-gallery-cover.jpg",
      "/phone-gallery-student-1.png",
      "/marketing/school-gallery-02.png",
      "/phone-gallery-student-2.png",
      "/marketing/school-gallery-03.png",
    ],
  },
  {
    title: "Portrait Gallery",
    text: "Polished proofing and ordering for everyday studio sessions.",
    className: "from-neutral-900 via-zinc-700 to-zinc-950",
    images: [
      "/marketing/portrait-gallery-01.png",
      "/marketing/portrait-gallery-02.png",
      "/marketing/portrait-gallery-03.png",
      "/marketing/portrait-gallery-04.png",
      "/marketing/portrait-gallery-05.png",
      "/marketing/portrait-gallery-cover-generated.png",
    ],
  },
  {
    title: "Sports Gallery",
    text: "Teams, athletes, packages, and deadline-driven production.",
    className: "from-zinc-950 via-red-950 to-neutral-700",
    image: "/marketing/sports-gallery-cover-generated.png",
  },
  {
    title: "Event Gallery",
    text: "Fast, polished galleries for conferences, dances, and community events.",
    className: "from-neutral-950 via-red-900 to-stone-700",
    images: [
      "/marketing/event-gallery-01.png",
      "/marketing/event-gallery-02.png",
      "/marketing/event-gallery-03.png",
      "/marketing/event-gallery-04.png",
      "/marketing/event-gallery-05.png",
      "/marketing/event-gallery-cover-generated.png",
    ],
  },
];

export function GalleryExperienceSection() {
  return (
    <section id="gallery-experience" className="bg-white px-4 py-20 text-neutral-950 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-3xl">
          <p className="marketing-kicker text-red-600">
            Gallery Experience
          </p>
          <h2 className="marketing-title mt-4">
            Gallery delivery that feels premium.
          </h2>
          <p className="marketing-body mt-5 text-neutral-600">
            Create polished client galleries for portraits, weddings, events,
            schools, sports, and volume jobs &mdash; without disconnecting the gallery
            from the work behind it.
          </p>
        </Reveal>

        <Reveal delay={120} className="gallery-rail mt-12 -mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-hidden md:px-0">
          <div className="gallery-rail-track flex w-max snap-x snap-mandatory gap-4 pr-4 md:pr-0">
            {[...galleries, ...galleries].map((gallery, index) => (
              <GalleryCover
                key={`${gallery.title}-${index}`}
                gallery={gallery}
                index={index % galleries.length}
                duplicate={index >= galleries.length}
              />
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
  duplicate,
}: {
  gallery: Gallery;
  index: number;
  duplicate: boolean;
}) {
  return (
    <article
      aria-hidden={duplicate}
      className={`gallery-cover premium-card group h-[390px] w-[78vw] max-w-[340px] shrink-0 snap-center overflow-hidden rounded-[1.5rem] bg-gradient-to-br ${gallery.className} p-px shadow-sm ${duplicate ? "hidden md:block" : ""}`}
    >
      <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-[1.45rem] border border-white/10 bg-black/10 p-5 text-white">
        {gallery.image ? (
          <Image
            src={gallery.image}
            alt=""
            fill
            sizes="(max-width: 767px) 78vw, 340px"
            className="gallery-cover-art object-cover"
            priority={!duplicate && index === 0}
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
          <div className="mb-4 h-px w-full bg-white/20" />
          <p className="marketing-kicker text-white/50">
            0{index + 1}
          </p>
          <h3 className="marketing-card-title mt-2">
            {gallery.title}
          </h3>
          <p className="marketing-caption mt-3 text-white/70">{gallery.text}</p>
        </div>
      </div>
    </article>
  );
}
