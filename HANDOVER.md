# Handover — UI/UX round, as of 2026-09-09

Where the UI/UX pass got to, what is verified, and what is queued. Written
into the repo rather than left in a conversation, because the next session
starts cold.

Delete a section from this file when its work is done.

## Done

| Phase | What | Commit |
|---|---|---|
| 1 | Portalled the fund search list; example-basket pool of four, walked in order; stale-result marking | `d7b2e9c` |
| 1 fixes | Stale notice sticky and legible; "Sepete dön"; the portal rule written into CLAUDE.md | `043be99` |
| 1.5 | Stopped caching failed TEFAS requests as facts about a fund (P0) | `dd474b8` |
| 2.1, 2.2, 2.4 | Finding lifted into the fund page hero; neighbours as 48px rows; weekly scenario-drift check | `776a980` |
| 1.5b | Fetch window derived from the return periods + the CPI lag; four `HISTORY_MONTHS` untangled; `get_fund_history` deleted; stale result desaturated | `eeaaa28` |
| 2.3 | `fund_returns` / `fund_prices` / `cpi_index`; period selector and chart on the fund page | `081c174` |
| 2.5 | Straggler round in `jobs.weekly`: one retry pass over the `request_failed` codes, after the fetch loop and before compute | this round |

**The straggler round is the deploy's own finding, fixed.** Three
full-universe runs on 2026-09-09 each lost a different set of funds to
short bursts of `RemoteDisconnected` — eight (NFF, NHA, NHP, NJR, NJY, NKT,
NOI, NRG, all inside 78 seconds), then four (KDL, KDO, KEB, KED), then a
third set. The second run recovered all eight of the first run's casualties,
which is the proof that nothing was wrong with any of them: the endpoint
drops connections for a minute and the alphabet decides who is under the
cursor. `KEB` has 344,731 investors and ₺5.45bn; `KDL` has ₺25.4bn.

`_retry_stragglers` re-asks only the `request_failed` codes, which is the one
failure kind that is the *absence* of a finding rather than a claim about a
fund. It is bounded by the failures rather than the universe — twelve funds
is about twelve seconds against a half-hour fetch — and `no_rows` /
`no_valid_prices` are never re-asked. It logs a line on **every** run,
including the clean ones ("no unmeasured codes, nothing to retry"), because
a round that only speaks when it has work cannot be shown to have run on the
runs where it matters. `tests/straggler_test.py` covers all six cases
against a stub client and touches nothing live.

Re-running the job was never going to fix this. Each run is a fresh lottery
over whoever is being fetched during the next blip, not noise around a mean,
so the counts do not converge — which is also why the acceptance criterion
for this deploy stopped being a number and became "are the excluded funds
exactly VPD, VPE and ICM?".

The period list is **settled**: `6 ay | 1 yıl | 3 yıl | 4 yıl`, in
`web/lib/windows.json`. There is no five-year option and this is not an open
question — measured on 2026-09-09, asking `tefas-crawler` for 72, 84 and 120
months of GAL, AFO and TI2 all returned the same first row, 2021-09-08. The
floor is five years back from today and moves forward daily, so a 60-month
window ending at the CPI cap needs prices from before it. Do not reopen.

## 2.3 — what is and is not verified

Verified against a real 19-fund slice, whole path, both themes, 390px and
1280px:

- The job writes all three tables (76 return rows, 4066 weekly prices, 72
  CPI months) and the API serves them.
- All four periods carry the right window and both figures.
- A fund too young for the long windows (`AP5`) shows `3 yıl` and `4 yıl`
  disabled with reasons, refuses the press, and produces no number.
- The inflation line is a staircase with exactly one rise per month — 48
  over AFO's four years, 11 over AP5's twelve months.
- The radiogroup's roving tabindex, arrows, Home/End, and the arrows
  skipping unavailable periods.

**Not verified:**

- ~~The full 1374-fund universe has never been run against this schema.~~
  **Done on 2026-09-09, on Railway, against production.** Three runs, each
  31 minutes for 1375 funds (~1.05 funds/sec, peak 369 MiB). The schema
  holds at full scale: `fund_prices` lands exactly 214.0 rows per fund on a
  complete W-FRI grid, `cpi_index` 72 months, `fund_returns` four rows per
  fund with 845-847 of them carrying a 36-month figure — the number
  `DEPLOY.md` says must not be zero. All four example baskets still produce
  their tiers. The eight-and-a-half-hour figure that made this look
  impossible was a sleeping laptop, not TEFAS; see `CLAUDE.md`.
