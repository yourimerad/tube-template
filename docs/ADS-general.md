# ADS-general.md: making money with ads on a general-audience (non-adult) tube site, France and US

Status: guide, written 2026-10-30. Every fact was checked on that date; the sources are linked inline and listed in
§11. Numbers marked **(vendor)** come from an ad network or a company that sells ad tech, numbers marked **(est.)** are
our own model or assumptions, and **(secondary)** means a blog or press summary rather than the primary text. This is
not legal or tax advice: the last word belongs to your accountant (expert-comptable / CPA) and, for privacy, a lawyer.

Scope: a site built from this template with `"audience": "general"`, owners established in France or in the US,
visitors mostly from France or the US. Adult sites: see docs/ADS-adult.md instead (different networks, age gate).

## TL;DR

- **Expect about $4 (France) to $9 (US) per 1,000 visits** with a clean layout, after ad blockers, from a small
  run-of-network setup **(est.)**. An aggressive layout (popunder, interstitial, sticky, push) adds about 50-60 % on
  paper, but it locks you out of all Google demand and puts sessions, SEO and Chrome's ad filter at risk (§1, §3).
- **Hosting is cheap next to that.** On the SCALING.md model (47.8 MB per visit, own edges), hosting is roughly
  2-20 % of clean ad revenue from 1k to 1M daily visitors. Bandwidth only gets expensive if you put video on a
  commercial CDN.
