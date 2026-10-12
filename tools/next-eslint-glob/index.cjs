/* eslint-disable @typescript-eslint/no-require-imports -- Next's ESLint plugin loads this adapter with CommonJS require. */
const path = require('node:path');
const fs = require('node:fs');
const { globSync: tinyGlobSync, isDynamicPattern } = require('tinyglobby');

// Next 16.4's get-root-dirs is the sole consumer: globSync(string,
// {onlyDirectories:true}). This is deliberately not a general fast-glob shim.
// Keep absolute patterns absolute and strip tinyglobby's directory slash.
function globSync(pattern, options) {
  if (typeof pattern !== 'string' || options?.onlyDirectories !== true ||
      Object.keys(options).some(key => key !== 'onlyDirectories')) {
    throw new Error('Unsupported Next ESLint glob API; review the scoped adapter.');
  }
  // tinyglobby turns a literal equal to cwd into an empty internal pattern.
  // Literal directory settings need no glob parser or filesystem traversal.
  if (!isDynamicPattern(pattern)) {
    try {
      return fs.statSync(pattern).isDirectory()
        ? [pattern.length > 1 ? pattern.replace(/\/$/, '') : pattern] : [];
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'ENAMETOOLONG'].includes(error.code)) return [];
      throw error;
    }
  }
  return tinyGlobSync(pattern, {
    onlyDirectories: true,
    absolute: path.isAbsolute(pattern),
    expandDirectories: false,
  }).map(directory => directory.length > 1 ? directory.replace(/\/$/, '') : directory);
}

module.exports = { globSync };
