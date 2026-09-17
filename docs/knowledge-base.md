# Knowledge base: how programmatic ad auctions actually work

This document is the foundation for BidTown, an isometric explainer about the machine performance marketers actually operate: the auction that prices an impression in under 100 milliseconds, and the feedback loop that learns from what happens next.
It covers the real mechanism, the vocabulary, and the exact model that the explainer will implement and compute for real.

Sources of truth: the standard programmatic reference material (IAB OpenRTB specification, Google Ads and Meta ads help documentation on bidding and pacing, industry write-ups on first vs second price auctions and header bidding), and publicly reported benchmark ranges for CTR, CVR, CPM and CPA.

## 1. The 100 millisecond journey

A person opens a page or an app.
Before the content finishes rendering, an ad slot appears.
Filling that slot is a race between bidders, conducted by software, in roughly 100 milliseconds.
The sequence: the publisher's page asks its ad server or exchange for an ad; the exchange broadcasts a bid request to demand-side platforms; each DSP decides whether and how much to bid; the exchange runs an auction; the winner's creative is returned and rendered in the slot.
Then the part marketers actually optimize for happens: the impression is seen, maybe clicked, maybe converts into a purchase, and that outcome feeds back into the next auction.
One impression, one auction, one loop, repeated billions of times a day.

## 2. The players

- **Advertiser**: the brand or business with a budget, a target (CPA, ROAS) and creative.
- **DSP (demand-side platform)**: the software that bids on the advertiser's behalf, one auction at a time. This is "the bidder" in this explainer.
- **SSP / ad exchange**: the marketplace that receives the impression opportunity from the publisher and runs the auction. Many companies play both sides.
- **Publisher**: the site or app with the inventory and the audience.
- **Ad server**: the final component that selects the ad when a direct or guaranteed campaign takes priority over the auction, and that counts impressions and clicks.
- **Data / audience platforms**: where audience definitions live; a DSP checks a user against them, often through a cookie or an ID shared with the platform.

## 3. The bid request

A bid request describes the opportunity: an anonymous user ID, the device and connection, the page or app and its categories, the slot's size and position, and sometimes the user's interests or a deal ID.
It is small, structured, and arrives in bulk: one page view with three ad slots is three bid requests, and an exchange may send one request to dozens of DSPs.
The user is not watching this happen; the whole exchange takes less time than a blink.

## 4. Why anyone can bid at all: eligibility

A DSP does not bid on every request, and not bidding is usually correct.
The first filter is audience: is this user in the campaign's targeting, or in an exclusion, or outside the geography?
The second is frequency: has this user already seen this ad enough times today?
The third is budget: has pacing decided the campaign can still spend right now?
A request that fails any of these gets no bid, and that is a passed opportunity, not a lost auction.
Passing is cheap; bidding badly is expensive.

## 5. The bid

A bid is a CPM: the maximum the advertiser offers to pay per thousand impressions.
Under value-based or target-based bidding, the bid comes from an expected value per impression: the estimated click-through rate times the estimated conversion rate times what a conversion is worth, scaled to a CPM.
For a target CPA campaign, the worth of a conversion is the target itself: bid = pCTR x pCVR x targetCPA x 1000.
For a target CPC campaign it is pCTR x targetCPC x 1000.
Every number in that formula is an estimate made by a model, from historical data plus whatever the platform knows about this request.
Estimates are noisy: with little data, a handful of clicks can make the model wildly overconfident, which is why real systems use strong priors, exploration controls and huge feature sets.

## 6. The auction

An auction has a winner rule and a price rule.
The winner is the highest bid above the seller's floor, usually.
The price rule comes in two common forms.
In a **first-price** auction, the winner pays what it bid.
In a **second-price** auction, the winner pays the second-highest bid plus a small increment, never more than its own bid: the price is set by the runner-up, so bidding your true value is the rational strategy.
Most large exchanges moved to first price with header bidding, and bidders there use **bid shading** to guess what to pay; this explainer uses second price because it makes the pricing logic visible and it is the model most marketers still carry in their heads.
A floor price is the minimum the seller accepts; below it, the slot goes unsold or to another demand source.
Losing an auction costs nothing.

## 7. Pacing

Pacing spreads a budget across the day so a campaign does not spend everything before noon.
Real platforms pace smoothly and probabilistically, trading delivery against efficiency; a campaign with a $1,000 daily budget buying every request it can find at 9 a.m. is done by 9:20.
This explainer models pacing as a hard daily cap, declared in the fidelity ledger: once spend reaches the budget, the campaign passes on every remaining opportunity.

## 8. Frequency capping

Frequency capping limits how many times one user sees the same creative in a period.
It exists because impressions beyond a handful rarely change behaviour and still cost money, and because seeing the same ad twenty times actively annoys people.
A cap of three per day means the fourth request from that user is a pass, even mid-auction.

## 9. Billing and the metric tree

Advertising is mostly billed per thousand impressions, CPM, regardless of what happens next; when the platform bills per click, the CPC is derived from the same spend.
The whole performance vocabulary is arithmetic on four counters: impressions, clicks, conversions and spend.

- CPM = spend / impressions x 1000
- CTR = clicks / impressions
- CVR = conversions / clicks
- CPC = spend / clicks = CPM / (CTR x 1000)
- CPA = spend / conversions = CPC / CVR
- ROAS = revenue / spend = AOV / CPA, where AOV is the average order value

Two consequences worth teaching. First, a click does not cost extra under CPM billing; the CPC figure is a derived view of the same spend. Second, ROAS and CPA are two views of one number: with a fixed AOV, hitting a CPA target is hitting a ROAS target.
Real numbers for context: display CTR is typically around 0.1 percent, search CTR often 2 to 6 percent on brand-heavy queries; CVR from a click is commonly 1 to 5 percent; display CPMs commonly run from under $1 to a few dollars, with $15 and up being premium or video territory.

