// Age gate for audience "adult" (site.config.json "age_gate"). See docs/ADS-adult.md.
//   mode "provider" real age verification: /age/start redirects to age_gate.provider.start_url with return_url
//                   + state; the provider sends the visitor back to /age/callback?token=...&state=...
//                   verify.type "hmac": token = base64url(JSON {"over18":true,"exp":<unix s>,"state":"<state>"})
//                     + "." + base64url(HMAC-SHA256(secret, <first part>)), secret = AGE_GATE_SECRET
//                   verify.type "jws": a compact JWS (ES256 or RS256) checked with verify.public_key (PEM) or the
//                     keys of verify.jwks_url; claims over18 (or age_over_18) = true, exp, state (or nonce).
//   mode "click"    18+ click-through (POST /age/confirm). Not age VERIFICATION: illegal for a public adult site in
//                   France (SREN law, Arcom referential), the UK (Online Safety Act) and 27 US states.
//   mode "sim"      provider flow with a local fake verifier page (/age/sim): tests only, private sites only.
//   mode "off"      no gate.
// geo_rules: { "FR": "verify", "US-TX": "verify", "XX": "block", "default": "verify" } decides per visitor from the
// CF-IPCountry / X-Country (+ X-Region for US states) headers a CDN/proxy sets; without them "default" applies.
//
// Passing the gate (Arcom referential, 9 Oct 2024: per visit, no "remember me") sets two SESSION cookies:
//   av_exp = expiry (unix s, now + 1 h, slid forward by /age/refresh while the visitor is active; readable by JS)
//   av_sig = base64url(md5("<av_exp> <AGE_COOKIE_SECRET>")) (HttpOnly)
// nginx checks the same pair with secure_link (no per-request auth call), gates /media with it, and keys its page
// cache on the result (valid / not), so gated and ungated pages never mix and the HTML cache still works.
import { createHash, createHmac, createPublicKey, verify as cverify, timingSafeEqual, randomBytes } from 'node:crypto';

const STATE_COOKIE = 'tube_age_state';
export const SESSION_S = 3600;

export function cookieValue(header, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(header || '');
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return ''; }
}
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
// Same-site relative path only (no //host, no scheme): where to go back after the gate.
export const safeNext = n => (typeof n === 'string' && /^\/(?![/\\])[^\s]*$/.test(n) && n.length < 500 ? n : '/');

// md5 as nginx secure_link_md5 computes it: binary digest, base64url without padding.
export const avSig = (exp, secret) => createHash('md5').update(`${exp} ${secret}`).digest('base64url');

// Geo rule for a request: 'verify' | 'click' | 'block'
export function geoRule(rules, headers, mode) {
  const country = String(headers['cf-ipcountry'] || headers['x-country'] || '').toUpperCase().slice(0, 2);
  const region = String(headers['x-region'] || '').toUpperCase().replace(/^[A-Z]{2}-/, '').slice(0, 3);
  const r = rules || {};
  let rule = (country && region && r[`${country}-${region}`]) || (country && r[country]) || r.default || 'verify';
  if (!['verify', 'click', 'block'].includes(rule)) rule = 'verify';
  if (mode === 'click' && rule === 'verify') rule = 'click'; // click mode has no verifier to send people to
  return rule;
}

// JWKS cache (1 h)
const jwksCache = new Map();
async function jwksKey(url, kid) {
  let c = jwksCache.get(url);
  if (!c || Date.now() - c.at > 3600_000) {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`jwks ${res.status}`);
    c = { at: Date.now(), keys: (await res.json()).keys || [] };
    jwksCache.set(url, c);
  }
  const jwk = c.keys.find(k => !kid || k.kid === kid);
  return jwk ? createPublicKey({ key: jwk, format: 'jwk' }) : null;
}

