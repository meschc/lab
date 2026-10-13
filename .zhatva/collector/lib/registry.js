const path = require('path');
const { loadConfig } = require('./config');
const { readJson, writeJsonAtomic, withLock } = require('./fsx');

const registryFile = () => path.join(loadConfig().casesRoot, '_registry.json');
const lockFile = () => path.join(loadConfig().casesRoot, '_registry.lock');

function loadRegistry() {
  const entries = readJson(registryFile(), []);
  return Array.isArray(entries) ? entries : [];
}

function findEntry(entries, { root, remoteHash }) {
  const byRoot = entries.find((e) => e.root === root);
  if (byRoot) return byRoot;
  if (!remoteHash) return null;
  return entries.find((e) => e.remoteHash === remoteHash) || null;
}

function uniqueFolderName(entries, baseName, pathHash) {
  const taken = new Set(entries.map((e) => e.folderName));
  if (!taken.has(baseName)) return baseName;
  return `${baseName}-${pathHash.slice(0, 6)}`;
}

function makeEntry(identity, now) {
  return {
    folderName: identity.folderName,
    root: identity.root,
    pathHash: identity.pathHash,
    remote: identity.remote || null,
    remoteHash: identity.remoteHash || null,
    firstSeen: now,
    lastSeen: now,
    tracking: 'unknown',
    askedCount: 0,
  };
}

function mergeEntry(entry, identity, now) {
  return {
    ...entry,
    root: identity.root,
    pathHash: identity.pathHash,
    remote: identity.remote || entry.remote,
    remoteHash: identity.remoteHash || entry.remoteHash,
    lastSeen: now,
  };
}

function upsert(identity, patch = {}) {
  return withLock(lockFile(), () => {
    const entries = loadRegistry();
    const now = new Date().toISOString();
    const existing = findEntry(entries, identity);

    const base = existing
      ? mergeEntry(existing, identity, now)
      : makeEntry(
          { ...identity, folderName: uniqueFolderName(entries, identity.folderName, identity.pathHash) },
          now
        );
    const updated = { ...base, ...patch };

    const next = existing
      ? entries.map((e) => (e.folderName === existing.folderName ? updated : e))
      : [...entries, updated];

    writeJsonAtomic(registryFile(), next);
    return updated;
  });
}

function lookup(identity) {
  return findEntry(loadRegistry(), identity);
}

module.exports = { loadRegistry, lookup, upsert };