## 10. Attribution

A conversion is credited to a click or a view according to an attribution model: last click, first click, linear, position-based, or a data-driven model.
Attribution windows matter: a click from Tuesday can claim a purchase on Friday in a seven-day window.
This explainer credits conversions to the click that preceded them, the last-click model, and declares it.

## 11. The optimization loop

Everything above is one auction.
The reason the system gets better is the loop: outcomes from delivered impressions flow back as training data, the estimates move, and the next bid changes.
Real platforms learn with machine learning models trained on enormous feature sets, and they deliberately explore: some auctions are entered to buy information, not conversions.
This explainer's loop is a declared simplification: the estimates are smoothed observed rates, the bid rule is the target-CPA formula, and there is no exploration. It still demonstrates the real dynamic: evidence moves the estimate, the estimate moves the bid, the bid moves the outcome.

## 12. What the BidTown model computes

The explainer runs one campaign across a scripted day of 24 ad opportunities for six users (u1 to u6, four opportunities each). The environment is a script; every number the campaign computes from it is real arithmetic.

Fixed facts of the town:

- Average order value: $45, fixed and declared.
- One opportunity is a 1,000-impression block from one placement, so a 24-opportunity day moves real dollars: one delivered block bills the clearing CPM as its price, and the CPM identity (spend / impressions x 1000) at the end reads exactly the clearing prices that were paid. A real auction fills one impression; the auction logic here is unchanged, the block is the declared unit so that a day fits in 24 laps.
- There are two rival bidders per opportunity, with CPM bids taken from a fixed script (2.05 to 5.10, cheap early, competitive mid-day, cheap again late). There is no floor price in the model: declared, the scripted rivals are the whole market.
- The audience is scripted: three of the 24 opportunities are outside the campaign's targeting (rows 10, 15 and 19), and the audience's responses are a fixed script: each delivered block carries a set number of clicks (4 to 9 per 1,000 impressions, scripted per block index), and the 2nd, 8th and 12th delivered blocks each produce one conversion.

The campaign's own arithmetic, all computed live:

- **Estimates**: pCTR_hat = (clicks + 10) / (impressions + 2000), prior 0.5 percent; pCVR_hat = (conversions + 5) / (clicks + 200), prior 2.5 percent. Smoothed observed rates with heavy pseudo-counts, the honest simple version of what a real model does: a platform starts with history, so two lucky clicks must not double the bid.
- **Bid**: bid = pCTR_hat x pCVR_hat x targetCPA x 1000, clamped to [$0.10, $20.00]. With the prior estimates and a $30 target: exactly $3.75.
- **Gate**: audience, then frequency cap, then budget; the first failing check is why the bid was passed, and the panel names it. The budget cap is checked before the auction, so the day can overshoot by one clearing price.
- **Auction**: our bid against both rival bids; we win if our bid is strictly the highest (a tie loses); the clearing price is the runner-up plus $0.01, never above our own bid, rounded to cents; losing costs nothing; winning books the clearing CPM as the block's cost.
- **Response**: scripted by delivered block, as above; clicks add to the click count; a conversion adds one conversion and $45 of revenue.
- **Metrics**: every formula in section 9, recomputed from the counters on every opportunity.
- **Learning**: the estimates update from the counters at the end of every opportunity, and the next bid is recomputed. No exploration, no ML: declared.

Reader controls (all real model inputs, with tested effects):

- **Daily budget** (default $36): the pacing cap. At the defaults the day delivers 11 blocks, 2 conversions, and closes at a $19.25 CPA on a $38.50 spend (one clearing overshoots the cap); raising it to $40 buys the 12th block, its conversion, and a $14.02 CPA.
- **Target CPA** (default $30): scales the bid directly through the formula. Raising it makes the bid win more auctions and spend the same budget on fewer, dearer blocks; on a fixed budget that is fewer impressions, not more.
- **Frequency cap** (default 3): the per-user block limit. Lowering it delivers fewer blocks; the first gate at the defaults fires on row 4 because u1 has had all three.

## 13. Fidelity ledger seed

- **Computed for real**: the eligibility checks; the frequency counts; the smoothing and the estimates; the bid formula and its clamp; the auction outcome and the runner-up clearing; the billing; the counters; every metric identity; the pacing arithmetic; the learning update.
- **Scaled**: one opportunity is a 1,000-impression block rather than a single impression, so a 24-lap day can carry a real budget and a real CPA.
- **Assumed**: the AOV; the prior pseudo-counts; the bid clamp; hard-cap pacing instead of smooth pacing; second price instead of first price with shading; no floor price; last-click attribution only.
- **Scripted (the environment, not computations)**: the rival bids, the audience flags, the user map, and the clicks and conversions the audience produces. The script is fixed data in `js/model.js`; the campaign's response to it is arithmetic.
- **Deliberately faked**: the buildings and the town. Nothing numeric.

## 14. Misconceptions to defeat

- A click does not raise what you pay under CPM billing; it raises what you can learn.
- Second price does not mean you pay the lowest bid, it means you pay the runner-up class of price; the floor still applies.
- The bid is not the price you pay; the clearing price is.
- Bidding more wins more auctions and makes efficiency worse at the same estimates; target-based bidding is a trade, not a dial to maximum.
- A low CPA on tiny volume is noise, not performance; the estimates are still mostly prior.
- Frequency caps and budgets are not restrictions on the machine, they are the levers that keep it from wasting money.
- Real platforms do not maximize ROAS by magic; they estimate values, bid them, and explore.
