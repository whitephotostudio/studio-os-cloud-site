export type EventAlbumNavigationCollection = {
  id: string;
  title?: string | null;
  cover_photo_url?: string | null;
};

export type EventAlbumNavigationImage = {
  collectionId?: string | null;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  url: string;
};

export type EventAlbumChoice = {
  value: string;
  collectionId: string | null;
  title: string;
  photoCount: number;
  thumbnailUrl: string | null;
};

const clean = (value?: string | null) => (value ?? "").trim();
const thumbnail = (image?: EventAlbumNavigationImage) =>
  clean(image?.thumbnailUrl) || clean(image?.previewUrl) || clean(image?.url) || null;

export function accessibleEventGalleryImages<T extends EventAlbumNavigationImage>(
  images: T[],
  collections: EventAlbumNavigationCollection[],
): T[] {
  const ids = new Set(collections.map(collection => clean(collection.id)).filter(Boolean));
  return images.filter(image => ids.has(clean(image.collectionId)));
}

/** Inputs come from the access-checked gallery context; never fetch extra albums here. */
export function buildEventAlbumChoices({
  collections,
  images,
  hideAllPhotosAlbum,
  allPhotosTitle,
  albumTitle,
  galleryCoverUrl,
}: {
  collections: EventAlbumNavigationCollection[];
  images: EventAlbumNavigationImage[];
  hideAllPhotosAlbum: boolean;
  allPhotosTitle: string;
  albumTitle: string;
  galleryCoverUrl?: string | null;
}): EventAlbumChoice[] {
  const accessibleImages = accessibleEventGalleryImages(images, collections);
  const choices: EventAlbumChoice[] = hideAllPhotosAlbum ? [] : [{
    value: "__all__",
    collectionId: null,
    title: allPhotosTitle,
    photoCount: accessibleImages.length,
    thumbnailUrl: clean(galleryCoverUrl) || thumbnail(accessibleImages[0]),
  }];
  const seen = new Set<string>();
  for (const collection of collections) {
    const id = clean(collection.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const albumImages = accessibleImages.filter(image => clean(image.collectionId) === id);
    choices.push({
      value: `album:${id}`,
      collectionId: id,
      title: clean(collection.title) || albumTitle,
      photoCount: albumImages.length,
      thumbnailUrl: clean(collection.cover_photo_url) || thumbnail(albumImages[0]),
    });
  }
  return choices;
}

export function initialEventAlbumSelection(
  choices: EventAlbumChoice[],
  requestedCollectionId?: string | null,
): { collectionId: string | null; stage: "albums" | "grid" } {
  const requested = clean(requestedCollectionId);
  if (requested && choices.some(choice => choice.collectionId === requested)) {
    return { collectionId: requested, stage: "grid" };
  }
  return {
    collectionId: null,
    stage: choices.some(choice => choice.collectionId !== null) ? "albums" : "grid",
  };
}

export function eventAlbumChoiceForValue(choices: EventAlbumChoice[], value: string) {
  return choices.find(choice => choice.value === value) ?? null;
}

/** Selection limits what is requested; server permissions still authorize delivery. */
export function imagesInEventAlbum<T extends EventAlbumNavigationImage>(
  images: T[],
  collectionId: string | null,
): T[] {
  return collectionId
    ? images.filter(image => clean(image.collectionId) === collectionId)
    : images;
}
