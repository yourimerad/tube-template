// Network preset registry (see _util.js for the module interface). Order = order shown by `./tube ads setup`.
import exoclick from './exoclick.js';
import juicyads from './juicyads.js';
import trafficstars from './trafficstars.js';
import eroadvertising from './eroadvertising.js';
import adsterra from './adsterra.js';
import hilltopads from './hilltopads.js';
import clickadu from './clickadu.js';
import adsense from './adsense.js';
import gam from './gam.js';
import monetag from './monetag.js';
import ezoic from './ezoic.js';
import adxpansion from './adxpansion.js';
import trafficjunky from './trafficjunky.js';
import custom from './custom.js';
import vast from './vast.js';
import simads from './simads.js';

export const PRESETS = Object.fromEntries([exoclick, juicyads, trafficstars, eroadvertising, adsterra, hilltopads, clickadu,
  adsense, gam, monetag, ezoic, adxpansion, trafficjunky, custom, vast, simads].map(p => [p.id, p]));
export const GOOGLE = Object.values(PRESETS).filter(p => p.google).map(p => p.id);
