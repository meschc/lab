const { execFileSync } = require('child_process');

const SIPS_TIMEOUT_MS = 5000;

function parseSips(output) {
  const width = /pixelWidth:\s*(\d+)/.exec(output);
  const height = /pixelHeight:\s*(\d+)/.exec(output);
  if (!width || !height) return null;
  return { width: Number(width[1]), height: Number(height[1]) };
}

// Размеры нужны только чтобы выбрать кадр (широкий или квадрат), поэтому отсутствие sips —
// не ошибка: вызывающий просто оставит кадр по умолчанию.
function imageSize(file) {
  try {
    const output = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], {
      encoding: 'utf8',
      timeout: SIPS_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseSips(output);
  } catch {
    return null;
  }
}

module.exports = { imageSize };
