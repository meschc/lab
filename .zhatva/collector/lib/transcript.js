const fs = require('fs');

const asArray = (value) => (Array.isArray(value) ? value : []);

function textOf(block) {
  if (typeof block === 'string') return block;
  if (!block || typeof block !== 'object') return '';
  if (typeof block.text === 'string') return block.text;
  if (Array.isArray(block.content)) return block.content.map(textOf).join('\n');
  if (typeof block.content === 'string') return block.content;
  return '';
}

function eventsFromLine(line, index) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return [];
  }

  const message = record.message;
  if (!message || typeof message !== 'object') return [];

  const role = message.role || record.type;
  const blocks = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }];
  const at = record.timestamp || null;

  return blocks.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    const base = { line: index, role, at };

    if (block.type === 'tool_use') {
      return [{ ...base, kind: 'tool_use', id: block.id, name: block.name, input: block.input || {} }];
    }
    if (block.type === 'tool_result') {
      return [
        {
          ...base,
          kind: 'tool_result',
          id: block.tool_use_id,
          isError: Boolean(block.is_error),
          text: textOf(block),
          raw: block,
        },
      ];
    }
    if (block.type === 'text') {
      return [{ ...base, kind: 'text', text: block.text || '' }];
    }
    if (block.type === 'image') {
      return [{ ...base, kind: 'image', raw: block }];
    }
    return [];
  });
}

function readEvents(transcriptPath, fromLine = 0) {
  let content;
  try {
    content = fs.readFileSync(transcriptPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { events: [], lastLine: fromLine };
    throw new Error(`не удалось прочитать транскрипт: ${err.message}`);
  }

  const lines = content.split('\n').filter((l) => l.trim());
  const fresh = lines.slice(fromLine);
  const events = fresh.flatMap((line, offset) => eventsFromLine(line, fromLine + offset));

  return { events, lastLine: lines.length };
}

// Сжимая контекст, Claude Code запускает отдельную сессию-сводку в той же папке: её «реплики» — пересказ
// чужого лога, а не работа над проектом, и в кейс они попадали бы дублем.
const SUMMARY_JOB_MARKER = 'Below is a conversation log from a Claude Code coding session';
const SUMMARY_HEAD_BYTES = 16 * 1024;

function isSummaryJob(transcriptPath) {
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
  } catch {
    return false;
  }
  try {
    const buffer = Buffer.alloc(SUMMARY_HEAD_BYTES);
    const read = fs.readSync(fd, buffer, 0, SUMMARY_HEAD_BYTES, 0);
    return buffer.subarray(0, read).toString('utf8').includes(SUMMARY_JOB_MARKER);
  } finally {
    fs.closeSync(fd);
  }
}

function countTurns(events) {
  return events.filter((e) => e.kind === 'text' && e.role === 'assistant').length;
}

module.exports = { readEvents, countTurns, asArray, isSummaryJob };
