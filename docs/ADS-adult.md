# ADS-adult.md: ads, funnel and legal duties for an adult tube built from this template (France + US)

Status: written 2026-10-30. Every fact carries a source and a date. Lines marked **(vendor)** come from an ad network,
affiliate program or processor selling something. Lines marked **(est.)** are our own planning assumptions. Laws,
court cases and network terms change often in this sector: re-check anything older than a few months before relying on it.

> **Not legal or tax advice.** This is a practical map for owners of a legal site showing adults to consenting adults.
> Before going public, have a lawyer in your country (and a US lawyer if you target the US) review your setup.

Companion docs: [ADS-general.md](ADS-general.md) (non-adult owners), [SCALING.md](SCALING.md) (hosting cost),
[ARCHITECTURE.md](ARCHITECTURE.md). The config keys used below (`audience`, `age_gate`, `ads.mode: "sim"`, presets,
`./tube ads ...`) are the ones of the ads upgrade being merged on 2026-10-30. If a key name differs in your copy,
`site.config.example.json` is the reference.

## TL;DR

- **Age verification is the law that decides everything.** France (since 11 Jan 2025, Arcom referential), the UK
  (Ofcom, fully since 25 Jul 2025) and **27 US states** (AVPA count, Sept 2026) require real age checks on porn sites. An
  "I am 18" button is explicitly not enough in France (Code pénal art. 227-24) and in those states. The template's
  `age_gate.mode: "click"` is for private tests and for countries without such a law, nothing else.
- **France has no loophole left for EU-based sites.** The CJEU (16 June 2026, C-188/24 and C-190/24) held that France may
  impose age checks on porn sites established in other Member States. Arcom has blocked or delisted dozens of sites
  (35 top sites complied, left or were blocked by July 2026; 31 more targeted on 29 July 2026).
- **Real age checks cost most of your traffic.** Aylo reported UK visits down 77 % after checks began; independent
  Similarweb data showed -39 % to -47 % for the big tubes in the first two weeks. Aylo left France in June 2025 rather
  than comply. An ad-funded tube earns about $3 to $6 per 1,000 visits **(est.)**, so a verification that costs even
  half a cent per verified visit can eat most of the margin in France.
- **Adult ads pay little per impression and rely on aggressive formats.** Planning numbers (publisher net, **est.**):
  popunder $1-2.5 CPM, banners $0.05-0.20, VAST pre-roll $1.5-3. The popunder plus the funnel (cams, dating, premium)
  is usually most of the money. Google AdSense/Ad Manager are not an option (adult content is banned there).
- **Beyond ads you also need**: a DMCA agent, a 48-hour NCII takedown process (US TAKE IT DOWN Act, enforced since
  19 May 2026), a CSAM reporting path (NCMEC / Pharos), 2257 records if you produce or upload content you
  "produced", and card-network rules (Mastercard AN 5196, Visa VIRP) if you sell anything.
- **Rehearse for free**: `ads.mode: "sim"` + `age_gate.mode: "sim"` while `private: true`, read the SimAds report and its
  projection calculator, then switch one network at a time to `live`.

---

## 1. Legal first

### 1.1 France

#### Code pénal art. 227-24 (the base offence)

