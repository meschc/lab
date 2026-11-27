// В статье дата читается как в тексте: «30 сентября 2026», а не «2026-09-30».
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function ruDate(iso) {
  const match = ISO_DATE_RE.exec(String(iso));
  if (!match) return String(iso);
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

module.exports = { ruDate };