- **"The inflation line stops at the last published CPI month" is satisfied
  by construction, not observably.** The chart is capped at the selected
  period's return window, and that window already ends at the last CPI
  month, so there is never a stretch of weeks to carry the index across. The
  mechanism is covered by a unit test (a window pushed past the cap leaves
  nine null weeks, `connectNulls` off) but cannot be seen on the page.
  **This is a decision worth revisiting**: if the value line should run to
  the most recent price instead — showing the reader the latest value, at
  the cost of the chart ending later than the figures beneath it — the
  stopping rule becomes visible and the change is in
  `fundChartData`'s `toExclusive`.
- The chart and the printed figures share a window but are not the same
  number to the last decimal: figures are daily, the line is weekly, so its
  endpoints sit a few days inside the window's edges. Documented in
  `lib/fund-chart.ts`; mentioned here so nobody "fixes" it as a bug.

## Phase 3 queue

These came out of the 2026-09-09 production deploy. The straggler round that
answers most of it is already written (see Done); what is left below is the
half of the bug it does not cover.

**A fund that was never measured is written as `no_weekly_returns`.** The
fetch layer gets this right and says so in the log — `recorded as
unmeasured, not as an empty fund` — and then the job layer throws the
distinction away: all eight of the funds above landed in `funds` with
`included = false` and `exclusion = 'no_weekly_returns'`. That is a claim
about the fund ("it has no weekly returns") standing in for the absence of
any claim at all ("the request did not complete").

**This is the same class of bug as the P0 fixed in `dd474b8`** — passing a
failed request off as a finding about a fund — surviving in a second place
because that fix stopped at the cache and the exclusion mapping was never
looked at. `request_failed` needs its own `exclusion` value, distinct from
every kind that describes the fund.

The straggler round takes most of the sting out of this: a code only reaches
the exclusion mapping after failing twice, minutes apart, so the label is
wrong far less often. It is still wrong when it happens, and the fix is
small. It stays near the top for that reason and not because it is urgent.

**`_return_rows` does not filter by `included`; `_price_rows` does.** So
`fund_returns` carries rows for excluded funds: after the 2026-09-09 run it
held 5464 rows against 1364 included funds, the extra eight being VPD and
VPE, which were fetched fine but produced no weekly returns. Harmless —
those funds have no page, so nothing reads the rows — but the two writers
should agree on what a snapshot contains. Pick one rule and apply it in
both.

**Move `InfoTip` and `NeighbourPopover` into portals.** Both are still
`absolute … z-40` inside their sections, which violates the rule now written
in CLAUDE.md: `Reveal` and `ScrollRise` each hold a permanent stacking
context, so no z-index inside one is comparable with anything outside it.
`DateInput`'s calendar and `FundSearch`'s list are the two that already
comply — copy their shape (`createPortal` + floating-ui with
`transform: false`, plus outside-press and Escape).

**Horizontal overflow at 390px, same cause.** With a result on screen the
basket page measures `scrollWidth` 451 against `clientWidth` 375. The
offenders are `InfoTip`'s absolutely positioned `w-72` box and
`ResultTable`'s `table-fixed` colgroup, which lays out 480px wide. Confirmed
pre-existing on a stashed baseline — not introduced by this round.
Portalling `InfoTip` fixes half of it.

**CLAUDE.md line about tables is false.** It claims fixed-layout tables mean
"nothing scrolls sideways". The measurement above says otherwise. Either fix
the table or fix the sentence; do not leave both.

**Basket form card density (was 3.4).** Each fund card is ~390px tall, so
five funds put the form past 2000px. Intended shape: code + name on one
line, amount / basis / date on a second. Same problem the fund page had
before 2.1.

**`--positive` is a marginal colour token.** It measures **4.54:1**
undimmed against the sunken ground — barely over AA for normal text, and
under it the moment anything dims. That is why the stale-result block cannot
reach 4.5:1 for its green figures at any opacity (the ceiling is 4.11 at
`saturate(0)`); it currently passes only because those figures are 26px and
so count as large text at a 3:1 threshold. Darken the token rather than
working around it downstream.

**Also open, from 3.5:** the search box says "2579 fon arasında arayın" but
only ~1372 funds have pages. What happens when someone reaches a fund with
no page was never established — `dynamicParams` is on, so it should render on
demand, but this was not tested. Decide the behaviour before changing
anything.

## Rules learned this round

- **Verification must assert a positive property.** The phase 1.1 check
  passed on a broken build because it asserted "no intersection" while the
  dropdown sat in the page's corner. Assert where things *are*: "the list is
  4px below the input and left-aligned to it".
- **Derive margins, do not pick them.** The CPI publication gap varies from
  a few days to about five weeks, so any hand-chosen constant is wrong on
  some day of some month. See `src/windows.py`.
- Headless Chrome produces no frames unless something asks, so
  `requestAnimationFrame` does not tick and Framer Motion sits at its
  `initial` value. Force a few screenshots before measuring or capturing —
  `cdp.py`'s `shot(settle=…)` in the scratchpad did this.
