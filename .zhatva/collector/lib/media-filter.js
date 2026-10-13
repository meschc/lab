const path = require('path');
const { loadConfig } = require('./config');

// В кейс идут кадры результата, а не материал, с которого работа начиналась: мудборд и референсы
// лежат в отдельных папках и к интерфейсу самого проекта отношения не имеют.
function isInputMaterial(sourcePath, excludeDirs) {
  const parts = String(sourcePath || '').toLowerCase().split(path.sep);
  return excludeDirs.some((dir) => parts.includes(dir));
}

function showcaseItems(items) {
  const excludeDirs = (loadConfig().mediaExcludeDirs || []).map((dir) => dir.toLowerCase());
  return items.filter(
    (item) => item.copied && item.file && item.origin !== 'chat' && !isInputMaterial(item.sourcePath, excludeDirs)
  );
}

module.exports = { showcaseItems, isInputMaterial };
