// Tiny tagged-template HTML helper: every interpolation is escaped unless it is already
// a SafeHtml (produced by html`` or raw()). Arrays are flattened and joined.
class SafeHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const escape = v => String(v).replace(/[&<>"'`]/g, c => ESC[c]);

const render = v => {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return escape(v);
};

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

export const raw = s => new SafeHtml(String(s));

// JSON safe to embed inside <script type="application/json">.
export const jsonScript = obj => raw(JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'));