- **The Google path is the default for a clean site:** AdSense for display, Google Ad Manager for the pre-roll. Two
  hard facts: Google ads are banned on any site that contains or triggers pop-unders
  ([Google, 2017-07-11](https://blog.google/products/adsense/clarification-around-pop-unders/)), and legacy AdSense for
  video shut down on 2026-05-31 (now Ad Exchange video in Ad Manager, which **requires the IMA SDK** for in-stream
  requests; the template's pre-roll player does not use IMA yet, see §7.6).
- **The premium managers mostly do not fit yet.** Ezoic needs 250k monthly users since 2026-02-19. Raptive needs 25k
  pageviews with 40-50 % of traffic from US/UK/CA/AU/NZ. Mediavine Journey needs 1,000 sessions from US/CA/UK/AU.
  A French-language site will not qualify for Raptive or Journey however big it grows.
- **France:** a Google-certified IAB TCF CMP for Google demand (otherwise no personalized ads), "Refuser" as easy as
  "Accepter", LCEN legal notice, the "Publicité" label, intra-EU VAT number + monthly DES for Google Ireland.
- **US:** W-9, 1099 (the threshold is $2,000 for 2026 payments), a "Do Not Sell or Share" link and Global Privacy
  Control support in about 12 states, COPPA if kids may come, a DMCA agent ($6, renew every 3 years) because the
  site has comments.
- **Rehearse first:** `./tube dev --ads sim`, read `/simads/report`, run the projection, then `./tube ads setup`,
  `./tube ads check`, and go live slot by slot (§7, §8). The sim puts France in the same tier as the US, so divide
  its French projections by about 2.5 (§1.3).

## 1. Revenue reality

### 1.1 Vocabulary

| Term | Meaning |
|---|---|
| eCPM | Revenue per 1,000 ad impressions that were actually served |
| Fill | Share of ad requests that return an ad. Revenue per request = fill x eCPM |
| Page RPM | Revenue per 1,000 pageviews (all slots on the page) |
| **RPM per 1,000 visits** | What this guide uses. A visit here = SCALING.md's visit: about 2.5 pageviews and one video |
| Net | After the network's share. AdSense for content pays the publisher **80 % after the advertiser platform's fee**, about **68 %** when the buyer is Google Ads ([AdSense help 180195](https://support.google.com/adsense/answer/180195)). Raptive pays 75 % ([PPC Land, 2025-10-16](https://ppc.land/raptive-drops-pageview-requirement-to-25-000-monthly-visits/), secondary) |

All figures below are **net to the publisher, in USD**.

### 1.2 GEO: France earns about 40 % of the US

No primary source publishes display RPM by country. Two independent proxies agree:

| Proxy | US | France | FR / US |
|---|---|---|---|
| YouTube median CPM 2025 ([Digital Information World, 2025-08](https://www.digitalinformationworld.com/2025/08/youtube-cpm-rates-in-2025-how-location.html), secondary) | $11.95 | $4.54 | 0.38 |
| One travel publisher's AdSense RPM, Feb 2024 ([Reddit r/juststart](https://lr.us.psf.lt/r/juststart/comments/1b0kkow/rpm_cpm_by_country), anecdotal) | $21.58 | $8.51 | 0.39 |

We use **FR = 0.4 x US** (est.). Seasonality is large on top of that: Ezoic notes up to 3x between low and high
months in any country ([Ezoic, vendor](https://ezoic.com/epmv-your-website)). Q4 (Oct to Dec) is the best quarter,
January the worst.

### 1.3 Per-format model (US, before ad blockers)

The eCPM and fill ranges are the T1 "general" rows of the SimAds rate table (`app/src/simads/rates.json`, built from
vendor and affiliate sources dated 2025-2026, net, run-of-network for a small site). Mid values, 60 % mobile. Visit =
2.5 pageviews.

| Slot(s) | Requests per visit | Fill | Blended eCPM (range) | $ per 1,000 visits (US) |
|---|---|---|---|---|
| leaderboard / inline_mobile + sidebar + footer | 7.5 (3 per page) | 0.85 | $0.95 ($0.30-1.80) | 6.06 |
| native (in the grid) | 2 | 0.80 | $1.60 ($0.75-2.60) | 2.56 |
| preroll (1 per video) | 1 | 0.55 | $6.80 ($3-12) | 3.74 |
| **Clean layout total** | | | | **12.4** (range 5.4-19.3) |
| sticky | 2.5 | 0.85 | $1.22 ($0.40-2.30) | 2.59 |
| popunder (cap 24 h, about 0.8 per visit) | 0.8 | 0.95 | $2.24 ($1-4) | 1.70 |
| interstitial (1 per 3 pages) | 0.8 | 0.85 | $3.36 ($1.60-5.20) | 2.28 |
| inpage_push | 1 | 0.90 | $0.72 ($0.35-1.10) | 0.65 |
| **Aggressive layout total** | | | | **19.6** |

Reading the table:
- **The aggressive layout cannot use Google demand** (pop-under ban above), so in practice its banner and pre-roll
  rows come from the pop network at its own (usually lower) prices. The +58 % is an upper bound.
- **Sanity check.** One Mediavine Journey blogger reported 13,866 sessions and $104.07 in a month, about $7.50 per
  1,000 sessions ([Productive Blogging](https://www.productiveblogging.com/everything-you-need-to-know-about-journey-by-mediavine/), anecdotal).
  That is in the same range as our clean US figure after ad blockers.
- **SimAds caveat.** `rates.json` puts FR in tier T1 next to the US. Its report and projection will therefore show French
  traffic at US prices. Divide French results by about 2.5 until the table gets a separate FR row.

### 1.4 Ad blockers

| Market | Rate | Source |
|---|---|---|
| France | about 30 % of internet users (self-reported, IAB France; date not given) | [Inquirer, secondary](https://technology.inquirer.net/?p=108258) |
| France | 25 % of desktop pageviews (measured, 2022) | [Blockthrough via SEJ, secondary](https://www.searchenginejournal.com/global-ad-blocker-trends/398133/) |
| US | 32.5 % of internet users (self-reported, GWI Q2 2025) | [Backlinko, secondary](https://backlinko.com/ad-blockers-users) |
| US | 19 % of desktop pageviews (measured, 2022) | [Blockthrough via SEJ, secondary](https://www.searchenginejournal.com/global-ad-blocker-trends/398133/) |

Self-reported rates run higher than measured ones, and mobile blocking is lower than desktop. We use **25 % of
impressions lost** (est.) for both countries. Measure your own rate (§7.7).

### 1.5 Worked examples: 1k / 10k / 100k / 1M daily visitors

One visit per visitor per day, one video per visit, 30.4 days per month, 25 % ad-blocked. Per 1,000 visits after ad
blockers: **clean US $9.3, aggressive US $14.7, clean FR $3.7, aggressive FR $5.9** (est.).

Hosting comes from docs/SCALING.md §4 (EUR excluding VAT, labor not included), converted at 1 USD = 0.86 EUR.
At 1k/day the default d2-4 box (about EUR 15) plus storage gives about EUR 17.

| Daily visitors | Hosting / month | Clean US | Aggressive US | Clean FR | Aggressive FR | Hosting as % of clean FR |
|---|---|---|---|---|---|---|
| 1k | about $20 (EUR 17) | $283 | $447 | $112 | $179 | 18 % |
| 10k | $59 (EUR 51) | $2,827 | $4,469 | $1,125 | $1,794 | 5 % |
| 100k | $798 (EUR 686) | $28,272 | $44,688 | $11,248 | $17,936 | 7 % |
| 1M | $2,356 (EUR 2,026) | $282,720 | $446,880 | $112,480 | $179,360 | 2 % |

What the table leaves out, and why the real numbers will be lower:
- **Consent losses in France.** Visitors who refuse get non-personalized or "limited" ads at lower prices. We did not
  find a sourced figure for the drop. Budget for -10 to -20 % on French revenue (est.).
- **Approval and fill.** A thin site (short titles, no text) may be refused by AdSense, and a small site rarely gets
  55 % video fill. A pre-roll with no fill earns nothing but still costs the viewer a delay. Keep the timeout short.
- **Google Ad Manager costs from about 30k video ads a day.** The free tier covers 800,000 video impressions a month
  ([Ad Manager help 6214526](https://support.google.com/admanager/answer/6214526)). At 100k daily visitors and 55 %
  fill you serve about 1.7M, so you pay for the excess (or go through a partner, §2.2).
- **Hosting assumes the FR/EU audience of SCALING.md.** A US audience served from OVH EU edges works, but at 1M daily
  US visitors you would want US edges or a CDN, and SCALING.md §4.1 shows CDN delivery at $5k-50k a month at that size.
- **Your time is not in the table.** Moderation, legal, ad ops and support start to cost real money at 100k+ (SCALING.md §6).
- **Aggressive layouts lose visitors.** If popunder + interstitial cut return visits or pages per visit by more than
  about a third, the clean layout wins even on revenue (1.58 x 0.65 ≈ 1.0). Test it (§7.7).

## 2. Network ladder (as of 2026-10-30)

### 2.1 Overview

| Network | Entry bar | Payout terms | Pop-unders allowed on the site? | Fit for this template |
|---|---|---|---|---|
| Google AdSense | No traffic minimum. Site review, identity verification before any ad shows | Pays at $100 / EUR 70, monthly ([help 1709871](https://support.google.com/adsense/answer/1709871)) | **No** | Display slots. No pre-roll (AdSense for video closed 2026-05-31) |
| Google Ad Manager (free tier) | Free account. Ad Exchange demand comes through a linked AdSense account or a Google partner | Free up to 200M non-video impressions/month for a France-based account (90M US-based) and 800k video/month ([help 6214526](https://support.google.com/admanager/answer/6214526)) | **No** | Pre-roll via VAST tags; AdX video needs IMA (§7.6) |
| Ezoic | **250,000+ monthly active users** for sites added after 2026-02-19; "Incubator" below that ([Ezoic](https://support.ezoic.com/kb/article/getting-started-ezoics-requirements)) | Monthly in arrears (secondary) | No (Google policies apply) | Only a large site |
| Journey by Mediavine | **1,000 sessions in 30 days from Tier 1 = US, CA, UK, AU** ([Mediavine](https://www.mediavine.com/mediavine-requirements/)), lowered from 10k on 2026-01-15 (secondary) | Not published on that page | No | US/English sites only |
| Mediavine (full) | **$5,000 annual ad revenue**, good standing with AdSense and AdX ([Mediavine](https://www.mediavine.com/mediavine-requirements/)) | Not published on that page | No | US/English sites, after AdSense history |
| Raptive | **25,000 pageviews/month** since 2025-10-16; 50 % of traffic from US/UK/CA/NZ/AU (25k-99k PV), 40 % above 100k; domain at least 6 months old; long-form content on most pages ([PPC Land](https://ppc.land/raptive-drops-pageview-requirement-to-25-000-monthly-visits/), secondary; Raptive's own help page refused our fetch) | 75 % share, Net 45 | No | Weak: "long-form content" does not describe a tube |
| Video specialists (in-stream/outstream networks with their own player) | Usually a traffic minimum and a share of video views; terms not public | Varies | Usually no | Only if you accept their player in place of the template's |
| Adsterra | Open, fast approval | $5 (Paxum/WebMoney), $100 (PayPal/crypto), $1,000 (wire) ([AdPushup](https://www.adpushup.com/blog/adsterra-review-factsheet-overview-payment-pros-and-cons/), secondary) | Yes | popunder, interstitial, inpage_push, banners, native |
| Monetag | Open | $5 for most methods, $20 Payoneer, $550 wire (2025 guide, secondary) | Yes | same |
| HilltopAds | Open; splits traffic into mainstream and non-mainstream channels ([AffNinja](https://affninja.com/hilltopads-review/), secondary) | $20 most methods, $50 BTC, $1,000 wire (secondary, figures conflict) | Yes | same + VAST |
| Clickadu | Open; takes mainstream and adult | $50, wire up to $1,000 + $25 fee (secondary, figures conflict) | Yes | same |

Pop-network payout figures come from review blogs that disagree with each other. Check the payout page in your
dashboard before you count on a date.

### 2.2 Google: what to know

- **Policies that hit a tube site.** Google-served ads are restricted on screens "without publisher-content or with
  low-value content", on screens with "more ads or other paid promotional material than publisher-content", and on
  replicated content "with embedded or copied content from others without additional commentary"
  ([Google Publisher Policies](https://support.google.com/adsense/answer/10502938)). A video page with a one-line title
  and no description is a weak case. Give each video a real description, tags and a category page with text.
- **AI-generated video.** We found no AdSense rule that bans AI content as such. The risk is Google Search's
  [scaled content abuse](https://developers.google.com/search/docs/essentials/spam-policies#scaled-content) policy,
  which targets many pages made mainly to rank, "no matter how it's created". Hundreds of near-identical AI clips with
  generated titles are a target. Keep the template's AI label on (`content_label`): it is a legal duty in France (§4.4)
  and it does not count against you with Google.
- **Pop-unders.** "We do not permit Google ads on any site that contains or triggers pop-unders"
  ([Google, 2017-07-11](https://blog.google/products/adsense/clarification-around-pop-unders/)). That is site-wide,
  not page-wide. The template enforces nothing here: if `popunder` is on, do not put AdSense/Ad Manager on any page.
- **Video.** Legacy AdSense for video was "fully discontinued on May 31, 2026". The replacement is Ad Exchange video in
  Ad Manager, with ads.txt authorizing Google, a VAST/IMA-capable player and a billing profile
  ([AdSense help 1705822](https://support.google.com/adsense/answer/1705822)). "The IMA SDK is required to make
  in-stream ad requests to Ad Exchange" ([Ad Manager help 2443781](https://support.google.com/admanager/answer/2443781)).
  Small sites often get AdX video through a Google Certified Publishing Partner (MCM) instead of their own contract.
  The partner takes a cut (typically 10-30 %, not verified here) and handles demand and billing.
- **Approval tips.** Go public first (`"private": false`, robots open) so the reviewer can see the site; the AdSense
  crawler cannot pass basic auth. Before you apply: About, Contact, Privacy, Legal notice pages; 30+ videos with real
  descriptions; no placeholder slots that look like broken ads; `ads.txt` live; a CMP if you have EU visitors.

### 2.3 Pop and push networks: pros and cons

- Pros: instant approval, any traffic size, high fill (0.9+), weekly payouts, fine with video-only pages.
- Cons: no Google demand on the same site, lower banner prices, creative quality you do not control (fake download
  buttons, "your PC is infected" landers), Safe Browsing risk (§6.3), lower return-visit rate, CNIL/GDPR exposure if
  their scripts set cookies before consent.
- Approval tips: pick "mainstream" or "safe" categories in the zone settings and block "software downloads", "dating",
  "crypto", "sweepstakes". Ask your account manager for a clean-creative flag. Test each zone from a fresh browser
  profile on mobile and desktop before going public.

## 3. Formats and placement

### 3.1 The template's slots

| Slot | Typical size | Earns | UX / SEO cost | Google OK? | Recommended cap |
|---|---|---|---|---|---|
| `leaderboard` | 728x90 (desktop), `mobile_zone` 320x50/320x100 | Medium | Low; reserve its height | Yes | 1 per page |
| `sidebar` | 300x250 / 300x600 | Medium-high on desktop | Low | Yes | 1-2 per page, desktop only |
| `inline_mobile` | 300x250 between rows | Medium | Low-medium; never above the player | Yes | 1 per 6-8 cards |
| `native` | Card in the video grid (`native_every`, default 8) | Medium-high | Low if labelled "Ad"; misleading if it mimics a video card without a label | Yes (in-feed) | 1 per 8 cards |
| `footer` | 900x250 or 300x250 row under the player | Medium | Low | Yes | 1 per page |
| `sticky` | 728x90 / 320x50 anchored | Medium | Better Ads fails a "large sticky" over 30 % of the screen | Yes if small | 1, closable, mobile height ≤ 15 % of the viewport |
| `preroll` | VAST video before the main video | **Highest per impression** | Delay before play; failures if > 31 s and not skippable in 5 s | Yes (Ad Manager + IMA) | 1 per video, skippable after 5 s, timeout ≤ 3 s |
| `popunder` | New tab under the window on first click | Medium | High: users hate it; **bans Google ads site-wide** | **No** | 1 per 24 h per visitor |
| `interstitial` | Full-screen between pages | Medium-high | High: Google Search counts it as intrusive; Better Ads fails mobile prestitials and countdown postitials | Only Google's own vignette format | 1 per 3+ pageviews, never on entry |
| `inpage_push` | Toast bottom-right, looks like a notification | Low | Medium; must say "Ad" | No | 1 per visit |
| `sponsored_links` | Text links in the header nav | Flat deals | Low; `rel="sponsored nofollow"` | Yes | A few, labelled |

### 3.2 Better Ads Standards and Chrome's ad filter

The [Coalition for Better Ads](https://www.betterads.org/standards/) lists the experiences that fail its standards.
Chrome checks sites against them; a site that keeps failing gets **all of its ads blocked in Chrome**, not just the
bad one. Chrome has done this in every country since July 2019
([9to5Google, 2019-01-09](https://9to5google.com/2019/01/09/google-chrome-ad-blocker-worldwide/)).

| Desktop | Mobile web | Short-form video (≤ 8 min) |
|---|---|---|
| Pop-up ads | Pop-up ads | Long pre-roll that can't be skipped (reported: > 31 s and no skip in the first 5 s) |
| Auto-playing video ads with sound | Prestitial ads | Mid-roll ads |
| Prestitial ads with countdown | Ad density higher than 30 % | Large display ads over the video |
| Large sticky ads | Flashing animated ads | |
| Ad density higher than 50 % | Auto-playing video ads with sound | |
| Ad density > 30 % combined with a sticky video ad | Postitial ads with countdown | |
| | Full-screen scrollover ads | |
| | Large sticky ads | |
| | Sticky, pop-out video ads | |
| | Sticky video ad with a large inline ad | |

The short-form video thresholds come from 2020 coverage of the standard
([Manatt](https://www.manatt.com/insights/newsletters/advertising-law/better-ads-standard-for-videos-of-8-minutes),
[CNBC, 2020-02-05](https://www.cnbc.com/2020/02/05/google-is-about-to-crack-down-on-disruptive-video-ads.html)).
Most tube videos are under 8 minutes, so **this standard applies to you**: no mid-rolls, one skippable pre-roll.

Consequences for this template:
- `interstitial` on mobile before content = "prestitial": fails. Show it only between two pages, after a click, with
  an immediate close button (no countdown).
- `sticky` + `inline_mobile` + `native` can push a mobile page over 30 % ad density. Count it on a phone-sized screen.
- `popunder` is the "pop-up" row in both columns. One per 24 h keeps it rare, but it is still a listed experience.
- Watch the **Ad Experience Report** in Google Search Console: it lists failing experiences, and you "request another
  review" after fixing ([Google](https://support.google.com/webtools/answer/7159932)).
- Chrome also acts against **abusive experiences** (fake system dialogs, misleading close buttons, auto-redirects)
  ([Chromium blog, 2018-11-05](https://blog.chromium.org/2018/11/further-protections-from-harmful-ad.html)), and it
  unloads any ad that uses more than 4 MB of network, more than 15 s of main-thread CPU in any 30 s window, or more
  than 60 s in total ([Chrome heavy ad intervention](https://developer.chrome.com/docs/web-platform/heavy-ads-intervention)).
  A heavy video ad in a banner slot gets replaced by a grey box.

### 3.3 Google Search: intrusive interstitials

Google Search says interstitials and dialogs that obstruct content "may lead to poor search performance". Legally
required ones (age verification) are exempt, and Google recommends small banners instead of full-page overlays
([Search Central, updated 2025-12-10](https://developers.google.com/search/docs/appearance/avoid-intrusive-interstitials)).
For a site that lives on search traffic: no `interstitial` on landing pages, and keep the consent banner a banner.

### 3.4 Core Web Vitals and layout shift

Google's "good" thresholds at the 75th percentile: LCP ≤ 2.5 s, INP ≤ 200 ms, **CLS ≤ 0.1**
([web.dev](https://web.dev/articles/vitals)). Ads are the usual cause of CLS.
- Reserve every slot's box before the ad loads (`min-height` for the size, `mobile_zone` size on mobile). An unfilled
  slot should collapse only below the fold, or keep its space and show the house placeholder.
- Never insert a slot above content that has already rendered (no late leaderboard pushing the player down).
- Load ad scripts `async` and after consent; the template already emits them inert until consent (contract).
- The pre-roll delays the video's first frame, not LCP (the poster is the LCP element). Measure "time to first video
  frame" separately.

### 3.5 Ad blockers: recovery options

| Option | What it does | Notes |
|---|---|---|
| Accept it | Count blocked visits, do nothing | Fine below 20 % |
| Google "ad blocking recovery" message (AdSense / Ad Manager, Privacy & messaging) | Asks the visitor to allow ads | Free; works only with Google tags |
| Acceptable Ads (eyeo) | Your ads pass Adblock Plus/AdBlock's default allowlist | Strict format rules (no pop, no autoplay); a fee above a traffic level |
| Sponsored links and house promos | First-party links that most block lists leave alone | `sponsored_links` slot |
| Hard wall | Blocks content until the blocker is off | Not recommended: bounces, and in the EU see below |

EU caveat: detecting an ad blocker reads information from the visitor's device, and the ePrivacy rule (art. 5(3)) may
then require consent. The point is disputed. The safe course is to run detection only after consent or to ask a lawyer.

## 4. Legal and tax: owner in France

### 4.1 Cookies and consent (CNIL)

- Non-essential cookies (ads, ad measurement) cannot be set or read before consent, and consent must be "une action
  positive". "L'utilisateur doit pouvoir accepter ou refuser ... avec le même degré de simplicité" and withdrawing
  must be "aussi simple" as giving consent ([CNIL, Que dit la loi](https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies/que-dit-la-loi)).
  In practice: a "Tout refuser" button at the same level as "Tout accepter", and a permanent "Cookies" link in the footer.
- The CNIL guidelines and recommendation of 2020-09-17 (délibérations 2020-091 and 2020-092) set a **six-month**
  reference period before asking again, and a refusal must be remembered
  ([Deloitte Avocats](https://blog.avocats.deloitte.fr/cookies-autres-traceurs-cnil-publie-projet-de-recommandation/), secondary).
- **Cookie walls** ("accept or leave") are judged case by case since the CNIL's criteria of 2022-05-16. A wall is only
  defensible with a "réelle et équitable" alternative (for example a paid option at a "tarif raisonnable") and only
  for the purposes needed for "une juste rémunération du service"
  ([CNIL](https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookie-walls/la-cnil-publie-des-premiers-criteres-devaluation)).
  A free tube site with no paid alternative should not use one.
- The CNIL fines cookie breaches in the millions of euros every year. Small sites get formal notices first, but the
  rules are the same.

### 4.2 Google's EU consent requirement

Publishers using AdSense, Ad Manager or AdMob must use a **Google-certified CMP integrated with the IAB TCF** for
users in the EEA and UK (since 2024-01-16) and Switzerland (since 2024-07-31). Traffic without one is not eligible for
personalized ads and gets non-personalized or "limited" ads at best
([AdSense help 13554116](https://support.google.com/adsense/answer/13554116)). The template's built-in banner
(`consent.mode: "auto"` or `"banner"`) is **not** a TCF CMP. With Google presets and French visitors, use
`consent.mode: "cmp"` and paste a certified CMP. Google offers a free one in AdSense/Ad Manager (Privacy & messaging),
and the [Google CMP list](https://support.google.com/adsense/answer/13554116) names the others. TCF v2.2 is the current
version.

Pop networks generally do not require TCF, but the CNIL rules above still apply to their scripts. The template keeps
them inert until consent.

### 4.3 Mentions légales and the "Publicité" label

- Every online service publisher must identify itself: name, address, phone/email, publication director, host's name,
  address and phone. Since the SREN law of 2024-05-21 these rules sit in **LCEN article 1-1** (no longer art. 6-III),
  and the penalty is in art. 1-2: up to one year in prison and EUR 75,000 for an individual
  ([Simonnet Avocat](https://www.simonnetavocat.fr/mentions-legales-dun-site-internet-obligations-sanctions-et-modele/), secondary;
  [service-public.fr](https://entreprendre.service-public.gouv.fr/P10025)). Put it in `footer.legal` and a /legal page.
  A non-professional individual may publish under a pseudonym if the host holds their identity.
- Advertising must be "clairement identifiée comme telle" (LCEN art. 20). Every slot shows "Publicité" (or "Ad"), and
  native cards must not look like video cards without that label.
- Sponsored videos or paid placements also fall under the 2023 influencer law (loi 2023-451): the words "Publicité" or
  "Collaboration commerciale" on the content itself.

### 4.4 AI content label

The template's `content_label` ("Vidéo générée par IA") covers the SREN-era rule against publishing AI montages of a
person without making the artificial nature obvious (Code pénal art. 226-8, as amended in 2024), and EU AI Act art. 50
deepfake disclosure, which has applied since 2026-08-02 (see docs/SCALING.md §6). Keep it on for AI niches. It does not
hurt ad eligibility.

### 4.5 Tax status (micro-entrepreneur)

| Point | What we found | Certainty |
|---|---|---|
| BIC or BNC? | No official text classifies website ad revenue explicitly. Most practitioners treat selling ad space as a **commercial service (BIC prestations de services)**; some register it as BNC. The activity you declare at registration (for example "portail Internet", APE 63.12Z) drives it | Low: ask your SIE or accountant before registering ([Legalstart](https://www.legalstart.fr/fiches-pratiques/fiscalite-entreprises/bic-ou-bnc/), secondary) |
| Turnover ceiling 2026-2028 | EUR 83,600 for BIC services and BNC, EUR 203,100 for sales (loi n° 2026-103 du 19 février 2026) | High ([CCI Paris IdF](https://www.entreprises.cci-paris-idf.fr/actualites/micro-entrepreneur-revalorisation-des-seuils-pour-2026-2028)) |
| VAT franchise threshold 2026 | EUR 37,500 for services (EUR 41,250 tolerance); the EUR 25,000 reform was dropped | Medium ([Le Coin des Entrepreneurs](https://www.lecoindesentrepreneurs.fr/plafonds-micro-entreprise/), secondary) |
| Social contributions | Different rates for BIC services and BNC; check [autoentrepreneur.urssaf.fr](https://www.autoentrepreneur.urssaf.fr) for 2026 | Not verified here |

Above about EUR 50-80k of profit a company (SASU/EURL) is usually better. That is a question for an accountant.

### 4.6 VAT on ad revenue

- **Google Ireland (AdSense, Ad Manager) and any other EU-based network** buy a B2B service from you. The place of supply
  is the buyer's country (CGI art. 259-1°), so you do not charge French VAT. The invoice (or Google's self-billing
  statement) carries both VAT numbers and the mention "Autoliquidation".
- You need an **intra-EU VAT number** even under the franchise en base (request it from your SIE), and you file a
  monthly **Déclaration européenne de services (DES)** for each month with EU B2B sales
  ([Copeps](https://copeps.fr/actualites/tva-intracommunautaire-google-ireland/), secondary). Sources disagree on the
  exact invoice wording for a franchise micro-entrepreneur ("Autoliquidation" vs "TVA non applicable, art. 259-1 du
  CGI"): ask your SIE.
- **Non-EU networks** (US companies, etc.): outside the scope of French VAT under the same article, no DES. Check the
  legal entity on each contract: several pop networks invoice from EU entities (Cyprus, Estonia), which puts them in the
  DES case.
- Whether this foreign turnover counts toward the VAT franchise threshold is not obvious. Ask.

### 4.7 US tax forms for a French owner (W-8BEN)

- US-based networks (Google asks every publisher, Mediavine, Raptive, some pop networks) ask for **Form W-8BEN**
  (individual) or **W-8BEN-E** (company). In AdSense pick the "Services" income type to claim treaty benefits
  ([AdSense help 10735961](https://support.google.com/adsense/answer/10735961)).
- Ad revenue for work done in France is generally not US-source income, so no US withholding should apply. If a form
  asks for a treaty article, services income without a US permanent establishment falls under **Article 7 (business
  profits)** of the 1994 France-US tax convention; royalties would be Article 12. Low certainty: confirm with an
  adviser, and check that the AdSense tax tool shows 0 % withholding after you submit.
- You need your French tax number (numéro fiscal, 13 digits) for the treaty claim.

## 5. Legal and tax: owner in the US

### 5.1 Tax forms

- Give US networks a **Form W-9**. You receive a **Form 1099** (MISC or NEC depending on the payer) if they paid you
  above the threshold: **$2,000 for payments made in 2026**, $600 for 2025, indexed from 2027 (OBBBA §70433)
  ([Patriot Software](https://www.patriotsoftware.com/blog/accounting/1099-reporting-threshold/), secondary). PayPal
  payouts may come on a 1099-K instead (threshold back to $20,000 and 200 transactions).
- All ad income is taxable whether or not a 1099 arrives: Schedule C plus self-employment tax for a sole proprietor,
  quarterly estimated payments.
- Foreign networks (Cyprus, Estonia, etc.) usually send no 1099. Keep their statements. Balances held at a foreign
  e-wallet (Paxum, etc.) may count toward FBAR ($10,000 aggregate). Check with a CPA.

### 5.2 State privacy laws

- **California (CCPA/CPRA)** applies if any one is true: worldwide gross revenue above **$26,625,000** (adjusted
  2025-01-01, next adjustment 2027-01-01), buying/selling/sharing personal information of **100,000+** California
  consumers or households a year, or **50 %+ of revenue** from selling or sharing personal information
  ([Jackson Lewis](https://www.jacksonlewis.com/insights/navigating-california-consumer-privacy-act-30-essential-faqs-covered-businesses-including-clarifying-regulations-effective-1126), secondary).
  An ad-only site that runs targeted ads can meet the third prong at any size, because third-party ad tags count as
  "sharing" for cross-context behavioral advertising. Treat yourself as covered.
- What it means on the site: a "Do Not Sell or Share My Personal Information" link (and "Limit the Use of My Sensitive
  Personal Information" if relevant), a privacy policy with the CCPA sections, and **honoring the Global Privacy Control
  signal** as an opt-out. Since 2026-01-01 California also requires showing whether the visitor's opt-out signal was
  processed.
- **About 12 states** require honoring opt-out preference signals such as GPC as of 2026-01-01: CA, CO, CT, DE, MD, MN,
  MT, NE, NH, NJ, OR, TX ([Didomi, vendor](https://www.didomi.io/blog/global-privacy-control-gpc-2026)). Another source
  counts ten. Roughly 20 states now have comprehensive privacy laws with different thresholds; most exempt small
  businesses below 100,000 residents' data, Texas and Nebraska use a "small business" test instead.
- Practical setup: a CMP that supports the **IAB Global Privacy Platform (GPP)** US National section, reads
  `navigator.globalPrivacyControl`, and tells Google to use restricted data processing for opted-out users.

### 5.3 COPPA

The amended COPPA Rule was published 2025-04-22 and **compliance became mandatory on 2026-04-22**
([Davis Polk](https://www.davispolk.com/insights/client-update/ftc-prioritizes-coppa-enforcement-new-compliance-obligations-take-effect)).
It applies if the site is directed to children under 13 (the FTC looks at subject matter, animated characters,
child-oriented activities, music, ads shown, actual audience) or if you know you collect children's data. A cartoon,
toy or gaming niche can tip over. If it applies: no behavioral ads and no persistent identifiers for ads without
verifiable parental consent, and tag every Google request as child-directed (contextual ads only, much lower RPM).
Pop networks are not an option. Simplest: do not run a kids niche on this template.

### 5.4 Ad disclosure (FTC)

Ads must be identifiable as ads. The FTC's guidance on native advertising says a native unit that looks like content
needs a clear label ("Ad", "Sponsored") near it, not hidden in a hover
([FTC, Native Advertising guide](https://www.ftc.gov/business-guidance/resources/native-advertising-guide-businesses)).
Paid videos or endorsements fall under the Endorsement Guides (16 CFR Part 255, revised 2023). Sponsored links:
label them and use `rel="sponsored"`.

### 5.5 User content: Section 230 and DMCA

- **Section 230** (47 U.S.C. §230) shields you from liability for comments posted by users, but not for intellectual
  property claims.
- For copyright, the **DMCA safe harbor** (17 U.S.C. §512) needs a designated agent registered with the Copyright Office:
  **$6** per filing, valid **3 years**, renewal reminders by email ([Copyright Office FAQ](https://www.copyright.gov/rulemaking/onlinesp/NPR/faq.html)),
  plus a takedown process and a repeat-infringer policy. Do this before you open comments to the public, and before
  user uploads if you ever add them.
- French owners with US visitors can register a DMCA agent too. In the EU the equivalent is DSA notice-and-action
  (SCALING.md §6).

## 6. Ad quality and safety

### 6.1 ads.txt and sellers.json

- `ads.txt` (IAB Tech Lab) lists who may sell your inventory. Buyers check it and skip unlisted sellers. Google requires
  it for AdX video. Format: `domain, publisher-id, DIRECT|RESELLER, certification-id`, e.g.
  `google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0`.
- It must be served at `https://<your-domain>/ads.txt` from the root domain. Subdomains are covered by a `subdomain=`
  line in the root file. The template serves it from `ads.ads_txt` plus lines contributed by presets.
- `sellers.json` is the other side: each network lists its sellers. Your publisher id should appear there as
  PUBLISHER with your name (or as confidential). If it does not, ask the network.
- Keep it short. Remove lines for networks you stopped using: stale RESELLER lines are a classic fraud vector.

### 6.2 Invalid traffic

- **Never click your own ads**, and never ask anyone to ("support us by clicking" is a ban reason). Use the AdSense
  preview tool or the sim to test.
- Exclude your own visits: set an ad-free cookie for admins, or test only in `sim` mode.
- **Bots** inflate impressions and get clawed back. The template's rate limits (SCALING.md §5) help. Watch for sudden
  spikes from one ASN or country, CTR above about 2 % on display, or very short sessions with many impressions.
- **Paid traffic.** Buying cheap traffic (especially pop traffic from the same networks) to a Google-monetized site is
  the fastest way to an invalid-traffic suspension. If you buy traffic, buy it from sources that report placements,
  and watch revenue per visit by source.
- Google can hold or deduct earnings for invalid activity, and an AdSense ban is per person, not per site.

### 6.3 Malvertising and Safe Browsing

- Open networks sometimes serve fake "update your player", "virus found" or forced-redirect creatives. They hurt your
  visitors and your domain: Google Safe Browsing can flag the whole site ("Deceptive site ahead"), which shows a red
  page in Chrome, Firefox and Safari and costs nearly all traffic until the review passes.
- Defenses: block risky categories in the network dashboard, keep the CSP the template builds (only the network origins
  you configured), no `allow-top-navigation` in ad iframes where you control them, test zones weekly from a clean mobile
  browser, and check Search Console "Security issues" and the
  [Safe Browsing site status](https://transparencyreport.google.com/safe-browsing/search) after any network change.
- Report bad creatives with a screenshot and the landing URL. If a network does not act within days, remove it.
- The template refuses back-button hijacking, fake system alerts and auto-redirects on its own side (contract rules).
  It cannot stop a network's script from doing them, so choose networks that forbid them in their advertiser rules.

## 7. Step by step with this template

The ads features below follow the shared contract (reports/ADS-CONTRACT.md in the build workspace). Command flags may
still move; `./tube help` is the reference.

### 7.1 Rehearse with the simulated network

```bash
./tube dev --ads sim             # private dev site, SimAds on the same origin, no third party contacted
```

```jsonc
// site.config.json (scratch copy, or your real one while "private": true)
"private": true,                   // sim is refused when the site is public
"ads": {
  "mode": "sim",
  "slots": {
    "leaderboard": true, "sidebar": true, "inline_mobile": true, "native": true, "footer": true,
    "preroll": true, "sticky": false, "popunder": false, "interstitial": false, "inpage_push": false
  },
  "sim": { "origin": "", "audience_rates": "auto" }
}
```

1. Browse like a visitor: home, a video, the pre-roll, a category, another video. Do it on desktop and a phone-sized
   window.
2. Switch the simulated country with `/simads/geo?c=US`, then `/simads/geo?c=FR`, and repeat.
3. Open `/simads/report` (or `/simads/report.json`): impressions, viewable, clicks, CTR, fill, eCPM, RPM per 1,000
   pageviews and **per 1,000 visits**, by slot, format, GEO and device.
4. Run the projection calculator with your expected daily visitors and GEO mix. **Divide the FR share by about 2.5**
   (rates.json treats FR as US-level T1, §1.3), then take 25 % off for ad blockers.
5. Turn on the aggressive slots, reset the report (POST button), browse the same path, compare. The difference is the
   upper bound of what aggressive buys you, before any loss of visitors.
6. Check layout: no jump when slots fill (watch the page while ads load), nothing covers the player controls, every ad
   shows "Ad".

### 7.2 Choose a path

| Situation | Path |
|---|---|
| New site, FR or US, mostly search traffic | Google: AdSense display + Ad Manager pre-roll, clean layout, certified CMP |
| AdSense refused or not yet approved | Wait and improve content, or a pop network on **clean formats only** (banner, native, VAST), apply to AdSense later after removing it |
| US/English site, 1k+ US sessions/month | Add Journey by Mediavine when eligible (it replaces your display tags) |
| US/English site, 25k+ PV and long text pages | Raptive application |
| You accept the aggressive trade-off and give up Google | Pop network on all slots, popunder capped at 24 h, interstitial 1 per 3 pages |

Do not mix: one site, one family (Google-compatible or pop). Mixing on different pages does not help: the pop-under
rule covers the whole site.

### 7.3 Configure

```bash
./tube ads setup                  # asks for the network, pastes ids into site.config.json, lists the fields each preset needs
```

Preset names and required fields come from the template's preset definitions; `./tube ads setup` shows them. Any
network without a preset works through `custom` with its raw snippet.

**Clean Google layout (FR or US):**

```jsonc
"ads": {
  "mode": "live",
  "networks": {
    "adsense": { "publisher_id": "ca-pub-1234567890123456" }  // field names: see ./tube ads setup
  },
  "slots": {
    "leaderboard":   { "network": "adsense", "zone": "1111111111", "mobile_zone": "1111111112" },
    "sidebar":       { "network": "adsense", "zone": "2222222222" },
    "inline_mobile": { "network": "adsense", "zone": "3333333333" },
    "native":        { "network": "adsense", "zone": "4444444444" },   // an in-feed unit
    "footer":        { "network": "adsense", "zone": "5555555555" },
    "preroll":       { "vast_url": "https://pubads.g.doubleclick.net/gampad/ads?iu=/NETWORK_CODE/preroll&sz=640x360&env=vp&gdfp_req=1&output=vast&unviewed_position_start=1&impl=s&correlator=" },
    "sticky": false, "popunder": false, "interstitial": false, "inpage_push": false
  },
  "sponsored_links": [],
  "consent": { "mode": "cmp", "cmp_html": "<script src=\"https://<your CMP>/...\"></script>" },  // a Google-certified TCF CMP snippet
  "ads_txt": [ "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0" ]
}
```

**Pop network, aggressive (no Google anywhere on the site):**

```jsonc
"ads": {
  "mode": "live",
  "networks": { "adsterra": { } },                               // zone = the 32-hex key of each Adsterra code
  "slots": {
    "leaderboard":  { "network": "adsterra", "zone": "0a1b2c3d4e5f60718293a4b5c6d7e8f9", "mobile_zone": "1a1b2c3d4e5f60718293a4b5c6d7e8f9" },
    "native":       { "network": "adsterra", "zone": "3a1b2c3d4e5f60718293a4b5c6d7e8f9" },
    "footer":       { "network": "adsterra", "zone": "4a1b2c3d4e5f60718293a4b5c6d7e8f9" },
    "sticky":       { "network": "adsterra", "zone": "5a1b2c3d4e5f60718293a4b5c6d7e8f9" },
    "preroll":      { "vast_url": "https://<network VAST tag from the dashboard>" },
    "popunder":     { "network": "adsterra", "zone": "6a1b2c3d4e5f60718293a4b5c6d7e8f9", "cap_hours": 24 },
    "interstitial": false,                                        // Adsterra has no interstitial format
    "inpage_push":  { "network": "adsterra", "zone": "8a1b2c3d4e5f60718293a4b5c6d7e8f9" }
  },
  "consent": { "mode": "auto" },                                 // EU banner; scripts stay inert until "Accepter"
  "ads_txt": [ ]                                                 // add the lines the network gives you, if any
}
```

**A network without a preset:**

```jsonc
"slots": {
  "sidebar": { "network": "custom", "html": "<ins class=\"xyz\" data-zone=\"42\"></ins><script async src=\"https://cdn.example-ads.com/tag.js\"></script>",
               "csp": ["https://cdn.example-ads.com", "https://serve.example-ads.com"] }
}
```

The HTML is cached and identical for every visitor, so the CSP allows the snippet by hash. Keep the snippet exactly
as the network gives it, and list every origin its script loads from, or it will be blocked (check the browser console).

### 7.4 Consent

- France/EU visitors with Google demand: `consent.mode: "cmp"` with a certified TCF 2.2 CMP (§4.2). Verify that a
  refusal leaves no ad cookies (DevTools > Application > Cookies) and that Google requests carry the TC string
  (`gdpr=1&gdpr_consent=...`).
- France/EU with pop networks only: `"auto"` or `"banner"` is enough. Same test: refuse, reload, no third-party ad
  cookies, house placeholders instead of ads.
- US visitors: add the "Do Not Sell or Share" link and GPC handling (§5.2). The contract does not include a US mode
  yet, so this goes through the CMP (`"cmp"`).
- Privacy policy: list every network, its purpose, the CMP, retention periods, and the advertiser privacy statement
  some networks require (Raptive asks for one).

### 7.5 ads.txt and check

```bash
./tube ads check                  # config sanity, ads.txt served at the root, CSP origins, consent mode vs networks, slot ids
curl -s https://<your-domain>/ads.txt
```

Then in the network dashboards: ads.txt status "Authorized" (AdSense can take a few days), site status "Ready".

### 7.6 Pre-roll: the IMA gap

The template's player (`app/static/js/ads-vast.js`) fetches VAST 2/3/4 itself, follows up to 3 wrappers and plays the
first progressive MP4. It does not use the Google IMA SDK, so:
- Ad Exchange (and therefore most Google video demand) **will not fill** through it ([help 2443781](https://support.google.com/admanager/answer/2443781)).
  Only your own direct line items and non-Google demand set up in Ad Manager can serve.
- VPAID/JavaScript-only creatives and HLS-only media files are skipped (no fill).
- Pop networks' VAST tags usually return MP4 and work.

Until IMA is supported, plan your video revenue on non-Google VAST demand, or run the pre-roll through a partner that
gives you a VAST tag playable without IMA.

### 7.7 A/B test plan

Pages are cached and identical for everyone, so a per-visitor split must happen in the browser (a cookie that decides
which inert slots activate), or you test **sequentially**: two weeks per variant, same weekdays, no big content drops in
between, and repeat A once at the end to catch seasonality.

| Test | Variant B | Keep B if |
|---|---|---|
| 1. Pre-roll | Off vs on (skippable 5 s) | Revenue per visit up and video start rate down less than 5 % |
| 2. Density | + `inline_mobile` and `footer` | RPM per visit up and pages per visit down less than 5 % |
| 3. Sticky | + small sticky | CLS p75 still ≤ 0.1, no Better Ads warning |
| 4. Aggressive (only if you have given up Google) | + popunder 24 h | 30-day return rate down less than (revenue gain - 1) / revenue gain, e.g. 20 % for +25 % revenue |

KPIs to track for every test:

| KPI | Where | Alarm level |
|---|---|---|
| Revenue per 1,000 visits (not per pageview) | network reports / visits from your analytics | The decision metric |
| Pages per visit, session length | analytics | -5 % |
| Bounce rate on video pages | analytics | +5 points |
| 7-day and 30-day return rate | analytics | -5 % |
| Video start rate, pre-roll skip/complete rate | player events (`/simads/report` in sim) | Start rate -5 % |
| CLS / LCP / INP at p75 | Search Console Core Web Vitals, or CrUX | CLS > 0.1 |
| Ad-blocked share | count visits where a bait element is hidden (after consent, §3.5) | Trend up |
| Ad Experience Report, Security issues | Search Console | Anything |

## 8. Go-live checklist

**Content and site**
- [ ] 30+ videos with real titles and descriptions; category pages with a line of text.
- [ ] About, Contact, Privacy, Cookies, Legal notice (FR: LCEN art. 1-1 fields), Terms pages.
- [ ] `content_label` on for AI content (FR legal duty); off otherwise.
- [ ] Domain bought, `deploy.domain` set, HTTPS, `"private": false` only when everything below is done.

**Ads setup**
- [ ] Rehearsed in `sim`; report and projection saved; FR divided by about 2.5.
- [ ] One family only: Google-compatible **or** pop network. No pop-under on any page if Google is present.
- [ ] `./tube ads setup` done; every slot has a real zone or is `false` (no empty boxes).
- [ ] `./tube ads check` passes; `/ads.txt` served at the root, only current networks listed.
- [ ] Pre-roll: one per video, skippable at 5 s, under 31 s, request timeout about 3 s, no mid-roll.
- [ ] Popunder (if any) capped at 24 h; interstitial never on entry, closable at once, 1 per 3+ pages.
- [ ] Mobile ad density under 30 %; sticky small and closable; every unit labelled "Ad"/"Publicité".
- [ ] Network categories: risky verticals blocked; zones tested from a clean phone and desktop browser.

**Privacy**
- [ ] FR/EU + Google: certified TCF 2.2 CMP; "Tout refuser" next to "Tout accepter"; refusal = no ad cookies.
- [ ] FR/EU + pop: template banner on; scripts inert before consent (checked in DevTools).
- [ ] US: "Do Not Sell or Share" link, GPC honored, privacy policy with CCPA sections.
- [ ] Not a kids niche, or COPPA handled (child-directed tagging, no behavioral ads).

**Accounts, tax, legal**
- [ ] FR: business registered (BIC/BNC confirmed with SIE), intra-EU VAT number, DES calendar reminder, invoices or
      self-billing statements kept; W-8BEN(-E) filed with US networks.
- [ ] US: W-9 filed; bookkeeping per network; quarterly estimates; DMCA agent registered (calendar the 3-year renewal).
- [ ] Payment method set in each network; payout thresholds noted.

**After launch (first 30 days)**
- [ ] Search Console verified: Ad Experience Report, Security issues, Core Web Vitals.
- [ ] Safe Browsing status checked after each network change.
- [ ] Weekly: revenue per 1,000 visits by GEO, fill by slot, CTR (alarm above about 2 % on display), bot spikes.
- [ ] No clicks on your own ads; admin visits ad-free.

## 9. What we could not verify

- Display RPM by country from a primary source: none is published. The FR = 0.4 x US ratio rests on two proxies.
- Current payout thresholds for Monetag, HilltopAds and Clickadu: only third-party reviews, which disagree.
- Mediavine and Journey revenue share: not on the requirements page.
- Raptive's help center blocked our fetch; its thresholds come from press coverage of its 2025-10-16 announcement.
- Whether Chrome still enforces the 2020 short-form video standard the same way: no recent primary statement found.
- The BIC/BNC classification of ad revenue and the exact invoice wording for Google Ireland under the VAT franchise.
- French consent rates and the price drop on non-consented traffic.

## 10. Glossary

AdX = Google Ad Exchange. CMP = consent management platform. DES = déclaration européenne de services. GPC = Global
Privacy Control. GPP = IAB Global Privacy Platform. IMA = Google Interactive Media Ads SDK. MCM = Multiple Customer
Management (Google partner access). TCF = IAB Transparency and Consent Framework. VAST = IAB video ad serving template.
VPAID = an older interactive video ad API, deprecated in favor of SIMID/OMID.

## 11. Sources (all retrieved 2026-10-30)

Google and Chrome (primary)
- AdSense revenue share: https://support.google.com/adsense/answer/180195
- AdSense payment thresholds: https://support.google.com/adsense/answer/1709871
- AdSense for video discontinued 2026-05-31, AdX video migration: https://support.google.com/adsense/answer/1705822
- AdSense tax information (W-8BEN, "Services"): https://support.google.com/adsense/answer/10735961
- Certified CMP requirement (EEA/UK 2024-01-16, CH 2024-07-31): https://support.google.com/adsense/answer/13554116
- Google Publisher Policies: https://support.google.com/adsense/answer/10502938
- Pop-under clarification (2017-07-11): https://blog.google/products/adsense/clarification-around-pop-unders/
- Ad Manager free limits (200M / 90M / 800k video): https://support.google.com/admanager/answer/6214526
- IMA SDK required for AdX in-stream: https://support.google.com/admanager/answer/2443781
- Ad Experience Report: https://support.google.com/webtools/answer/7159932
- Intrusive interstitials (updated 2025-12-10): https://developers.google.com/search/docs/appearance/avoid-intrusive-interstitials
- Spam policies, scaled content abuse: https://developers.google.com/search/docs/essentials/spam-policies
- Chrome heavy ad intervention: https://developer.chrome.com/docs/web-platform/heavy-ads-intervention
- Chrome abusive experiences (2018-11-05): https://blog.chromium.org/2018/11/further-protections-from-harmful-ad.html
- Core Web Vitals thresholds: https://web.dev/articles/vitals
- Safe Browsing site status: https://transparencyreport.google.com/safe-browsing/search

Standards
- Better Ads Standards: https://www.betterads.org/standards/
- Short-form video standard (2020): https://www.manatt.com/insights/newsletters/advertising-law/better-ads-standard-for-videos-of-8-minutes ; https://www.cnbc.com/2020/02/05/google-is-about-to-crack-down-on-disruptive-video-ads.html
- Chrome filtering worldwide from July 2019: https://9to5google.com/2019/01/09/google-chrome-ad-blocker-worldwide/

Networks
- Mediavine and Journey requirements: https://www.mediavine.com/mediavine-requirements/
- Journey anecdote (13,866 sessions, $104.07): https://www.productiveblogging.com/everything-you-need-to-know-about-journey-by-mediavine/
- Raptive 25k threshold, 75 %, Net 45 (2025-10-16, secondary): https://ppc.land/raptive-drops-pageview-requirement-to-25-000-monthly-visits/
- Ezoic 250k MAU since 2026-02-19: https://support.ezoic.com/kb/article/getting-started-ezoics-requirements
- Ezoic EPMV seasonality (vendor): https://ezoic.com/epmv-your-website
- Adsterra payout (secondary): https://www.adpushup.com/blog/adsterra-review-factsheet-overview-payment-pros-and-cons/
- HilltopAds channels (secondary): https://affninja.com/hilltopads-review/
- SimAds rate table and its sources: app/src/simads/rates.json

Revenue proxies and ad blocking (secondary)
- YouTube CPM by country 2025: https://www.digitalinformationworld.com/2025/08/youtube-cpm-rates-in-2025-how-location.html
- AdSense RPM US vs FR anecdote (2024-02): https://lr.us.psf.lt/r/juststart/comments/1b0kkow/rpm_cpm_by_country
- Blockthrough 2022 desktop rates: https://www.searchenginejournal.com/global-ad-blocker-trends/398133/
- GWI Q2 2025 US rate: https://backlinko.com/ad-blockers-users
- IAB France 30 %: https://technology.inquirer.net/?p=108258

France
- CNIL, cookie rules: https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies/que-dit-la-loi
- CNIL, cookie wall criteria (2022-05-16): https://www.cnil.fr/fr/cookies-et-autres-traceurs/regles/cookie-walls/la-cnil-publie-des-premiers-criteres-devaluation
- CNIL 2020 guidelines summary (six months): https://blog.avocats.deloitte.fr/cookies-autres-traceurs-cnil-publie-projet-de-recommandation/
- Mentions légales after SREN (LCEN art. 1-1, 1-2): https://www.simonnetavocat.fr/mentions-legales-dun-site-internet-obligations-sanctions-et-modele/ ; https://entreprendre.service-public.gouv.fr/P10025
- Micro thresholds 2026-2028 (loi 2026-103): https://www.entreprises.cci-paris-idf.fr/actualites/micro-entrepreneur-revalorisation-des-seuils-pour-2026-2028
- VAT franchise 2026: https://www.lecoindesentrepreneurs.fr/plafonds-micro-entreprise/
- BIC vs BNC: https://www.legalstart.fr/fiches-pratiques/fiscalite-entreprises/bic-ou-bnc/
- Google Ireland VAT and DES: https://copeps.fr/actualites/tva-intracommunautaire-google-ireland/

United States
- 1099 threshold $2,000 for 2026 (OBBBA): https://www.patriotsoftware.com/blog/accounting/1099-reporting-threshold/
- CCPA applicability: https://www.jacksonlewis.com/insights/navigating-california-consumer-privacy-act-30-essential-faqs-covered-businesses-including-clarifying-regulations-effective-1126
- GPC states (vendor): https://www.didomi.io/blog/global-privacy-control-gpc-2026
- COPPA compliance date 2026-04-22: https://www.davispolk.com/insights/client-update/ftc-prioritizes-coppa-enforcement-new-compliance-obligations-take-effect
- FTC native advertising guide: https://www.ftc.gov/business-guidance/resources/native-advertising-guide-businesses
- DMCA designated agent ($6, 3 years): https://www.copyright.gov/rulemaking/onlinesp/NPR/faq.html
