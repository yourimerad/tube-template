// SimAds creatives: fictional advertisers, drawn as SVG on the fly for every banner size (no file, no ffmpeg).
// Every creative carries an "Ad" tag and the words "Simulated ad". Adult creatives stay text-only and
// non-explicit (they stand for the usual tube advertisers: cams, dating, games).
import { config } from '../config.js';

const fr = config.lang === 'fr';
const L = (en, frText) => (fr ? frText : en);

// id, advertiser, headline, sub line, call to action, two gradient colours, glyph
const GENERAL = [
  ['sunbrew', 'Sunbrew Coffee', L('Fresh roast, every morning', 'Torréfié frais chaque matin'), L('Free delivery on your first box', 'Livraison offerte sur la 1re box'), L('Order', 'Commander'), '#ff9a3d', '#b4341c', 'cup'],
  ['voltavpn', 'Volta VPN', L('Browse privately anywhere', 'Naviguez en privé partout'), L('30-day money-back guarantee', 'Satisfait ou remboursé 30 jours'), L('Get it', 'Essayer'), '#3d8bff', '#1b2a6b', 'shield'],
  ['trailfox', 'Trailfox Outdoor', L('Gear up for the weekend', 'Équipez-vous pour le week-end'), L('Up to 40% off hiking boots', "Jusqu'à -40 % sur les chaussures"), L('Shop', 'Voir'), '#3ccf7e', '#155c3b', 'peak'],
  ['pixelforge', 'Pixelforge Games', L('A new world awaits', 'Un nouveau monde vous attend'), L('Play free in your browser', 'Jouez gratuitement'), L('Play', 'Jouer'), '#b45cff', '#3a1670', 'star'],
  ['lingoleap', 'LingoLeap', L('Speak a new language in 3 months', 'Une nouvelle langue en 3 mois'), L('10 minutes a day', '10 minutes par jour'), L('Start', 'Commencer'), '#2ee6b6', '#0d5c5c', 'bubble'],
  ['nimbusbank', 'Nimbus Bank', L('Banking without fees', 'La banque sans frais'), L('Open an account in 5 minutes', 'Ouvrez un compte en 5 minutes'), L('Open', 'Ouvrir'), '#ffd23d', '#8a5a00', 'coin'],
];
const ADULT = [
  ['velvetcam', 'VelvetCam', L('Live models online now', 'Modèles en direct maintenant'), L('Free chat, no sign-up', 'Chat gratuit sans inscription'), L('Watch live', 'Voir en direct'), '#ff3d7f', '#5c0a2a', 'dot'],
  ['matchnight', 'MatchNight', L('Singles near you tonight', 'Célibataires près de chez vous'), L('18+ only, verified profiles', '18+ uniquement, profils vérifiés'), L('Meet', 'Rencontrer'), '#ff6a3d', '#5c1a0a', 'heart'],
  ['lustquest', 'LustQuest', L('The adult RPG everyone plays', 'Le RPG adulte du moment'), L('Free to play, 18+', 'Gratuit, 18+'), L('Play now', 'Jouer'), '#9a3dff', '#2a0a5c', 'star'],
  ['vrnights', 'VR Nights', L('Premium VR scenes in 8K', 'Scènes VR premium en 8K'), L('7-day trial for $1', 'Essai 7 jours pour 1 $'), L('Try', 'Essayer'), '#3dd6ff', '#0a3a5c', 'peak'],
  ['tubeplus', 'TubePlus Premium', L('Full-length HD, no ads', 'Vidéos HD complètes, sans pub'), L('Cancel anytime', 'Sans engagement'), L('Join', "S'abonner"), '#ffb23d', '#5c3a0a', 'play'],
  ['toyshop', 'Nightstand Shop', L('Discreet delivery, 18+', 'Livraison discrète, 18+'), L('-25% with code SIM25', '-25 % avec le code SIM25'), L('Shop', 'Voir'), '#ff3dc8', '#4a0a3d', 'coin'],
];
const toObj = ([id, advertiser, headline, sub, cta, c1, c2, glyph]) => ({ id, advertiser, headline, sub, cta, c1, c2, glyph });
export const CREATIVES = { general: GENERAL.map(toObj), adult: ADULT.map(toObj) };
const byId = new Map([...CREATIVES.general, ...CREATIVES.adult].map(c => [c.id, c]));
export const creative = id => byId.get(id) || null;
export const creativesFor = audience => CREATIVES[audience] || CREATIVES.general;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

