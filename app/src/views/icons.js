import { raw } from '../html.js';

const svg = (d, cls = 'ic') => raw(`<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`);

export const icons = {
  search: svg('<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  thumbUp: svg('<path fill="currentColor" d="M2 10h4v11H2zM8 21h9.3a2 2 0 0 0 2-1.6l1.6-7.6A2 2 0 0 0 19 9.4h-5.3l.8-3.9a1.8 1.8 0 0 0-3.2-1.4L8 9z"/>'),
  thumbDown: svg('<path fill="currentColor" d="M22 14h-4V3h4zM16 3H6.7a2 2 0 0 0-2 1.6l-1.6 7.6A2 2 0 0 0 5 14.6h5.3l-.8 3.9a1.8 1.8 0 0 0 3.2 1.4L16 15z"/>'),
  share: svg('<path fill="currentColor" d="M14 4l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/>'),
  play: svg('<path fill="currentColor" d="M8 5.5v13l11-6.5z"/>', 'ic-play'),
  eye: svg('<path fill="currentColor" d="M12 5C6.5 5 2.7 9.1 1.5 12c1.2 2.9 5 7 10.5 7s9.3-4.1 10.5-7C21.3 9.1 17.5 5 12 5zm0 11.2a4.2 4.2 0 1 1 0-8.4 4.2 4.2 0 0 1 0 8.4zm0-6.4a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  gear: svg('<path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.5 7.5 0 0 0-1.7-1L15 3h-4l-.4 2.7a7.5 7.5 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.5 7.5 0 0 0 1.7 1L11 21h4l.4-2.7a7.5 7.5 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/>'),
};
