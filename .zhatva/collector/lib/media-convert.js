const fs = require('fs');
const { execFileSync } = require('child_process');
const { loadConfig } = require('./config');

const CONVERTIBLE = new Set(['png', 'jpg', 'jpeg']);
const CONVERT_TIMEOUT_MS = 20000;

function which(bin) {
  try {
    execFileSync('command', ['-v', bin], { stdio: 'ignore', shell: '/bin/sh', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function run(bin, args) {
  execFileSync(bin, args, { stdio: 'ignore', timeout: CONVERT_TIMEOUT_MS });
}

function convertWithCwebp(src, dst, format) {
  // Скриншоты — это текст: lossless сохраняет буквы резкими и всё равно обычно меньше исходного PNG.
  const args = format === 'png' ? ['-lossless', src, '-o', dst] : ['-q', String(loadConfig().webpQuality), src, '-o', dst];
  run('cwebp', args);
}

function convertWithSips(src, dst) {
  run('sips', ['-s', 'format', 'webp', src, '--out', dst]);
}

function toWebp(src, dst, format) {
  if (!CONVERTIBLE.has(format)) return { converted: false, reason: 'формат не конвертируется' };

  const converters = [
    { available: () => which('cwebp'), convert: () => convertWithCwebp(src, dst, format) },
    { available: () => which('sips'), convert: () => convertWithSips(src, dst) },
  ];

  for (const converter of converters) {
    if (!converter.available()) continue;
    try {
      converter.convert();
      if (fs.existsSync(dst) && fs.statSync(dst).size > 0) return { converted: true };
    } catch {
      try { fs.unlinkSync(dst); } catch {}
    }
  }

  return { converted: false, reason: 'конвертер недоступен или не справился' };
}

module.exports = { toWebp, CONVERTIBLE };
