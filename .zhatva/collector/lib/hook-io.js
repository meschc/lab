const fs = require('fs');

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function emitSessionContext(text) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
    })
  );
}

function runHook(name, fn) {
  try {
    fn(readHookInput());
  } catch (err) {
    try {
      process.stderr.write(`[case-study:${name}] ${err.message}\n`);
    } catch {}
  }
  process.exit(0);
}

module.exports = { readHookInput, emitSessionContext, runHook };
