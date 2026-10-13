const MAX_DEPTH = 6;
const FORMAT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif' };

function imageFrom(node) {
  if (!node || typeof node !== 'object') return null;

  const mime = node.mimeType || node.media_type || node.source?.media_type;
  const data = node.data || node.source?.data;
  if (typeof data !== 'string' || !FORMAT_BY_MIME[mime]) return null;

  return { format: FORMAT_BY_MIME[mime], data };
}

function collectImages(node, depth = 0) {
  if (depth > MAX_DEPTH || !node || typeof node !== 'object') return [];

  const here = imageFrom(node);
  if (here) return [here];

  return Object.values(node).flatMap((value) => collectImages(value, depth + 1));
}

module.exports = { collectImages };
