// EroAdvertising (adult). Only old public embeds of the "ADSPACE CODE" were found: verified false.
// Compare with your dashboard; if it differs, paste it into the slot with "network": "custom".
//   slot zone = adspace id (digits).
import { jsId } from './_util.js';

export default {
  id: 'eroadvertising',
  name: 'EroAdvertising',
  audiences: ['adult'],
  signup: 'https://panel.eroadvertising.com/signup',
  verified: false,
  verify: {
    url: 'https://www.eroadvertising.com/publishers/',
    date: '2026-10-30',
    note: 'Adspace tag from old public embeds only (adspaces.ero-advertising.com); current popunder / VAST formats not found. '
      + 'Paste the dashboard snippet into a custom slot ("network": "custom", "html": ...) if it differs.',
  },
  fields: {},
  zone: { label: 'Adspace id', pattern: '^[0-9]{3,12}$' },
  formats: ['banner', 'sticky'],
  render(format, slot) {
    const z = jsId(slot.zone);
    if (!/^[0-9]{3,12}$/.test(z)) return '';
    return `<!-- BEGIN EroAdvertising ADSPACE CODE -->
<script type="text/javascript" language="javascript" charset="utf-8" src="https://adspaces.ero-advertising.com/adspace/${z}.js"></script>
<!-- END EroAdvertising ADSPACE CODE -->`;
  },
  csp: { script: ['https://adspaces.ero-advertising.com', 'https:'], frame: ['https:'], img: ['https:'], connect: ['https:'] },
  adsTxt: () => [],
};
