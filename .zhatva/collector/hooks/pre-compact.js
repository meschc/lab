#!/usr/bin/env node
const { capturePass } = require('../lib/capture-pass');
const { runHook } = require('../lib/hook-io');

runHook('pre-compact', (input) => {
  capturePass({
    cwd: input.cwd || process.cwd(),
    sessionId: (input.session_id || 'unknown').slice(0, 8),
    transcriptPath: input.transcript_path,
    isFinal: true,
  });
});
