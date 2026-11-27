const { execFileSync } = require('child_process');

const GIT_TIMEOUT_MS = 5000;
const TOP_PATHS = 5;

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_TIMEOUT_MS,
  });
}

function topChangedAreas(root, range) {
  const output = git(root, ['log', ...range, '--name-only', '--pretty=format:']);
  const counts = new Map();

  for (const line of output.split('\n')) {
    const file = line.trim();
    if (!file) continue;
    const area = file.includes('/') ? file.split('/').slice(0, 2).join('/') : file;
    counts.set(area, (counts.get(area) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_PATHS)
    .map(([area, count]) => `${area} (${count})`);
}

function commitsIn(root, range) {
  return git(root, ['log', ...range, '--oneline']).split('\n').filter(Boolean);
}

function gitFacts(root, since) {
  try {
    // Кейс часто заводят на проекте с историей: если за срок кейса коммитов нет, берём историю целиком.
    const sinceRange = [`--since=${since}`];
    const range = commitsIn(root, sinceRange).length ? sinceRange : [];
    const commits = commitsIn(root, range);
    if (!commits.length) return '';

    const firstDate = git(root, ['log', ...range, '--reverse', '--format=%ad', '--date=short'])
      .split('\n')
      .filter(Boolean)[0];
    const lastDate = git(root, ['log', '-1', '--format=%ad', '--date=short']).trim();
    const areas = topChangedAreas(root, range);

    return [
      `Коммитов за период: ${commits.length}`,
      `Период: ${firstDate} — ${lastDate}`,
      areas.length ? `Чаще всего менялось: ${areas.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  } catch {
    return '';
  }
}

module.exports = { gitFacts };
