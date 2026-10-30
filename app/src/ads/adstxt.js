// /ads.txt (IAB): lines contributed by the configured network presets + ads.ads_txt from the config.
// Networks are listed as soon as they are configured in ads.networks (any mode), so crawlers see the
// file before the ads go live.
import { PRESETS } from './presets/index.js';

export function adsTxtLines(ads) {
  const lines = [];
  for (const [id, net] of Object.entries(ads.networks || {})) {
    const p = PRESETS[id];
    if (p && p.adsTxt && net && typeof net === 'object') lines.push(...p.adsTxt(net).filter(Boolean));
  }
  lines.push(...(ads.ads_txt || []));
  return [...new Set(lines.map(l => String(l).trim()).filter(l => l && !/[\r\n]/.test(l)))];
}

export function adsTxt(ads, siteName = '') {
  const lines = adsTxtLines(ads);
  return `# ads.txt${siteName ? ` for ${siteName}` : ''} (generated from site.config.json: ads.networks + ads.ads_txt)\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
}

// Networks that manage ads.txt themselves (Ezoic: 301 to its ads.txt manager). -> URL | ''
export function adsTxtRedirect(ads, host) {
  for (const [id, net] of Object.entries(ads.networks || {})) {
    const p = PRESETS[id];
    if (p && p.adsTxtRedirect && net && typeof net === 'object') return p.adsTxtRedirect(net, host);
  }
  return '';
}
