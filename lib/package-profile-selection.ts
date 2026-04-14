type PackageProfileLike = {
  id?: string | null;
  name?: string | null;
  profile_name?: string | null;
};

type PackageLike = {
  profile_id?: string | null;
  profile_name?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function looksDefaultLabel(value: string | null | undefined) {
  return /\bdefault\b/i.test(clean(value));
}

export function resolvePackageProfileId(params: {
  selectedProfileId?: string | null;
  packageProfiles?: PackageProfileLike[] | null;
  packages?: PackageLike[] | null;
}) {
  const selectedProfileId = clean(params.selectedProfileId);
  const packageProfiles = params.packageProfiles ?? [];
  const packages = params.packages ?? [];

  const availableProfileIds = new Set(
    packages.map((pkg) => clean(pkg.profile_id)).filter(Boolean),
  );

  if (selectedProfileId && availableProfileIds.has(selectedProfileId)) {
    return selectedProfileId;
  }

  const defaultNamedProfile = packageProfiles.find((profile) => {
    const profileId = clean(profile.id);
    if (!profileId) return false;
    if (availableProfileIds.size && !availableProfileIds.has(profileId)) return false;
    return (
      looksDefaultLabel(profile.name) || looksDefaultLabel(profile.profile_name)
    );
  });
  if (defaultNamedProfile?.id) {
    return clean(defaultNamedProfile.id);
  }

  const firstProfileId =
    packageProfiles
      .map((profile) => clean(profile.id))
      .find((profileId) =>
        availableProfileIds.size ? availableProfileIds.has(profileId) : Boolean(profileId),
      ) ?? "";
  if (firstProfileId) {
    return firstProfileId;
  }

  const defaultNamedPackageProfileId =
    packages.find((pkg) => looksDefaultLabel(pkg.profile_name))?.profile_id ?? "";
  if (clean(defaultNamedPackageProfileId)) {
    return clean(defaultNamedPackageProfileId);
  }

  return packages.map((pkg) => clean(pkg.profile_id)).find(Boolean) ?? null;
}

export function filterPackagesForProfile<T extends PackageLike>(
  packages: T[],
  params: {
    selectedProfileId?: string | null;
    packageProfiles?: PackageProfileLike[] | null;
  },
) {
  const resolvedProfileId = resolvePackageProfileId({
    selectedProfileId: params.selectedProfileId,
    packageProfiles: params.packageProfiles,
    packages,
  });

  if (!resolvedProfileId || clean(resolvedProfileId).toLowerCase() === "default") {
    return {
      packages,
      resolvedProfileId: resolvedProfileId || null,
    };
  }

  const profilePackages = packages.filter(
    (pkg) => clean(pkg.profile_id) === clean(resolvedProfileId),
  );

  return {
    packages: profilePackages.length ? profilePackages : packages,
    resolvedProfileId,
  };
}
