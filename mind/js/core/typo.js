// Типографика: висячие предлоги не оставляем в конце строки — склеиваем со следующим словом
// неразрывным пробелом (U+00A0). Тире тоже не остаётся в начале строки.
const SHORT = 'в|во|к|ко|с|со|у|о|об|от|до|из|за|на|по|не|ни|и|а|но|да|или|для|над|под|при|про|без|как|что';  // частицы бы/же/ли/то относятся к предыдущему слову — их не склеиваем вперёд
const AFTER_SHORT = new RegExp(`(?<![\\p{L}\\p{N}-])(${SHORT})[ \\t]+(?=\\S)`, 'giu');
const BEFORE_DASH = /[ \t]+(?=[—–])/g;
const NBSP = ' ';

export const typo = (s) => (s ? String(s).replace(AFTER_SHORT, `$1${NBSP}`).replace(BEFORE_DASH, NBSP) : s);

// в адресах и поисковых запросах неразрывный пробел превращаем обратно в обычный
export const plain = (s) => String(s).replace(/ /g, ' ');

// статический текст страницы: обходим текстовые узлы
export function typoDom(root = document.body) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && /^(SCRIPT|STYLE)$/.test(n.parentElement.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  while (walk.nextNode()) walk.currentNode.textContent = typo(walk.currentNode.textContent);
}