// opts = { audience, gate: { mode, provider: { verify }, geo_rules }, cookieSecret, tokenSecret }
export function makeAgeGate(opts) {
  const g = opts.gate || {};
  const mode = opts.audience === 'adult' ? (g.mode || 'click') : 'off';
  const enabled = mode !== 'off';
  const cookieSecret = opts.cookieSecret || '';
  const vf = g.provider?.verify || {};
  const vtype = mode === 'sim' ? 'hmac' : (vf.type || 'hmac');
  // sim without a secret: per-process random key (fine for tests)
  const tokenSecret = opts.tokenSecret || (mode === 'sim' ? randomBytes(32).toString('hex') : '');
  const now = () => Math.floor(Date.now() / 1000);
  const cookieAttrs = secure => `Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;

  async function checkPayload(d, state) {
    const t = now();
    if (d.over18 !== true && d.age_over_18 !== true) return 'not verified as an adult';
    if (!(d.exp > t && d.exp < t + 3600)) return 'expired token';
    const s = d.state ?? d.nonce ?? '';
    if (!state || !safeEq(s, state)) return 'state mismatch';
    return true;
  }

  return {
    mode, enabled, vtype,
    ready: !enabled || !!cookieSecret,
    tokenReady: vtype === 'jws' ? !!(vf.public_key || vf.jwks_url) : !!tokenSecret,
    rule: headers => geoRule(g.geo_rules, headers, mode),
    passed(cookieHeader) {
      if (!enabled) return true;
      if (!cookieSecret) return false;
      const exp = cookieValue(cookieHeader, 'av_exp'), sig = cookieValue(cookieHeader, 'av_sig');
      return /^\d{10}$/.test(exp) && Number(exp) > now() && safeEq(sig, avSig(exp, cookieSecret));
    },
    // Session cookies (no Max-Age / Expires): gone when the browser closes, 1 h inactivity limit in av_exp.
    setCookies(secure) {
      const exp = now() + SESSION_S;
      return [`av_exp=${exp}; ${cookieAttrs(secure)}`, `av_sig=${avSig(exp, cookieSecret)}; HttpOnly; ${cookieAttrs(secure)}`];
    },
    clearCookies: secure => [`av_exp=; Max-Age=0; ${cookieAttrs(secure)}`, `av_sig=; Max-Age=0; HttpOnly; ${cookieAttrs(secure)}`],
    newState(secure) {
      const s = randomBytes(16).toString('base64url');
      return { state: s, cookie: `${STATE_COOKIE}=${s}; Path=/age/; Max-Age=900; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}` };
    },
    clearState: secure => `${STATE_COOKIE}=; Path=/age/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    stateOf: cookieHeader => cookieValue(cookieHeader, STATE_COOKIE),
    // -> true | 'reason'
    async verifyToken(token, state) {
      const parts = String(token || '').split('.');
      try {
        if (vtype === 'jws') {
          if (parts.length !== 3) return 'malformed token';
          const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
          const alg = head.alg;
          if (alg !== 'ES256' && alg !== 'RS256') return `unsupported alg ${alg}`;
          const key = vf.public_key ? createPublicKey(vf.public_key) : vf.jwks_url ? await jwksKey(vf.jwks_url, head.kid) : null;
          if (!key) return 'no verification key';
          const ok = cverify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key, Buffer.from(parts[2], 'base64url'));
          if (!ok) return 'bad signature';
          return checkPayload(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')), state);
        }
        if (!tokenSecret) return 'no secret configured (AGE_GATE_SECRET)';
        const [p, s] = parts;
        if (!p || !s || parts.length !== 2) return 'malformed token';
        if (!safeEq(s, createHmac('sha256', tokenSecret).update(p).digest('base64url'))) return 'bad signature';
        return checkPayload(JSON.parse(Buffer.from(p, 'base64url').toString('utf8')), state);
      } catch (e) {
        return `invalid token (${e.message})`;
      }
    },
    signToken(payload) { // sim verifier (and tests)
      const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${p}.${createHmac('sha256', tokenSecret).update(p).digest('base64url')}`;
    },
  };
}
