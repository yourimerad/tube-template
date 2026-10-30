// HilltopAds (mainstream and "non-mainstream" (adult) inventory; self-serve). Tag text is shown only as images in
// the docs: verified false. The attribute-only form seen live is supported: slot zone = the FULL script URL
// of your code (https://<random domain>/xx/yy/zz/<hash>.js). Inline "__htas" loaders: paste into a custom slot.
// Pre-roll: paste the VAST link of your Video VAST zone into the preroll slot "vast_url".
import { esc } from './_util.js';

const URL_RE = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9/._-]+\.js$/;
export default {
  id: 'hilltopads',
  name: 'HilltopAds',
  audiences: ['general', 'adult'],
  signup: 'https://hilltopads.com/signup?who=publisher',
  verified: false,
  verify: {
    url: 'https://hilltopads.com/publishers-help/en/articles/9065026',
    date: '2026-10-30',
    note: 'Formats, placement (before </body>) and inventory categories from the help center (9065026, 9030962); snippet text '
      + 'not published as text: compare with your dashboard, else use a custom slot.',
  },
  fields: {},
  zone: { label: 'Full https script URL of the code', pattern: '^https://[A-Za-z0-9.-]+/[A-Za-z0-9/._-]+\\.js$' },
  formats: ['banner', 'popunder', 'inpage_push', 'vast'],
  render: (format, slot) => (URL_RE.test(slot.zone || '') ? `<script type="text/javascript" src="${esc(slot.zone)}"></script>` : ''),
  vast: slot => slot.vast_url || '',
  csp: { script: ['https:'], frame: ['https:'], img: ['https:'], connect: ['https:'], media: ['https:'] },
  adsTxt: () => [],
};
