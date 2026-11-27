#!/usr/bin/env node
const { resolveProject } = require('../lib/project');
const { storeBuffer } = require('../lib/media-store');
const { isRecursiveCall } = require('../lib/llm-upgrade');
const { appendError } = require('../lib/fsx');
const { runHook } = require('../lib/hook-io');
const { collectImages } = require('../lib/inline-images');

runHook('post-tool-use', (input) => {
  if (isRecursiveCall()) return;

  const images = collectImages(input.tool_response);
  if (!images.length) return;

  const project = resolveProject(input.cwd || process.cwd());
  if (project.tracking !== 'enabled') return;

  const sessionId = (input.session_id || 'unknown').slice(0, 8);
  const at = new Date().toISOString();

  for (const image of images) {
    try {
      storeBuffer(project.caseDir, Buffer.from(image.data, 'base64'), {
        type: 'image',
        format: image.format,
        sessionId,
        at,
        contextExcerpt: `снимок экрана из ${input.tool_name || 'инструмента'}`,
      });
    } catch (err) {
      appendError(project.caseDir, 'post-tool-use', err);
    }
  }
});
