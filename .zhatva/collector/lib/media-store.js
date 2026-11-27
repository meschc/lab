const fs = require('fs');
const { imageSize } = require('./image-size');
const path = require('path');
const crypto = require('crypto');
const { loadConfig } = require('./config');
const { readJson, writeJsonAtomic, ensureDir } = require('./fsx');
const { toWebp, CONVERTIBLE } = require('./media-convert');

const mediaDir = (caseDir) => path.join(caseDir, 'media');
const indexFile = (caseDir) => path.join(mediaDir(caseDir), 'index.json');

const loadIndex = (caseDir) => {
  const items = readJson(indexFile(caseDir), []);
  return Array.isArray(items) ? items : [];
};

const saveIndex = (caseDir, items) => {
  ensureDir(mediaDir(caseDir));
  writeJsonAtomic(indexFile(caseDir), items);
};

const hashBuffer = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function touchExisting(items, existing, at) {
  return items.map((item) =>
    item.contentHash === existing.contentHash
      ? { ...item, seenAt: [...(item.seenAt || [item.capturedAt]), at] }
      : item
  );
}

function fileName(at, contentHash, format) {
  return `${at.slice(0, 10)}-${contentHash.slice(0, 4)}.${format}`;
}

function storeBuffer(caseDir, buffer, meta) {
  const contentHash = hashBuffer(buffer);
  const items = loadIndex(caseDir);
  const at = meta.at || new Date().toISOString();

  const existing = items.find((item) => item.contentHash === contentHash);
  if (existing) {
    saveIndex(caseDir, touchExisting(items, existing, at));
    return { stored: false, item: existing };
  }

  ensureDir(mediaDir(caseDir));
  const sourceFormat = meta.format;
  const stagedName = fileName(at, contentHash, sourceFormat);
  const stagedPath = path.join(mediaDir(caseDir), stagedName);
  fs.writeFileSync(stagedPath, buffer);

  let format = sourceFormat;
  let converted = false;

  if (meta.type === 'image' && CONVERTIBLE.has(sourceFormat)) {
    const webpName = fileName(at, contentHash, 'webp');
    const webpPath = path.join(mediaDir(caseDir), webpName);
    const result = toWebp(stagedPath, webpPath, sourceFormat);
    if (result.converted) {
      fs.unlinkSync(stagedPath);
      format = 'webp';
      converted = true;
    }
  }

  const storedFile = fileName(at, contentHash, format);
  const size = meta.type === 'image' ? imageSize(path.join(mediaDir(caseDir), storedFile)) : null;

  const item = {
    file: storedFile,
    type: meta.type,
    format,
    originalFormat: sourceFormat,
    ...(size ? { width: size.width, height: size.height } : {}),
    converted,
    copied: true,
    sourcePath: meta.sourcePath || null,
    ...(meta.origin ? { origin: meta.origin } : {}),
    contentHash,
    capturedAt: at,
    seenAt: [at],
    sessionId: meta.sessionId || null,
    contextExcerpt: meta.contextExcerpt || '',
    caption: null,
  };

  saveIndex(caseDir, [...items, item]);
  return { stored: true, item };
}

function referenceOnly(caseDir, meta, sizeBytes) {
  const items = loadIndex(caseDir);
  const at = meta.at || new Date().toISOString();
  const contentHash = hashBuffer(Buffer.from(`${meta.sourcePath}:${sizeBytes}`));

  if (items.some((item) => item.contentHash === contentHash)) return { stored: false, item: null };

  const item = {
    file: null,
    type: meta.type,
    format: meta.format,
    originalFormat: meta.format,
    converted: false,
    copied: false,
    skipReason: `файл ${sizeBytes} Б больше порога maxAutoCopyMediaBytes`,
    sourcePath: meta.sourcePath,
    contentHash,
    capturedAt: at,
    seenAt: [at],
    sessionId: meta.sessionId || null,
    contextExcerpt: meta.contextExcerpt || '',
    caption: null,
  };

  saveIndex(caseDir, [...items, item]);
  return { stored: true, item };
}

function ingestFile(caseDir, meta) {
  let stat;
  try {
    stat = fs.statSync(meta.sourcePath);
  } catch {
    return { stored: false, item: null };
  }
  if (!stat.isFile()) return { stored: false, item: null };

  if (stat.size > loadConfig().maxAutoCopyMediaBytes) return referenceOnly(caseDir, meta, stat.size);

  return storeBuffer(caseDir, fs.readFileSync(meta.sourcePath), meta);
}

function setCaption(caseDir, file, caption) {
  saveIndex(
    caseDir,
    loadIndex(caseDir).map((item) => (item.file === file ? { ...item, caption } : item))
  );
}

module.exports = { loadIndex, ingestFile, storeBuffer, setCaption, mediaDir };