function glyph(kind, cx, cy, r) {
  const s = r * 0.6;
  switch (kind) {
    case 'cup': return `<path d="M${cx - s} ${cy - s * 0.6}h${s * 1.6}v${s * 0.9}a${s * 0.8} ${s * 0.8} 0 0 1 -${s * 1.6} 0z" fill="#fff"/><path d="M${cx + s * 0.6} ${cy - s * 0.3}h${s * 0.4}a${s * 0.3} ${s * 0.3} 0 0 1 0 ${s * 0.6}h-${s * 0.4}" stroke="#fff" stroke-width="${s * 0.15}" fill="none"/>`;
    case 'shield': return `<path d="M${cx} ${cy - s}l${s * 0.85} ${s * 0.35}v${s * 0.6}c0 ${s * 0.6}-${s * 0.85} ${s}-${s * 0.85} ${s}s-${s * 0.85}-${s * 0.4}-${s * 0.85}-${s}v-${s * 0.6}z" fill="#fff"/>`;
    case 'peak': return `<path d="M${cx - s} ${cy + s * 0.7}l${s * 0.7}-${s * 1.4}l${s * 0.45} ${s * 0.8}l${s * 0.3}-${s * 0.4}l${s * 0.55} ${s}z" fill="#fff"/>`;
    case 'bubble': return `<path d="M${cx - s} ${cy - s * 0.7}h${s * 2}v${s * 1.2}h-${s * 1.1}l-${s * 0.6} ${s * 0.5}v-${s * 0.5}h-${s * 0.3}z" fill="#fff"/>`;
    case 'coin': return `<circle cx="${cx}" cy="${cy}" r="${s * 0.9}" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="${s * 0.55}" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="${s * 0.12}"/>`;
    case 'heart': return `<path d="M${cx} ${cy + s * 0.8}l-${s * 0.85}-${s * 0.85}a${s * 0.48} ${s * 0.48} 0 0 1 ${s * 0.85}-${s * 0.7}a${s * 0.48} ${s * 0.48} 0 0 1 ${s * 0.85} ${s * 0.7}z" fill="#fff"/>`;
    case 'dot': return `<circle cx="${cx}" cy="${cy}" r="${s * 0.55}" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="${s * 0.9}" fill="none" stroke="#fff" stroke-width="${s * 0.12}"/>`;
    case 'play': return `<path d="M${cx - s * 0.5} ${cy - s * 0.75}v${s * 1.5}l${s * 1.2}-${s * 0.75}z" fill="#fff"/>`;
    default: return `<path d="M${cx} ${cy - s}l${s * 0.3} ${s * 0.65}l${s * 0.7} ${s * 0.1}l-${s * 0.5} ${s * 0.5}l${s * 0.12} ${s * 0.72}l-${s * 0.62}-${s * 0.35}l-${s * 0.62} ${s * 0.35}l${s * 0.12}-${s * 0.72}l-${s * 0.5}-${s * 0.5}l${s * 0.7}-${s * 0.1}z" fill="#fff"/>`;
  }
}

