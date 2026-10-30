// JSON with comments: strips // and /* */ comments outside strings and trailing commas, then JSON.parse.
// Errors report line:column of the original text.
export function stripJsonc(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  // trailing commas before } or ] (outside strings: strings were copied verbatim, so re-scan carefully)
  let res = '';
  for (let k = 0; k < out.length; k++) {
    const c = out[k];
    if (c === '"') {
      let j = k + 1;
      while (j < out.length && out[j] !== '"') j += out[j] === '\\' ? 2 : 1;
      res += out.slice(k, j + 1);
      k = j;
    } else if (c === ',') {
      let j = k + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      res += out[j] === '}' || out[j] === ']' ? ' ' : c;
    } else res += c;
  }
  return res;
}

export function parseJsonc(text, file = 'config') {
  const clean = stripJsonc(text.replace(/^﻿/, ''));
  try {
    return JSON.parse(clean);
  } catch (e) {
    const m = /position (\d+)/.exec(e.message);
    if (m) {
      const pos = Number(m[1]);
      const before = clean.slice(0, pos).split('\n');
      throw new Error(`${file}:${before.length}:${before[before.length - 1].length + 1}: ${e.message}`);
    }
    throw new Error(`${file}: ${e.message}`);
  }
}
