// Helpers shared by the network presets. Presets are pure data + string builders: no app imports,
// so lib/ (CLI: validate, ./tube ads check) can load them too.
//
// A preset module default-exports:
//   id, name, audiences: ['adult'] | ['general'] | both, signup (publisher sign-up URL)
//   verified: true | false, verify: { url, date, note }   where the tag format comes from
//   fields: { <key>: { label, pattern, required } }        ads.networks.<id>.<key> (publisher ids...)
//   zone: { label, pattern }                               what goes in a slot's "zone"
//   formats: [...]                                         banner native sticky popunder interstitial inpage_push vast
//   head(net, ctx) / bodyEnd(net, ctx) -> html             once per page when any enabled slot uses the network
//   render(format, slot, net, ctx) -> html                 the tag the publisher dashboard gives for a zone
//   vast(slot, net) -> url                                 VAST tag URL template (IAB macros, see ads-vast.js)
//   csp: { script, frame, img, connect, media, style }     origins per directive
//   adsTxt(net) -> [lines]                                 ads.txt lines it contributes
//   dynamicInline: bool                                    injects inline scripts at run time: the owner must
//                                                          set ads.csp_unsafe_inline (./tube ads check warns)
// ctx = { slot (name), size: 'WxH', w, h, mobile: bool, audience }
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sizeOf = s => { const m = /^(\d+)x(\d+)$/.exec(s || ''); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; };
// Encode a value that ends up inside a JS string literal of an inline snippet (ids only: digits/letters).
export const jsId = s => String(s ?? '').replace(/[^A-Za-z0-9_.-]/g, '');
export const ID = '^[A-Za-z0-9_.-]{1,64}$';
export const DIGITS = '^[0-9]{3,12}$';