Making a pornographic message reachable by a minor is punished by 3 years in prison and a EUR 75,000 fine. Since the
law of 30 July 2020, the article states that the offence stands **even if access results from a simple declaration
by the minor that they are 18 or older**. That sentence is what makes click-through gates illegal in France. Arcom's
referential quotes this text ([Arcom referential, 9 Oct 2024](https://www.arcom.fr/sites/default/files/2024-10/Arcom-Referentiel-technique-sur-la-verification-de-age-pour-la-protection-des-mineurs-contre-la-pornographie-en-ligne.pdf)).

#### Loi SREN (n° 2024-449 of 21 May 2024) and Arcom's powers

SREN created articles 10, 10-1 and 10-2 of the LCEN (loi n° 2004-575) ([Arcom page, read 2026-10-30](https://www.arcom.fr/nous-connaitre-notre-institution/pole-numerique-arcep-arcom/protection-des-mineurs-contre-la-pornographie-en-ligne)):

- Arcom publishes a **référentiel** (technical referential) for age verification, after a CNIL opinion.
- Arcom can send an observation letter, then a **mise en demeure** (formal notice, recent ones give 15 days, earlier ones
  3 weeks), then after an adversarial phase impose a **fine**, order ISPs to **block** the site and search engines to
  **delist** it, without a judge.
- Fines: up to EUR 150,000 or 2 % of worldwide turnover, whichever is higher, for failing a notice (law firm summaries
  of art. 10, e.g. [Deleporte Wentz](https://www.deleporte-wentz-avocat.com/actualite-loi-sren-renforcer-la-protection-des-mineurs-contre-les-contenus-pornographiques);
  [Next, 2%/4% on repeat](https://next.ink/194606/verification-dage-larcom-intensifie-sa-lutte-contre-les-sites-pornos/)).
  Check the consolidated LCEN art. 10 on Légifrance for the exact caps.

#### The Arcom referential: what an accepted age check looks like

Délibération n° 2024-20 of 9 October 2024, published 11 October 2024 ([Légifrance](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000050385836),
[full PDF](https://www.arcom.fr/sites/default/files/2024-10/Arcom-Referentiel-technique-sur-la-verification-de-age-pour-la-protection-des-mineurs-contre-la-pornographie-en-ligne.pdf)).
Key points, read from the PDF on 2026-10-30:

| Requirement | What it means for your site |
|---|---|
| Screen with **no pornographic content** until age is verified | The gate page and the home behind it show nothing explicit. A fully blurred home is given as an example. No explicit thumbnails, previews or ads before the gate |
| Self-declaration is not verification | `click` mode is not compliant |
| Verification **at each visit** | Validity ends when the session ends, the browser closes, the device sleeps, and in any case **after 1 hour of inactivity** |
| Proof of age **may not be stored in a user account** on your site | No "verified forever" flag on accounts. Reusable proofs live on the user's device (wallet) with a second factor |
| Provider **legally and technically independent** from the site | You buy a third-party service; you do not build it |
| **Double anonymity** option mandatory after the transition | The provider must not learn which site the user visits; the site must not learn who the user is |
| At least **two methods** of obtaining a double-anonymous proof (e.g. ID document + facial estimation), covering **80 %** of French adults | Pick a provider that offers this; display the privacy level of each method clearly |
| Facial age estimation allowed if tuned to exclude minors (no false positives) and with liveness detection | Expect a buffer age (e.g. "looks 25+") or a fallback to ID |
| Robust against deepfakes, spoofing, proof sharing | Provider's job; ask for their audit |
| Bank card (3-D Secure, strong authentication, by an independent third party) accepted **only during a 3-month transition** | No longer sufficient alone since April 2025 |
| Independent **audit** encouraged, publication on your site encouraged | Ask the provider for its audit report and link it |
| RTA label in pages/headers recommended to help parental controls | The template adds the RTA meta tag (see 1.8) |

Deadlines: 3 months after publication (11 January 2025) for sites in France or outside the EU, plus the 3-month bank-card
transition, so double anonymity has been required since about 11 April 2025
([Bird & Bird](https://www.twobirds.com/en/insights/2025/france/double-verification-de-l-age-en-ligne-une-obligation-effective-depuis-le-11-janvier),
[L'Enfant Bleu summary, 20 Jan 2025](https://enfantbleu.org/referentiel-technique-verification-age-protection-mineurs-pornographie-en-ligne/)).
The State is testing an anonymous proof of age in the France Identité app ([Siècle Digital, 2 Feb 2026](https://siecledigital.fr/2026/02/02/france-identite-teste-la-preuve-dage-anonyme-en-ligne/)).
Providers that publish France compliance material include Docaposte (15Connect), Yoti, Persona, Namirial, VerifyMy
**(vendor pages, no public prices)**. Arcom says the referential is **not a certification**: you remain responsible for
choosing a compliant provider.

#### Enforcement so far and the EU-sites litigation

| Date | Event | Source |
|---|---|---|
| 26 Feb 2025 | Ministerial arrêté extends the obligation to 17 porn sites established in other EU states (Pornhub, YouPorn, RedTube among them) | [Cabinet Persée, 23 Jul 2026](https://cabinetpersee.com/blog/posts/plateformes-x-mineurs-verification-age-2026/) |
| 4 Jun 2025 | Aylo suspends Pornhub, YouPorn, RedTube in France rather than comply. Aylo claimed about 7M daily French visitors. VPN sign-ups spike (Proton +1,000 %) | [Euronews](https://www.euronews.com/video/2025/06/04/pornhub-owner-suspends-access-in-france-in-protest-over-age-verification-law), [SAN](https://san.com/cc/vpn-demand-jumps-1000-after-pornhub-pulls-out-of-france/), [CTV/AFP](https://www.ctvnews.ca/montreal/article/age-verification-youporn-and-pornhub-reactivated-in-france/) |
| 16 Jun 2025 | Tribunal administratif de Paris suspends the arrêté; Aylo sites return | Persée, above |
| 15 Jul 2025 | Conseil d'État lifts the suspension; obligation back; Aylo blocks again | [JSS](https://jss.fr/post/Le_Conseil_d%E2%80%99Etat_retablit_la_verification_de_l%E2%80%99age_pour_l%E2%80%99acces_aux_sites_pornographiques-6050) |
| 4 Aug 2025 | Arcom formal notice to 5 EU-established sites (3 weeks) | [Arcom](https://www.arcom.fr/presse/protection-des-mineurs-en-ligne-larcom-met-en-demeure-cinq-sites-pornographiques-etablis-dans-lue) |
| Jun 2026 | Paris court dismisses Aylo's challenge (secondary source); Pornhub reopens in France as a login wall without adult content | [Gizmodo, 18 Oct 2026](https://gizmodo.com/best-vpn/watch-pornhub-france) |
| **16 Jun 2026** | **CJEU, joined cases C-188/24 and C-190/24** (WebGroup Czech Republic, NKL Associates v France): a Member State may impose such obligations on providers established in another Member State if the e-Commerce Directive derogation conditions are met (necessity, proportionality, notification). The Conseil d'État (referral of 6 Mar 2024, n° 461193) must now apply it | [Lhermet](https://lhermet.com/actualites/cjue-un-etat-peut-exiger-la-verification-de-lage-sur-les-sites-pornographiques), [Club des Juristes](https://www.leclubdesjuristes.com/en-bref/protection-des-mineurs-en-ligne-la-cjue-valide-lobligation-de-verification-de-lage-sur-les-sites-pornographiques-16415/), [dig.watch](https://dig.watch/updates/cjeu-age-verification-pornographic-websites) |
| 29 Jul 2026 | Arcom's largest operation: 31 sites; 13 with no identified establishment sent to ISPs/search engines for blocking/delisting within 48 h; letters to 5 others. Arcom: since Feb 2025, 35 of the sites most visited by minors complied, stopped serving France, or were blocked | [Club des Juristes, 30 Jul 2026](https://www.leclubdesjuristes.com/en-bref/verification-dage-larcom-engage-une-procedure-contre-31-sites-pornographiques-17191/) |

Status in France as checked by Gizmodo in October 2026 (secondary source): YouPorn and RedTube blocked, Pornhub login-only,
xHamster, XVideos, XNXX and other large tubes behind age checks. **We found no Conseil d'État final ruling after the
CJEU judgment as of 2026-10-30.** Practical reading: whether you are in France, elsewhere in the EU, or outside the EU,
a site reachable from France needs a compliant check or must not serve France.

#### Sexual deepfakes and AI content of real people

- **Code pénal art. 226-8-1** (created by SREN): publishing without consent a montage or AI-generated content of a
  sexual nature showing the image or words of a person: 2 years and EUR 60,000; 3 years and EUR 75,000 when done
  through an online public communication service ([Sénat text](https://www.senat.fr/leg/tas25-054.pdf),
  [Sénat question, 6 Mar 2025](https://www.senat.fr/questions/base/2025/qSEQ250303609.html)). Labelling it "fake" does
  not make it legal.
- Art. 226-8 also punishes non-sexual deepfakes not obviously presented as such.
- **EU AI Act art. 50**: deepfake disclosure duties apply from 2 Aug 2026 (watch the Digital Omnibus changes). Keep the
  template's `content_label` on ("AI-generated video") for synthetic content.
- Rule for owners: **no synthetic content depicting a real, identifiable person** unless you hold that person's
  documented consent, and nothing that looks like a minor. Most ad networks, processors and hosts ban both outright.

#### CNIL: privacy of age checks and ad consent

- The CNIL approved the referential (délibération 2024-067 of 26 Sept 2024) and pushes double anonymity, verification by
  a third party, and no storage of identity by the site ([CNIL](https://www.cnil.fr/fr/verification-de-lage-en-ligne-la-cnil-rend-son-avis-sur-le-referentiel-de-larcom)).
  Never collect ID scans yourself.
- **Ad cookies need prior consent** (art. 82 loi Informatique et Libertés, CNIL guidelines): "Refuse" as easy as "Accept",
  no cookie wall, consent proof kept. Adult networks drop third-party cookies and fingerprint for frequency capping, so
  the consent rules apply to them too. The template emits ad scripts inert until consent (`ads.consent`).
- Visit data on an adult site is sensitive in practice (it can reveal sexual life, GDPR art. 9). Keep logs short,
  do not send your own analytics to ad networks, and write a privacy policy that says what each network collects.

#### Other French duties

- **LCEN mentions légales** (publisher identity, host identity), a way to report illegal content, and prompt removal
  of manifestly illegal content once notified. Report child sexual abuse material to [PHAROS](https://www.internet-signalement.gouv.fr).
- **DSA** (EU): notice-and-action (art. 16), statement of reasons (art. 17), points of contact (art. 11-12). See
  SCALING.md §6. Micro and small enterprises are exempt from most art. 19+ duties.

### 1.2 United States

#### State age-verification laws in force (as of Sept/Oct 2026)

Count and dates from the Age Verification Providers Association tracker, which "reflects the position as of September
2026" ([AVPA](https://avpassociation.com/us-state-age-verification-laws-for-adult-content/)), cross-checked with
[RecordingLaw](https://www.recordinglaw.com/us-laws/age-verification-laws/). Treat effective dates as indicative.

| State | Law | Effective |
|---|---|---|
| Louisiana | Act 440 (HB 142) | 1 Jan 2023 |
| Utah | SB 287 (+ SB 73 of 2026, partly litigated) | 3 May 2023 |
| Mississippi | SB 2346 | 1 Jul 2023 |
| Virginia | SB 1515 | 1 Jul 2023 |
| Arkansas | SB 66 | 31 Jul 2023 |
| Texas | HB 1181 (upheld by SCOTUS) | 19 Sep 2023 |
| Montana | SB 544 | 1 Jan 2024 |
| North Carolina | HB 8 | 1 Jan 2024 |
| Idaho | H 498 | 1 Jul 2024 |
| Kansas | SB 394 | 1 Jul 2024 |
| Kentucky | HB 278 | 15 Jul 2024 |
| Nebraska | LB 1092 | 18/19 Jul 2024 |
| Indiana | SB 17 | 16 Aug 2024 |
| Alabama | HB 164 | 1 Oct 2024 |
| Oklahoma | SB 1959 | 1 Nov 2024 |
| Florida | HB 3 (porn part in force) | 1 Jan 2025 |
| South Carolina | HB 3424 | 1 Jan 2025 |
| Tennessee | SB 1792 | 1 Jan 2025 |
| Georgia | SB 351 | 1 Jul 2025 |
| Wyoming | HB 43 | 1 Jul 2025 |
| South Dakota | HB 1053 | 1 Jul 2025 |
| North Dakota | HB 1561 (+ SB 2380, device signals, 1 Aug 2026) | 1 Aug 2025 |
| Arizona | HB 2112 | 26 Sep 2025 |
| Ohio | HB 96 | 30 Sep 2025 |
| Missouri | rule 15 CSR 60-18, then statute (sources disagree: Nov 2025 / Jul / Aug 2026) | Nov 2025 |
| West Virginia | HB 4412 | 12 Jun 2026 |
| Iowa | HF 864 | 1 Jul 2026 |

Pending: Pennsylvania SB 603 and bills in Illinois, Minnesota, New Jersey, Hawaii (AVPA, same page). Typical shape of
these laws: they apply to commercial sites where about one third or more of the material is "harmful to minors" (any
tube qualifies), require "commercially reasonable" verification (government ID or transactional data, often via a third
party), forbid retaining the identifying data, and carry civil penalties (Texas: up to $10,000 per day, more if a minor
gets in) plus, in several states, a private right of action. Many sites, Aylo included, simply geo-block these states.

#### Free Speech Coalition v. Paxton (2025)

Decided 27 June 2025, 6-3, opinion by Justice Thomas ([opinion](https://www.supremecourt.gov/opinions/24pdf/23-1122_3e04.pdf),
[CRS LSB11354](https://www.congress.gov/crs-product/LSB11354)). Holding: Texas HB 1181 is reviewed under **intermediate
scrutiny** and survives; adults have no First Amendment right to avoid age verification for content obscene to minors;
government ID and transactional data are accepted methods. Consequences: challenges to the state porn-AV laws above
are now very unlikely to succeed (the Seventh Circuit sent the Indiana case back for a ruling for the state, per CRS).
The ruling does not settle age-gating of non-sexual content (social media).

#### 18 U.S.C. 2257 / 2257A and 28 CFR Part 75 (records)

- **Producers** of actual sexually explicit content must check and keep copies of each performer's ID and age proof,
  index them, name a custodian of records, and put a 2257 statement on each depiction.
- **Secondary producers** (those who publish content made by others) were covered by the DOJ regulations (28 CFR 75.1-75.2,
  with copies obtained from the primary producer). After the long *Free Speech Coalition v. Attorney General* litigation
  (Third Circuit, final decree in Aug 2018, case closed in 2021), parts of the regime were struck or enjoined, notably
  warrantless inspections ([FSC, 2018](https://www.freespeechcoalition.com/blog/2018/08/08/fsc-scores-major-legal-victory-in-2257-record-keeping-case),
  [FSC, 2021](https://www.freespeechcoalition.com/blog/long-running-2257-legal-battle-over-as-fsc-declares-victory)).
  The scope for pure hosts is unsettled; ask counsel.
- Practical rule: if you shoot or commission content, keep full 2257 records. If you publish content from studios or
  uploaders, obtain their 2257 statement and records (or custodian address) for every video before publishing. **If all
  your content is synthetic (AI, no real performer), 2257 does not apply to it, but say so truthfully on the 2257 page
  and keep the generation records.** Never publish a false 2257 statement.

#### TAKE IT DOWN Act (non-consensual intimate images, incl. AI forgeries)

Signed 19 May 2025. Covered platforms (sites that host user-generated content) had until **19 May 2026** to run a
notice-and-removal process: remove the image and make reasonable efforts to remove known identical copies **within
48 hours** of a valid request. The FTC enforces it as an FTC rule violation (civil penalties up to $53,088 per violation),
launched TakeItDown.ftc.gov and sent warning letters on 20 May 2026
([FTC, May 2026](https://www.ftc.gov/news-events/news/press-releases/2026/05/ftc-begins-enforcing-take-it-down-act),
[WilmerHale, 15 Jun 2026](https://wilmerhale.com/en/insights/client-alerts/20260615-the-take-it-down-act-goes-live)).
If you open uploads or comments with media, you need the form, a monitored inbox and a 48 h clock. Even without uploads,
run the same process: it is cheap and networks/processors expect it.

#### CSAM: 18 U.S.C. 2258A and tools

- Providers (electronic communication / remote computing services) that obtain actual knowledge of apparent CSAM must
  report it to NCMEC's CyberTipline. The REPORT Act (Pub. L. 118-59, 7 May 2024) extended evidence preservation from
  90 days to **1 year**, added child sex trafficking and enticement to reportable categories, and raised penalties
  ([Pub. L. 118-59](https://www.congress.gov/118/plaws/publ59/PLAW-118publ59.htm)).
- Never delete before reporting and preserving; never forward or download the material yourself beyond what the report
  requires. In France, report to PHAROS.
- Hash matching before publication: Microsoft PhotoDNA, NCMEC hash lists, Thorn Safer, Google CSAI Match (video),
  IWF hash list, and StopNCII hashes for adult NCII. Small sites get access through these programs or a moderation vendor.
- The FTC/Utah order against Aylo (3 Sept 2025) is the reference for what regulators now expect from tubes: review every
  video before posting for CSAM and non-consensual material, and take it down on request from anyone, not only the
  person depicted ([FTC statement, 3 Sep 2025](https://www.ftc.gov/system/files/ftc_gov/pdf/2025.09.03-2123033-pornhub-mindgeek-ferguson-holyoak-meador-statement.pdf)).

#### DMCA and Section 230

- **DMCA (17 U.S.C. 512)**: register a designated agent with the US Copyright Office (online, small fee, renew every
  3 years), publish the agent and a takedown procedure, apply a repeat-infringer policy. The template's DMCA page is a
  starting text.
- **Section 230** protects you against most claims over third-party content, but **not** federal criminal law (CSAM),
  intellectual property (use the DMCA), and, since **FOSTA-SESTA** (2018), not sex-trafficking claims (230(e)(5),
  18 U.S.C. 2421A). Content you produce or commission is yours, not "third-party".

### 1.3 UK visitors (Online Safety Act)

Part 5 duties (services publishing their own porn) apply since 17 January 2025, and "highly effective age assurance"
for user-to-user services allowing porn since 25 July 2025; Ofcom enforces them against any service with links to the UK. Ofcom said 77 of the top 100 porn
services used in the UK had age checks by January 2026. Fines so far: 8579 LLC GBP 1.35M (Feb 2026), Kick Online
Entertainment GBP 800k, Youngtek GBP 500k + 100k, 4chan GBP 450k, fapello GBP 630k, First Time Videos GBP 80k
([Ofcom](https://www.ofcom.org.uk/online-safety/protecting-children/ofcom-fines-porn-company-1.35-million-for-not-having-age-checks),
[Inforrm, 11 Mar 2026](https://inforrm.org/2026/03/11/ofcom-steps-up-online-safety-act-enforcement-with-two-further-age-assurance-fines-for-pornographic-platforms-alexandros-antoniou/),
[RPC, autumn 2026](https://www.rpclegal.com/snapshots/technology-digital/autumn-2026/online-safety-act-ofcom-fines-two-adult-sites-for-age-verification-failures/)).
The statutory maximum is GBP 18M or 10 % of global revenue, plus court-ordered business disruption (payment and ISP
blocking). For a small site: verify UK visitors with the same provider, or geo-block the UK.

### 1.4 Card-network rules (only if you sell premium, clips or memberships)

- **Mastercard AN 5196** (effective 15 Oct 2021, [Mastercard](https://www.mastercard.com/global/en/news-and-trends/perspectives/2021/protecting-our-network-protecting-you-preventing-illegal-adult-content-on-our-network.html)):
  documented age and identity verification of every uploader and every person depicted, documented consent to recording
  and to publication, **review of all content before publication**, a complaint process for illegal or non-consensual
  content, and immediate removal when consent is missing. The acquirer certifies all of this.
- **Visa Integrity Risk Program** (VIRP, since 1 May 2023, replaced GBPP): adult content (MCC 5967) is a high-integrity-risk
  category; acquirers must register merchants; summaries describe complaints resolved within 7 business days and monthly
  reporting to the acquirer ([LegitScript](https://www.legitscript.com/regulatory-and-card-brand-compliance/visa-integrity-risk-program), [CCBill doc](https://ccbill.com/doc/?p=8750)).
- You will not deal with Visa/Mastercard directly: an adult processor (section 3.3) imposes these rules in its contract,
  and audits you.

### 1.5 Hosting, CDN and DNS for adult content (checked 2026-10-30)

| Provider | Legal adult content | Notes |
|---|---|---|
| **OVHcloud** (template default) | No explicit ban found in public terms; widely used for legal adult sites | Not verified from an official page. Ask OVH support in writing before going public, and keep the answer. Illegal content goes through its abuse process |
| **bunny.net** (CDN, Stream) | **Allowed** "as long as the content is legal under the laws of Slovenia", and US state laws | [Bunny AUP](https://bunny.net/acceptable-use/). Good fit for SCALING.md tiers 1-3 |
| **Cloudflare** | Not banned by the terms | But Free/Pro/Business CDN may not be used to serve video and large files; you "must use" Stream/R2 or Enterprise ([terms, updated 28 Sep 2026](https://www.cloudflare.com/service-specific-terms-application-services/)). DNS-only is fine |
| **Hetzner** | **Not allowed**: terms §8.2 list "pornographic or obscene material" among forbidden content | [Hetzner T&C](https://www.hetzner.com/legal/terms-and-conditions/) (v2.0.0, 27 Oct 2021) |
| Mainstream shared hosts | Often banned (e.g. Bluehost) | Irrelevant for this template (own box) |

The template keeps media behind `media_base`, so moving media to an adult-friendly CDN or to your own bare-metal edges
(SCALING.md §4.2) needs no code change.

### 1.6 What the template does for you, and what it cannot do

| Done by the template (ads upgrade, 2026-10-30) | Your job |
|---|---|
| `audience: "adult"` turns on the age gate, the RTA label (`<meta name="RATING" content="RTA-5042-1996-1400-1577-RTA">`) and adult presets | Choose a **real age-verification provider** that meets the Arcom referential (FR), Ofcom HEAA (UK) and "commercially reasonable" (US states); sign its contract; obtain its audit |
| `age_gate.mode`: `provider` (redirect to the provider, signed result verified server side), `click` (18+ button), `sim` (local fake verifier for tests), `off` | Decide per country: verify, or geo-block (FR, UK, the 27 US states) |
| `validate` refuses `private: false` with `click`/`off` unless `allow_click_through: true`, refuses `ads.mode: "sim"` in public, refuses AdSense/Google presets with `audience: "adult"` | Only set `allow_click_through` if you geo-block every jurisdiction that requires checks |
| No adult page content before the gate passes; footer links to 2257, DMCA and abuse-report pages (template texts with placeholders) | Fill in the pages truthfully: legal entity, custodian of records, DMCA agent, contact, response times |
| EU consent banner/CMP hook; ad scripts inert until consent | Configure the CMP; list your networks in the privacy policy |
| Ads only from the networks you configure; CSP hashes; no fake system alerts, back-button hijacking or unlabeled ads | Choose networks; watch creatives; report malvertising |
| | Keep 2257 records, run moderation, hash-match uploads, answer takedowns in 48 h, report CSAM, file taxes |

---

## 2. Revenue reality

### 2.1 How the money flows in this industry

The FTC states it plainly: Aylo "had two ways of bringing in revenue: advertising and subscriptions. On its Tube Sites,
Aylo makes money the same way most free sites make money: advertising", and its pay sites earn subscriptions plus ads
([FTC statement, 3 Sep 2025](https://www.ftc.gov/system/files/ftc_gov/pdf/2025.09.03-2123033-pornhub-mindgeek-ferguson-holyoak-meador-statement.pdf)).
No public source gives a reliable industry split between ads, premium and cams/affiliate; treat any percentage you read as a guess.

How the big tubes monetize:

- **Own ad network.** Aylo sells its inventory through **TrafficJunky**, which advertises "direct access to Pornhub
  network, no third parties involved", 127M+ daily average visitors, **87 % mobile** traffic, formats: display banners,
  native, mobile interstitial, header and under-player units, video ([TJ media kit, June 2026](https://webassets.trafficjunky.com/1793292783/pdf/TJ_MediaKit_June2026.pdf), **vendor**).
  **TrafficJunky has no open publisher program**: it sells Aylo's own sites and a closed partner network. You cannot
  sign up to get TJ ads on your site.
- **Premium tier** (ad-free, HD, longer videos) sold through adult processors.
- **Creator programs** (verified uploaders sharing ad or clip revenue) that bring fresh content and come with the
  Mastercard verification burden.
- **Funnel to paysites, cams and dating**: sponsored links in the header, "live cams" tabs, in-video banners. Small tubes
  copy this with affiliate links (section 3.2).

### 2.2 eCPM: planning numbers

There is no published rate card for adult publishers by country. What exists (all retrieved 2026-10-30):

- Advertiser-side popunder prices: US $5.31 CPM (Sep-Oct 2026, [PPCmate](https://ppcmate.com/pop-push-cpm-benchmarks-by-country/), **vendor**),
  US $5.36, UK $4.57, DE $3.85, Tier 1 $3-6, Tier 3 under $1 ([LosPollos/Remoby, Sep 2026](https://www.lospollos.com/blog/popunder-traffic/), **vendor**).
  These are what buyers pay, mixed adult and mainstream; France is not listed.
- Mainstream Tier 1 eCPM ranges measured on test buys: popunder $1.20-3.80, interstitial $1.80-5.20, native $0.90-2.60,
  in-page push $0.40-1.10, banner $0.30-0.95 ([bestadsnetwork, May 2026](https://bestadsnetwork.com/blog/ad-network-ecpm-benchmarks-2026-by-format-and-geo/), **vendor**, explicitly excludes adult).
- ExoClick's published minimum bids for popunders: 0.5 / 0.3 / 0.1 CPM by tier (undated, [GDI](https://www.globaldatinginsights.com/knowledge-partners/exogroup/exoclick-introduces-new-minimum-bid-prices/)).

Adult inventory is abundant and buyers are mostly CPA-driven (dating, cams, games, VPN), so publisher-side rates are
lower than mainstream except on the popunder. Our planning table, **publisher net, USD, (est.)**, used for the worked
examples below and close to the SimAds `adult` rate table:

| Format (template slot) | US | France | Note |
|---|---|---|---|
| Popunder (`popunder`, 1 per visitor per 24 h) | 1.50-2.50 | 0.80-1.50 | The main earner |
| VAST pre-roll (`preroll`), per impression | 1.50-3.00 | 1.00-2.00 | Fill often 30-60 % |
| Interstitial (`interstitial`) | 0.80-1.50 | 0.50-1.00 | See Better Ads, section 4 |
| In-page push (`inpage_push`) | 0.20-0.40 | 0.10-0.30 | |
| Native card (`native`) | 0.15-0.30 | 0.08-0.20 | Mostly CPC |
| Banner 300x250 / 900x250 (`footer`, `sidebar`, `leaderboard`) | 0.05-0.20 | 0.03-0.10 | Mostly CPC; high fill |

Rule: **RPM per 1,000 visits** is the number to watch, not eCPM. A tube shows many impressions per visit, each worth little.

### 2.3 What age verification does to traffic

| Event | Effect | Source |
|---|---|---|
| UK, after 25 Jul 2025 | Aylo: UK visits **-77 %** vs July; Similarweb (FT): Pornhub -47 %, XVideos -47 %, xHamster -39 % (24 Jul-8 Aug); Ofcom: Pornhub just under -1/3 in the first month | [AOL/BBC](https://www.aol.com/articles/pornhub-says-uk-visitors-down-004347213.html), [TechRadar](https://www.techradar.com/vpn/vpn-privacy-security/the-age-verification-effect-adult-site-traffic-plummets-vpn-use-soars) |
| UK, Feb 2026 | Pornhub closes to new UK users; Aylo tells MPs the law rewards non-compliant sites | [Euronews, 28 Jan 2026](https://euronews.com/next/2026/01/28/pornhub-to-restrict-access-to-new-users-in-the-uk-from-next-week-company-says), [Freevacy/FT](https://www.freevacy.com/news/financial-times/pornhub-writes-to-mps-warning-the-osa-is-benefiting-non-compliant-sites/7643) |
| France, Jun 2025 | Aylo leaves; VPN use in France +334 % on 4 June (Top10VPN), Proton sign-ups +1,000 % | [SAN](https://san.com/cc/vpn-demand-jumps-1000-after-pornhub-pulls-out-of-france/) |

Two consequences for a small owner: (1) a compliant site loses a large share of its French/UK/US-state visitors at the
gate; (2) the traffic goes partly to non-compliant sites, which regulators are now blocking one batch at a time. Do not
build a business plan on being one of the non-compliant ones.

### 2.4 Worked examples

Assumptions **(est.)**: 1 visit per daily visitor, 5 pageviews per visit, 0.7 video starts per visit, pre-roll fill 50 %,
popunder fill 90 % (cap 1/24 h), 3 banners per page at 80 % fill, 3 native cards per visit, 1 in-page push at 70 % fill,
no interstitial, middle of the 2.2 ranges (US: pop 2.00, pre-roll 2.50, banner 0.15, native 0.25, push 0.30;
FR: 1.20, 1.50, 0.08, 0.15, 0.20). Result: **about $5.4 per 1,000 visits in the US and $3.2 in France**, before
affiliate income. Months = 30.4 days.

| Daily visitors (after the gate) | US $/month | France $/month | Hosting EUR/month (SCALING.md §4, 1 visit = 47.8 MB) |
|---|---|---|---|
| 1,000 | ~165 | ~96 | ~15 (one d2-4) |
| 10,000 | ~1,650 | ~960 | ~27-51 (tier 1) |
| 100,000 | ~16,500 | ~9,600 | ~686 (tier 2) |
| 1,000,000 | ~165,000 | ~96,000 | ~2,026 (tier 3) |

Read it with care:

- Adult sessions often chain several videos, so bytes per visit can be 2-4x SCALING.md's 47.8 MB **(est.)**. At tier 2+
  that moves hosting from 5 % to 10-20 % of revenue, still small.
- Sponsored links and cam/dating affiliates commonly add 10-50 % on top **(est., very site-dependent)**.
- Add 25 % for a US-heavy audience on mobile with good pre-roll fill; subtract 30-50 % for heavy ad-block use (desktop).
- The real cost lines are not on this table: age verification (2.5), moderation and legal time.

### 2.5 The age-verification cost sensitivity (the number that kills small sites)

No provider publishes a per-check price for double anonymity in France (quotes only; [CNIL LINC](https://linc.cnil.fr/node/920)
discusses pricing models, not amounts). Model it yourself:

```
monthly AV cost   = visits that reach the gate x 30.4 x price per check
monthly revenue   = visits that pass the gate x 30.4 x RPM per visit
break-even price  = pass rate x RPM per visit
```

France, 10,000 visitors a day reaching the gate, 40 % pass (between Aylo's -77 % and Ofcom's -1/3), RPM $3.2 per 1,000
visits: break-even price = 0.4 x $0.0032 = **$0.0013 per check**. If your provider charges a cent per check, you lose
money on every French visitor. Because the referential requires a new check at every visit (or a reusable proof held by
the user), returning visitors cost you again. Options, in order of realism for a small site:

1. Use a provider whose proof is **reusable by the user** (wallet, France Identité when available) and priced per
   verified user per month, not per check. Negotiate.
2. **Geo-block** France (and the UK and the 27 US states) and serve the rest of the world, with a click-through where it
   is legal. Many tubes do exactly this. Note: if you or your company are in France, French criminal law still applies to
   you; get advice before relying on geo-blocking alone.
3. Monetize French visitors through **premium** (they pay, so verification is part of a purchase).

---

## 3. Networks

### 3.1 Adult ad networks (publisher side)

Payment terms below are reported by third-party reviews (affninja, afftank, affpaying, 2026) unless marked "official";
they disagree with each other. Confirm in the publisher dashboard before signing.

| Network | Formats for publishers | Payment (reported) | Approval | Reputation / notes |
|---|---|---|---|---|
| **ExoClick** (Barcelona) | 20+ formats (official page): popunder, banner, native, in-page push, interstitial, VAST video, sticky | Min about $20/EUR 20, NET-15 to NET-30; wire, Paxum, crypto | Fast, self-serve | The largest independent adult exchange; supports ads.txt; template preset |
| **JuicyAds** (Tiger Media, Canada; ToS of 1 Jun 2026) | Banners (desktop, mobile, Smart TV), popunder, 300x250 layer/float, 300x250 video, 300x300 native (official page); CPC+CPM mix; flat-rate direct buys | Min about $25 (higher for wire/cheque), weekly or on demand | **Manual** site approval | Long-running; good for direct deals; template preset |
| **TrafficStars** (Cyprus) | Banner, popunder, interstitial, native, video, push; OpenRTB exchange + direct publishers | Unverified ($10-100 thresholds reported) | Review | Seen as premium adult supply; check payout terms in the dashboard |
| **TrafficJunky** (Aylo) | Advertiser-only | n/a | n/a | No publisher program (2.1) |
| **EroAdvertising** (NL) | Banners, popunder, native, video | Not verified | Review | Old network, smaller fill; check current activity before integrating |
| **Adsterra** | Popunder, social bar, native, banners | Not verified | Review | Sources conflict on whether adult **publishers** are accepted; ask first |
| **HilltopAds** | Popunder, in-page push, banner, VAST | Not verified; no minimum traffic | Review | Mixed mainstream/adult; pop specialist |
| **Clickadu** | Popunder, in-page push, video | Not verified | Review | Advertises ad-block recovery; watch creative quality |
| **AdXpansion** | Banners, popunder | Not verified | Review | Smaller; check activity |
| **PlugRush** and traffic-trade scripts | Traffic exchange / trade (send visitors, receive visitors) | n/a | | Trades can grow traffic early but send low-quality visits; never trade blind with unknown tubes (legal exposure for what you link to) |

AI-generated content: **none of these networks publishes a clear rule** on AI-generated adult sites (searched 2026-10-30).
Ask the account manager in writing, label the content as AI-generated, and expect a refusal for anything resembling real
people or minors. Google bans ads promoting synthetic sexual content (May 2024 policy) and AdSense bans adult sites anyway.

Quality rules that apply to all of them: start with one network per format, enable their creative filters (no fake
alerts, no auto-redirects, no "your device is infected"), and check landing pages weekly from a clean browser in FR and US.

### 3.2 Affiliate / CPA: the funnel around the ads

| Model | How you are paid | Fits |
|---|---|---|
| **Rev-share** | % of what the referred user spends, often lifetime | Cams, premium paysites; pays slowly, compounds |
| **CPA / PPS** (pay per sale) | Fixed amount per paying sign-up | Paysites, dating, cams; faster cash, varies a lot by GEO |
| **PPL / SOI / DOI** | Per free registration (single or double opt-in) | Dating, cams; volatile, fraud-checked |

Programs (rates **vendor/reported**, verify on the official page):

- **CrakRevenue**: the main adult CPA network (cams, dating, AI companions), smartlinks and per-offer links.
- **Chaturbate**: about 20 % lifetime rev-share on referred buyers ([affpaying](https://www.affpaying.com/chaturbateaffiliate), older sources).
- **Stripchat (Stripcash)**: about 20 % flat rev-share publicly, custom/hybrid deals for traffic partners ([revshare.so, 2026](https://revshare.so/programs/stripchat-affiliate-program-how-to-sign-up)).
- **BongaCams (BongaCash)**: rev-share and CPA; current rates not confirmed.
- **Dating offers** through CPA networks: high payout in US, much lower in FR; strict on traffic source quality.

In the template: header `sponsored_links` (rendered `rel="sponsored nofollow"`), a native card or the `footer` slot
pointing to a cam smartlink, and a "Live" tab if you want. Disclose affiliate links in the footer.

### 3.3 Selling premium: adult payment processors

CCBill, Segpay, Epoch and Verotel are the established adult processors; they act as merchant of record or acquirer
gateway and enforce AN 5196/VIRP. Public numbers are thin: review sites cite transaction fees of about 4.5-7.5 % for
low-risk merchants up to 10-15 %+ all-in for adult, rolling reserves of 5-10 % held 90-180 days, CCBill holding reserves
six months against late chargebacks ([Merchant Maverick](https://www.merchantmaverick.com/reviews/ccbill-review),
[factually.co](https://factually.co/fact-checks/electronics-tech/best-payment-gateways-for-adult-sites-2026-fees-onboarding-alternatives-ea85c7), **vendor/reported**).
Get a written rate card and reserve schedule. Expect them to audit your uploader verification and complaint process
before approval. The template does not include a paywall today.

---

## 4. Layout: what typical tubes run, mapped to the template's slots

| Slot (config name) | Typical adult tube placement | Frequency / cap | Cost to the visitor |
|---|---|---|---|
| `popunder` | New tab behind the window on the first click of the visit | **1 per visitor per 24 h** (`cap_hours: 24`); 1 per 3 pages is common on aggressive tubes | High annoyance, low SEO cost; main revenue |
| `preroll` (VAST) | Before the video, skippable after 5 s | 1 per video, or 1 per 2 videos | Raises bounce on slow mobiles; keep a short timeout and skip no-fill fast |
| `footer` | Row under the player: 900x250 on desktop, 300x250 x1-3 on mobile | Per page | Low; standard on tubes |
| `native` | A card in the video grid every N cards (`native_every`) | 1 per 8-12 cards | Low if clearly labelled "Ad" |
| `sidebar` / `leaderboard` | 300x250 next to the player; 728x90 / 300x100 header | Per page | Medium; mobile header banners hurt LCP |
| `inpage_push` | IM-style toast bottom corner | 1 per visit, after 10-30 s | Medium; many are misleading ("new message") so filter creatives |
| `interstitial` | Full screen between pages | At most 1 per N pageviews | High; see Better Ads below |
| `sticky` | Bottom bar on mobile | Keep under 30 % of screen height | Medium |
| `sponsored_links` | Header nav: "Live cams", "Dating", "Premium" | Always | None; strong earners |

UX, SEO and the browsers:

- **Coalition for Better Ads / Chrome ad filtering.** Chrome filters **all** ads on a site that keeps failing the Better
  Ads Standards (pop-ups, prestitial ads **with countdown**, large sticky ads, auto-playing video with sound, flashing
  animation, ad density over 30 % on mobile). Check your site in Google Search Console's Ad Experience Report
  ([Better Ads Standards](https://www.betterads.org/standards/)). A countdown interstitial is a listed failing experience:
  keep `interstitial` off, or make it closable at once.
- **Abusive experiences and Safe Browsing.** Fake system alerts, forced redirects and malware landing pages, usually from
  pop or push creatives, get the site flagged ("Deceptive site ahead") and Chrome blocks its pop-ups. One bad creative can
  cost a week of traffic. Keep a list of reported creative IDs and send it to the network; use their "safe" or
  "mainstream-compliant" categories for pops.
- **Ad blockers.** Adult audiences block a lot on desktop (much less on mobile; TJ reports 87 % mobile). Do not use
  ad-block circumvention scripts from networks: they load more third-party code and hurt trust. Sponsored links and
  native cards served from your own domain survive blockers.
- **SEO.** Google indexes adult sites (SafeSearch filters them), but slow pages and intrusive mobile interstitials rank
  worse. Keep the gate page light and crawlable text-only; never show explicit content to the crawler that you would not
  show to an unverified visitor.
- **Labelling.** Every ad says "Ad" (the template does this), sponsored links say "Sponsored". In France, LCEN art. 20
  requires online advertising to be clearly identifiable as such.

---

## 5. Tax (France and US)

### France (owner resident in France)

- **Micro-entrepreneur**: 2026-2028 turnover ceiling for services EUR 83,600; VAT franchise threshold EUR 37,500
  (tolerance EUR 41,250) for services; the planned cut to EUR 25,000 was abandoned
  ([Bpifrance Création](https://bpifrance-creation.fr/entrepreneur/actualites/micro-entrepreneurs-du-nouveau-2026), [Hayot](https://hayot-expertise.fr/blog/micro-entreprise-plafonds-regles-2026)).
  Ad revenue is usually declared as services (BIC services or BNC depending on how the activity is characterised;
  social contributions roughly 21-26 % of turnover in 2026). Ask an expert-comptable which applies.
- **VAT on payments from foreign ad networks.** You sell advertising services to a business abroad: the place of supply
  is the customer's country (B2B general rule, art. 259 CGI). Invoice without French VAT with the mention
  "Autoliquidation" for an EU customer (e.g. ExoClick in Spain) or "TVA non applicable, art. 259-1 du CGI" for a non-EU
  customer, and declare EU B2B services on the DES (déclaration européenne de services). You need an intra-EU VAT
  number even under the franchise.
- **Tax on online video ad revenue** (former art. 1609 sexdecies B CGI, now in the CIBS): 5.15 % of ad revenue from
  videos made available in France, **15 % for pornographic content**, with an abatement for user-generated-content
  platforms and an exemption below a small threshold. Rates were debated in the 2026 finance bill; check the current text
  with your accountant ([Sénat, PLF 2026 amendments](https://www.senat.fr/enseance/2025-2026/138/Amdt_I-690.html)).
- Networks paying a French individual often ask for a W-8BEN (below) because they use US payment rails.

### US

- **Non-US owner paid by a US network**: file **Form W-8BEN** (individual) or **W-8BEN-E** (company). Advertising
  services performed outside the US are generally not US-source income, so no withholding; the form proves it.
- **US owner**: give a **W-9**. From tax year 2026 the 1099-NEC/1099-MISC threshold is **$2,000** (was $600), and 1099-K
  is back to **$20,000 and 200 transactions** (One Big Beautiful Bill Act, signed 4 Jul 2025;
  [CPA Practice Advisor](https://cpapracticeadvisor.com/2025/07/30/one-big-beautiful-bill-act-changes-1099-thresholds/165863/)).
  All income is taxable whether or not a 1099 arrives; self-employment tax (15.3 % up to the wage base) applies to net
  profit; pay quarterly estimates. Most adult networks pay from Europe or Canada and send no 1099.
- Payment methods: Paxum, wire, crypto. Keep every statement: they are your revenue proof for both tax systems.

---

## 6. Step by step with this template

### Step 1: rehearse with simulated ads and a simulated gate (private, free)

```jsonc
// site.config.json (excerpt). private stays true: validate refuses sim in public.
"private": true,
"audience": "adult",
"age_gate": { "mode": "sim", "allow_click_through": false },
"ads": {
  "mode": "sim",
  "slots": {
    "popunder": { "cap_hours": 24 }, "preroll": true, "footer": true, "native": true,
    "inpage_push": true, "sidebar": true, "leaderboard": true, "sticky": false, "interstitial": false
  },
  "sponsored_links": [ { "label": "Live cams", "url": "https://example.com/sim-cams" } ],
  "sim": { "origin": "", "audience_rates": "auto" }
}
```

```bash
./tube dev --ads sim          # local site; SimAds serves creatives labelled "Simulated ad", no third party contacted
./tube ads report             # same as /simads/report: impressions, viewable, CTR, fill, eCPM, RPM per 1,000 visits
```

1. Browse as a visitor: pass the simulated gate, open 5 pages, play 2 videos. Check that **nothing explicit (posters,
   previews, ads) shows before the gate**, that the popunder fires once per 24 h, that the pre-roll skips.
2. Switch GEO with `/simads/geo?c=US` then `?c=FR` and compare RPM.
3. Open the **projection calculator** on the report: enter daily visitors and your GEO mix; compare with section 2.4 and
   with the gate pass rate you expect (multiply visitors by 0.25-0.65 for verified jurisdictions).
4. Turn slots off one at a time and see what each is worth per 1,000 visits. Usually popunder + pre-roll + footer +
   sponsored links give most of the revenue; interstitial and sticky add little and cost UX.

### Step 2: the age gate with a real provider

```jsonc
"age_gate": {
  "mode": "provider",
  "provider": {
    "name": "my-av-provider",                       // a provider meeting the Arcom referential / Ofcom HEAA
    "start_url": "https://av.example.com/start?client_id=...",   // from the provider's dashboard
    "verify": { "type": "hmac", "secret_name": "my-tube-av-secret" }  // file in ~/.secrets, never the secret itself
  },
  "allow_click_through": false
}
```

Test with the provider's sandbox while private. Verify: the gate result is checked server side, validity is a session
cookie that expires after 1 hour of inactivity and on browser close, nothing is stored in a user account, the privacy
level of each method is displayed, and the provider never receives your site's page URLs beyond the return URL it needs
(double anonymity is on the provider's side; ask for its architecture document and audit).

### Step 3: real networks

```bash
./tube ads setup              # asks which presets (exoclick, juicyads, custom...) and the ids each needs
./tube ads check              # validates config, CSP origins, ads.txt, consent mode; refuses unsafe combinations
```

Example `live` configuration: ExoClick for popunder, pre-roll, native and in-page push; JuicyAds for the banners; one
CPA sponsored link. Zone ids come from each network's dashboard after site approval. Preset field names are defined
by the presets; run `./tube ads setup` rather than guessing them.

```jsonc
"audience": "adult",
"ads": {
  "mode": "live",
  "networks": {
    "exoclick": { /* publisher fields asked by ./tube ads setup */ },
    "juicyads": { /* idem */ }
  },
  "slots": {
    "popunder":    { "network": "exoclick", "zone": "1111111", "cap_hours": 24 },
    "preroll":     { "network": "exoclick", "zone": "2222222" },
    "native":      { "network": "exoclick", "zone": "3333333" },
    "inpage_push": { "network": "exoclick", "zone": "4444444" },
    "footer":      { "network": "juicyads", "zone": "5555555", "mobile_zone": "5555556" },
    "sidebar":     { "network": "juicyads", "zone": "6666666" },
    "leaderboard": { "network": "juicyads", "zone": "7777777", "mobile_zone": "7777778" },
    "sticky": false,
    "interstitial": false
  },
  "sponsored_links": [
    { "label": "Live cams", "url": "https://<your CrakRevenue or cam rev-share tracking link>" }
  ],
  "consent": { "mode": "auto" },        // EU visitors: scripts inert until consent; use "cmp" to paste a certified CMP
  "ads_txt": [
    // lines from each network's dashboard (presets add their own); never copy another site's ids
  ]
}
```

`ads.txt` is served at `/ads.txt` from these lines plus preset lines. Adult buyers check it less than Google does, but
ExoClick and others support it and it protects your domain from spoofed inventory.

### Step 4: A/B test plan and KPIs

| KPI | Where | Target / alarm **(est.)** |
|---|---|---|
| RPM per 1,000 visits, by GEO and device | network dashboards + SimAds-style sheet | the number you optimise |
| Gate pass rate (verified / reached gate) | provider dashboard + your logs | alarm if it drops > 10 points after a change |
| Bounce at the gate, bounce after popunder | your logs | |
| Video starts per visit, pre-roll skip rate, pre-roll timeout | player events | starts must not fall when pre-roll is on |
| Pages per visit and return visitors (7-day) | logs | the long-term cost of aggressive ads |
| LCP / INP on mobile | Search Console, CrUX | LCP < 2.5 s |
| Complaints: malvertising reports, takedown requests, chargebacks | inbox | each one investigated |

Method: change **one** thing per test (e.g. popunder cap 24 h vs 12 h; pre-roll on every video vs every second video;
footer network A vs B), split by day of week or by visitor hash, run at least 2 full weeks or 50,000 visits per arm, and
judge on **RPM per visit multiplied by return visits**, not on RPM alone.

---

## 7. Go-live checklist

Legal:
- [ ] Jurisdiction plan written: for FR, UK and each of the 27 US states, either a real age check or a geo-block; click-through only elsewhere, and `allow_click_through` set only then.
- [ ] Age-verification provider contracted; double anonymity option; two methods; audit report obtained; session validity 1 h inactivity; no proof stored in accounts.
- [ ] Gate page and anything reachable without the gate cookie (home, thumbnails, previews, media URLs on the CDN, ads) contain nothing explicit. Media URLs signed or not guessable.
- [ ] RTA label on every page.
- [ ] Mentions légales / imprint, terms, privacy policy (networks listed), cookie consent working (refuse = no ad scripts).
- [ ] 2257 page truthful (custodian of records, or a correct statement for synthetic or third-party content); records held for anything you produce; uploader/studio documents for anything else.
- [ ] DMCA agent registered with the US Copyright Office; DMCA page filled in.
- [ ] Abuse/report page: NCII 48 h process (TAKE IT DOWN), DSA notice-and-action, CSAM path (NCMEC CyberTipline, PHAROS), monitored inbox, response-time log.
- [ ] Content policy: no real-person deepfakes, no minor-looking content, AI content labelled (`content_label`).
- [ ] Moderation: every upload reviewed before publication; hash matching enabled if uploads are open.
- [ ] If selling: processor approved, AN 5196 / VIRP controls documented, complaint resolution within 7 business days.

Ads:
- [ ] Sim rehearsal done; projection compared with section 2.4 and the expected gate pass rate.
- [ ] `./tube ads check` passes; `mode: "live"`; `private: false` only after everything above.
- [ ] One network per format to start; creative filters on; no ad-block circumvention scripts.
- [ ] Popunder capped (24 h to start), interstitial off or instantly closable, sticky under 30 % of mobile height.
- [ ] `ads.txt` lines from the dashboards; sponsored links disclosed.
- [ ] Ad Experience Report and Safe Browsing status checked in Search Console after the first week.
- [ ] Payment details, W-8BEN or W-9, VAT number and invoice mentions done with each network.

Infra:
- [ ] Hosting and CDN accept legal adult content in writing (OVH: ask support; Bunny: AUP; not Hetzner; Cloudflare DNS-only for video).
- [ ] Capacity per SCALING.md with 2-4x bytes per visit for adult sessions; `media_base` ready for a CDN.
- [ ] Logs: retention short, IPs truncated where possible; backups; abuse contact reachable.
- [ ] Watchdog `cap_minutes` raised for production (README).

---

## Sources (all retrieved 2026-10-30 unless dated otherwise)

Primary and official:
- Arcom referential, délibération n° 2024-20 of 9 Oct 2024: https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000050385836 and https://www.arcom.fr/sites/default/files/2024-10/Arcom-Referentiel-technique-sur-la-verification-de-age-pour-la-protection-des-mineurs-contre-la-pornographie-en-ligne.pdf
- Arcom, protection des mineurs page and press list: https://www.arcom.fr/nous-connaitre-notre-institution/pole-numerique-arcep-arcom/protection-des-mineurs-contre-la-pornographie-en-ligne
- Arcom, 4 Aug 2025 formal notice to 5 EU sites: https://www.arcom.fr/presse/protection-des-mineurs-en-ligne-larcom-met-en-demeure-cinq-sites-pornographiques-etablis-dans-lue
- CNIL opinion on the referential (délib. 2024-067): https://www.cnil.fr/fr/verification-de-lage-en-ligne-la-cnil-rend-son-avis-sur-le-referentiel-de-larcom
- Sénat, SREN text incl. art. 226-8-1: https://www.senat.fr/leg/tas25-054.pdf
- Free Speech Coalition v. Paxton, 606 U.S. (27 Jun 2025): https://www.supremecourt.gov/opinions/24pdf/23-1122_3e04.pdf ; CRS LSB11354: https://www.congress.gov/crs-product/LSB11354
- FTC, TAKE IT DOWN Act enforcement (May 2026): https://www.ftc.gov/news-events/news/press-releases/2026/05/ftc-begins-enforcing-take-it-down-act
- FTC statement, FTC and Utah v. Aylo (3 Sep 2025): https://www.ftc.gov/system/files/ftc_gov/pdf/2025.09.03-2123033-pornhub-mindgeek-ferguson-holyoak-meador-statement.pdf
- REPORT Act, Pub. L. 118-59: https://www.congress.gov/118/plaws/publ59/PLAW-118publ59.htm
- Ofcom fines: https://www.ofcom.org.uk/online-safety/protecting-children/ofcom-fines-porn-company-1.35-million-for-not-having-age-checks
- Mastercard, AN 5196 announcement (2021): https://www.mastercard.com/global/en/news-and-trends/perspectives/2021/protecting-our-network-protecting-you-preventing-illegal-adult-content-on-our-network.html
- Cloudflare service-specific terms (updated 28 Sep 2026): https://www.cloudflare.com/service-specific-terms-application-services/
- bunny.net AUP: https://bunny.net/acceptable-use/ ; Hetzner T&C: https://www.hetzner.com/legal/terms-and-conditions/
- Better Ads Standards: https://www.betterads.org/standards/

Secondary (law firms, press, trackers):
- AVPA US state tracker (Sept 2026): https://avpassociation.com/us-state-age-verification-laws-for-adult-content/ ; RecordingLaw: https://www.recordinglaw.com/us-laws/age-verification-laws/
- CJEU C-188/24 and C-190/24 (16 Jun 2026): https://lhermet.com/actualites/cjue-un-etat-peut-exiger-la-verification-de-lage-sur-les-sites-pornographiques ; https://dig.watch/updates/cjeu-age-verification-pornographic-websites
- Cabinet Persée (23 Jul 2026): https://cabinetpersee.com/blog/posts/plateformes-x-mineurs-verification-age-2026/
- Club des Juristes, 31 sites (30 Jul 2026): https://www.leclubdesjuristes.com/en-bref/verification-dage-larcom-engage-une-procedure-contre-31-sites-pornographiques-17191/
- Gizmodo, status of sites in France (18 Oct 2026): https://gizmodo.com/best-vpn/watch-pornhub-france
- JSS, Conseil d'État 15 Jul 2025: https://jss.fr/post/Le_Conseil_d%E2%80%99Etat_retablit_la_verification_de_l%E2%80%99age_pour_l%E2%80%99acces_aux_sites_pornographiques-6050
- Bird & Bird on the 11 Jan 2025 obligation: https://www.twobirds.com/en/insights/2025/france/double-verification-de-l-age-en-ligne-une-obligation-effective-depuis-le-11-janvier
- UK traffic after age checks: https://www.aol.com/articles/pornhub-says-uk-visitors-down-004347213.html ; https://www.techradar.com/vpn/vpn-privacy-security/the-age-verification-effect-adult-site-traffic-plummets-vpn-use-soars
- France VPN surge (Jun 2025): https://san.com/cc/vpn-demand-jumps-1000-after-pornhub-pulls-out-of-france/
- WilmerHale, TAKE IT DOWN Act (15 Jun 2026): https://wilmerhale.com/en/insights/client-alerts/20260615-the-take-it-down-act-goes-live
- FSC on 2257 litigation: https://www.freespeechcoalition.com/blog/long-running-2257-legal-battle-over-as-fsc-declares-victory
- Visa VIRP summaries: https://www.legitscript.com/regulatory-and-card-brand-compliance/visa-integrity-risk-program
- Micro-entrepreneur 2026: https://bpifrance-creation.fr/entrepreneur/actualites/micro-entrepreneurs-du-nouveau-2026
- 1099 thresholds (OBBBA): https://cpapracticeadvisor.com/2025/07/30/one-big-beautiful-bill-act-changes-1099-thresholds/165863/

Vendor (marketing; numbers not independently verified):
- TrafficJunky media kit (June 2026): https://webassets.trafficjunky.com/1793292783/pdf/TJ_MediaKit_June2026.pdf
- PPCmate pop CPM by country (30 Oct 2026): https://ppcmate.com/pop-push-cpm-benchmarks-by-country/
- LosPollos / Remoby popunder CPM (29 Sep 2026): https://www.lospollos.com/blog/popunder-traffic/
- bestadsnetwork eCPM benchmarks (29 May 2026, mainstream only): https://bestadsnetwork.com/blog/ad-network-ecpm-benchmarks-2026-by-format-and-geo/
- Network and affiliate reviews (affninja, afftank, affpaying, revshare.so), processor reviews (Merchant Maverick, factually.co): links inline in section 3.
