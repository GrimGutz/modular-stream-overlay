const RELEASE = /^(\d+)\.(\d+)(?:\.(\d+))?$/;

/**
 * A tested version also covers later or earlier patch releases of the same
 * major.minor line, so routine system patches keep reading fields on stream.
 * Pre-release or custom suffixes and other minor lines stay unverified.
 */
export function versionCompatible(testedVersions, version) {
  if (typeof version !== "string" || !Array.isArray(testedVersions)) return false;
  if (testedVersions.includes(version)) return true;
  const current = RELEASE.exec(version);
  if (!current) return false;
  return testedVersions.some(tested => {
    const match = typeof tested === "string" ? RELEASE.exec(tested) : null;
    return Boolean(match) && match[1] === current[1] && match[2] === current[2];
  });
}