// Text with a rough width fit (no font metrics server-side: ~0.56 em per character for bold sans).
const fit = (text, size, maxW) => Math.max(8, Math.min(size, Math.floor(maxW / (0.56 * Math.max(4, text.length)))));
const t = (x, y, size, text, { weight = 700, fill = '#fff', anchor = 'start', opacity = 1 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}>${esc(text)}</text>`;
const tag = (x, y, s = 1) => `<rect x="${x}" y="${y}" width="${22 * s}" height="${13 * s}" rx="${2 * s}" fill="#ffcf3d"/>`
  + t(x + 11 * s, y + 10 * s, 9 * s, 'Ad', { fill: '#241a00', anchor: 'middle', weight: 800 });
const button = (x, y, w, h, label, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#fff"/>`
  + t(x + w / 2, y + h * 0.66, fit(label, h * 0.48, w - 12), label, { fill: c, anchor: 'middle', weight: 800 });

// size "WxH" (one of the banner sizes, or "640x360" for native / push images)
export function svg(c, size) {
  const [w, h] = size.split('x').map(Number);
  const sim = 'Simulated ad';
  let body = '';
  if (h <= 100 && w >= 3 * h) { // leaderboards, mobile banners, 300x100
    const icon = h - 16;
    const tx = 8 + icon + 12;
    const btnW = Math.min(110, Math.max(56, w * 0.18)), btnH = Math.min(34, h * 0.42);
    const textW = w - tx - btnW - 20;
    const hs = fit(c.headline, Math.min(24, h * 0.3), textW);
    body = `<rect x="8" y="8" width="${icon}" height="${icon}" rx="${icon * 0.22}" fill="rgba(255,255,255,.18)"/>${glyph(c.glyph, 8 + icon / 2, h / 2, icon / 2)}`
      + t(tx, h * 0.46, hs, c.headline)
      + (h >= 60 ? (() => {
        const sub = `${c.advertiser} · ${c.sub}`;
        const ss = Math.min(Math.max(9, hs * 0.6), fit(sub, 14, textW));
        return ss >= 9 ? t(tx, h * 0.46 + hs + 2, ss, sub, { weight: 500, opacity: 0.85 }) : t(tx, h * 0.46 + hs + 2, Math.max(9, hs * 0.6), c.advertiser, { weight: 500, opacity: 0.85 });
      })() : '')
      + button(w - btnW - 10, (h - btnH) / 2, btnW, btnH, c.cta, c.c2)
      + tag(w - 24, 2, 0.85)
      + t(tx, h - 4, Math.max(8, Math.min(10, h * 0.16)), sim, { weight: 600, opacity: 0.75 });
  } else if (w < h) { // skyscraper 160x600
    body = `<circle cx="${w / 2}" cy="${h * 0.2}" r="${w * 0.28}" fill="rgba(255,255,255,.18)"/>${glyph(c.glyph, w / 2, h * 0.2, w * 0.28)}`
      + t(w / 2, h * 0.36, 13, c.advertiser, { anchor: 'middle', weight: 600, opacity: 0.85 })
      + wrap(c.headline, w - 20, 20).map((line, i) => t(w / 2, h * 0.45 + i * 26, 20, line, { anchor: 'middle' })).join('')
      + wrap(c.sub, w - 20, 13).map((line, i) => t(w / 2, h * 0.66 + i * 18, 13, line, { anchor: 'middle', weight: 500, opacity: 0.85 })).join('')
      + button(16, h * 0.8, w - 32, 38, c.cta, c.c2) + tag(6, 6) + t(w / 2, h - 10, 11, sim, { anchor: 'middle', weight: 600, opacity: 0.75 });
  } else { // 300x250, 900x250, 640x360
    const big = w >= 600;
    const hs = big ? Math.min(40, w * 0.05) : 22;
    const left = big ? w * 0.06 + h * 0.5 : 20;
    const textW = big ? w * 0.6 - left + w * 0.12 : w - 40;
    if (big) body += `<circle cx="${w * 0.06 + h * 0.22}" cy="${h * 0.42}" r="${h * 0.2}" fill="rgba(255,255,255,.18)"/>${glyph(c.glyph, w * 0.06 + h * 0.22, h * 0.42, h * 0.2)}`;
    else body += `<circle cx="${w - 46}" cy="46" r="26" fill="rgba(255,255,255,.18)"/>${glyph(c.glyph, w - 46, 46, 26)}`;
    const lines = wrap(c.headline, textW, hs);
    const y0 = big ? h * 0.32 : h * 0.4;
    body += t(left, y0 - hs * 1.1, Math.round(hs * 0.5), c.advertiser, { weight: 600, opacity: 0.85 })
      + lines.map((line, i) => t(left, y0 + i * hs * 1.15, hs, line)).join('')
      + t(left, y0 + lines.length * hs * 1.15 + hs * 0.3, Math.round(hs * 0.55), c.sub, { weight: 500, opacity: 0.9 })
      + (big ? button(w - w * 0.22 - 24, h * 0.42 - 22, w * 0.22, 44, c.cta, c.c2) : button(20, h - 62, w - 40, 38, c.cta, c.c2))
      + tag(8, 8, big ? 1.3 : 1) + t(w - 10, h - 9, big ? 14 : 11, sim, { anchor: 'end', weight: 600, opacity: 0.75 });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(`Ad. ${sim}: ${c.advertiser}, ${c.headline}`)}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.c1}"/><stop offset="1" stop-color="${c.c2}"/></linearGradient></defs>`
    + `<rect width="${w}" height="${h}" fill="url(#g)"/>${body}</svg>`;
}

function wrap(text, maxW, size) {
  const per = Math.max(6, Math.floor(maxW / (0.56 * size)));
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if ((line + ' ' + word).trim().length > per && line) { out.push(line); line = word; } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out.slice(0, 3);
}
