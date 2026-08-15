import { readFileSync } from 'node:fs';

/**
 * The two provided seed files (agents_config.json, sample_tasks.json) each open
 * with a `// agents_config.json` comment line, which is NOT valid JSON --
 * JSON.parse throws on it. We strip comments at load time rather than editing
 * the supplied files, so the seeds stay byte-for-byte as delivered.
 *
 * The scan is string-aware on purpose. A naive /\/\/.*$/ regex would corrupt any
 * payload containing a URL ("https://example.com" -> "https:"), and task
 * payloads are free text.
 */
export function stripJsonComments(input) {
  let out = '';
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }

    // Line comment: skip to (but not past) the newline so line numbers survive.
    if (ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i += 1;
      continue;
    }

    // Block comment: replace with a space so `1/* x */2` doesn't become `12`.
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

export function parseJsonc(text, source = '<inline>') {
  const withoutBom = text.replace(/^﻿/, '');
  const cleaned = stripJsonComments(withoutBom);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${source}: ${err.message}`);
  }
}

export function readJsonc(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Could not read ${path}: ${err.message}`);
  }
  return parseJsonc(raw, path);
}
