# Accuracy review of the knowledge base

Step two of how this project was built was to review `docs/knowledge-base.md`
for accuracy before any code existed. The review was done by a separate agent
instance with one instruction: verify the claims, check every metric identity
algebraically, and report findings with severity.

## Findings and fixes

1. **MINOR: the billing scale made the panel CPM 1000x the auction price.**
   The first draft billed one impression at the clearing CPM's dollar value, so
   a $3.64 clearing would display as a $3,640 CPM. The identities still held,
   but the label carried two values 1000x apart.
   Fix: the unit became a 1,000-impression block per opportunity; one delivered
   block bills the clearing CPM as its price, so the CPM identity reads the
   real clearing prices, and the metric benchmarks stay believable (CPM ~$3.50,
   CTR ~0.55 percent, CVR ~3 percent on the default day).

2. **MINOR: the winner had to clear a floor, but the model has none.**
   Fix: declared in sections 12 and 13: there is no floor price, the scripted
   rivals are the whole market.

3. **MINOR: the first script implied a 12.5 percent CTR and a 67 percent CVR.**
   Fix: responses are scripted per delivered block of 1,000 impressions (4 to 9
   clicks each, conversions on the 2nd, 8th and 12th blocks), which lands in
   the believable range.

4. **NIT: a stated prior was rounded (1/66 is 1.52, not 1.5 percent).**
   Fixed by the final priors, which are exact: pCTR (clicks + 10) / (impressions
   + 2000) and pCVR (conversions + 5) / (clicks + 200).

5. **NIT: response indices assumed a delivery count the spec never guaranteed.**
   Fixed by the block script, which is bounded by the 24-lap day and covered by
   tests on the default run.

6. **NIT: the frequency cap was per user, but the spec never mapped users to
   opportunities.** Fix: section 12 now states the six-user map and the
   scripted out-of-audience rows.

7. **NIT: ledger buckets were muddled (scaled vs assumed vs faked).**
   Fix: the ledger now separates computed / scaled / assumed / scripted
   environment / faked.

8. **NIT: "A bid is a CPM: what the advertiser will pay" conflated the bid with
   the clearing price.** Fix: "the maximum the advertiser offers to pay".

9. **NIT: benchmark ranges skewed high.** Fix: search CTR qualified as
   brand-heavy, and the CPM top end qualified as premium or video.

## What the review confirmed

All five metric identities are exactly right; the second-price mechanics, the
truthfulness argument, first price plus shading, pacing, frequency capping,
attribution models and the ML plus exploration claims check out; the initial
bid arithmetic is correct; and the strictly-highest-wins rule with
runner-up-plus-a-cent clearing is coherent.

## A real bug the tests found

Writing `test/model.test.mjs` against hand-derived values caught a genuine
error the review could not see: the clearing price was computed from the
*lower* rival bid instead of the runner-up (the highest other bid). Every
early clearing was undercharged. The fix is in `clearingFor()` in
`js/model.js`, and the auction rule is now pinned by four direct test cases
(win, loss, tie-loses, and clearing capped at our own bid) plus the
hand-traced first five rows of the day.
