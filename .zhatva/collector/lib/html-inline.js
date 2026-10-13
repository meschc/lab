const { DRAFT_MARK } = require('./doc-store');

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const inline = (text) =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');

function paragraphBlocks(text, className = 'project__body') {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const isDraft = block.startsWith(DRAFT_MARK);
      const content = isDraft ? block.slice(DRAFT_MARK.length).trim() : block;
      const classes = isDraft ? `${className} project__draft` : className;
      return `<p class="${classes}" data-reveal>${inline(content.replace(/\n/g, ' '))}</p>`;
    });
}

const paragraphs = (text, className) => paragraphBlocks(text, className).join('\n  ');

module.exports = { escapeHtml, inline, paragraphBlocks, paragraphs };
