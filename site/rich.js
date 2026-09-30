// v3fees/site/rich.js
// Owner: frontend-dev.
//
// A deliberately tiny block renderer for the Method section. The copy for that
// section arrives from v3fees/METHOD.md as plain text with a handful of markdown
// conventions (paragraphs, `-` and `1.` lists, one fenced code block, inline
// `code` and **bold**). Nobody wants a markdown library in a page that has to
// run from IPFS with no dependencies, so this is the whole parser.
//
// It is not a general markdown implementation and should not grow into one. If
// the copy ever needs more than this, change the copy.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Inline spans. Escape first, then insert the few tags we allow. */
function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

const FENCE = /^```/;
const UL = /^\s*[-*]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;

/**
 * Block text -> HTML. Blank lines separate blocks; within a paragraph, source
 * line breaks are treated as soft wraps.
 */
export function renderRich(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const out = [];
  let mode = null;          // null | 'code' | 'ul' | 'ol' | 'p'
  let buf = [];

  function flush() {
    if (!mode) { buf = []; return; }
    if (mode === 'code') out.push('<pre class="code">' + buf.join('\n') + '</pre>');
    else if (mode === 'ul') out.push('<ul class="rich-list">' + buf.join('') + '</ul>');
    else if (mode === 'ol') out.push('<ol class="rich-list">' + buf.join('') + '</ol>');
    else if (buf.length) out.push('<p>' + buf.join(' ') + '</p>');
    buf = [];
    mode = null;
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (mode === 'code') {
      if (FENCE.test(line.trim())) flush();
      else buf.push(esc(line));
      continue;
    }
    if (FENCE.test(line.trim())) { flush(); mode = 'code'; continue; }
    if (!line.trim()) { flush(); continue; }

    const ul = UL.exec(line);
    if (ul) {
      if (mode !== 'ul') { flush(); mode = 'ul'; }
      buf.push('<li>' + inline(ul[1]) + '</li>');
      continue;
    }
    const ol = OL.exec(line);
    if (ol) {
      if (mode !== 'ol') { flush(); mode = 'ol'; }
      buf.push('<li>' + inline(ol[1]) + '</li>');
      continue;
    }
    if (mode !== 'p') { flush(); mode = 'p'; }
    buf.push(inline(line.trim()));
  }
  flush();
  return out.join('');
}
