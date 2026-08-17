# UX review — ask.permission.ai

**Environment:** Chromium 151 — desktop 1440x900 and Pixel 5 (393x851). Anonymous
surface automated; post-signup captured human-in-the-loop on a real account
(100 ASK balance), since login is captcha-gated.

## What works

The composer is the whole anonymous interface: send disabled when empty,
whitespace trimmed, and an accurate on-screen "Press Shift + Enter for new line"
hint. Replies land in ~3s. Across all eleven pages captured there is **no
horizontal overflow**. Signed in, the nav is clear and the balance always visible.

## Anonymous

**1. Consent dialog covers the primary action.** Its button sits at y=707, the
composer at y=672 — measured overlap. Worse on Pixel 5, where it takes the lower
third.

**2. An empty room.** ~400px of blank white between greeting and composer, and
nothing suggests what to ask, because the six suggestions the API serves never
render (BUG-1). The onboarding affordance is missing exactly where it belongs.

**3. Silence during the wait.** No spinner or status text for 3-8s; the composer
just goes dead. Screen-reader users get nothing — the transcript has no `aria-live`
(BUG-3; the only live regions on any page are the cookie banner's).

**4. It invites follow-ups it cannot answer.** Replies end "Would you like to know
more…?", but there is no conversation memory (BUG-4), so accepting fails.

## Post-signup

**5. The earn-and-redeem loop is closed (worst finding).** Redeem contains only
**"Past Offers"** — eight entries, all expired, no active section. One live action
exists: a 25 ASK survey. Withdrawal is gated at 5,000 ASK ("collected 2%"), so 200
repetitions. The agent promises offers and surveys; the account shows dead coupons
(BUG-6).

**6. Expired dates omit the year** — "Ended on Sunday, June 1" and "Friday,
January 2" sit in one list spanning two years.

**7. Contradictory wallet copy:** "you'll need at least 4,900 ASK to make a
withdrawal" above a `100 / 5,000` meter — 4,900 is the shortfall, not the threshold
(BUG-7).

## Prioritised

1. **Render the suggestions** — data and flags already exist; fills the dead space.
2. **Ship an active offer, or honest empty-state copy.** Nothing else matters if the
   loop can't close.
3. **Give the wait a voice:** typing indicator plus `role="log"`/`aria-live`.
4. **Persist `session_id`,** or stop writing replies that invite follow-ups.
5. **Fix the 4,900/5,000 copy** and add years to offer dates.
6. Keep consent off the composer; bound the login wait (BUG-2); send button to 44x44.
