# TŌGE design system and brand identity

This is the rulebook for how TŌGE looks, reads and moves outside the race itself: the home screens (`hub.ts`), the
race lobby (`lobby.ts`), cosmetics (`cosmeticsui.ts`) and anything new you add around them. The in-race HUD
(`.rh-*` in race.css) follows the colours and type here but keeps its own layout rules.

The tokens and the shared components live in **`src/toge/client/hub.css`**. Use them; don't hard-code colours, fonts or
radii in new CSS. If something you need is missing, add a token or a component there and write it up here.

## 1. Brand

**Name.** TŌGE (峠): Japanese for a mountain pass, and the street racing that grew up on them. Always written
`TŌGE`, all caps, with the macron. In code and URLs it's `toge`.

**Promise.** Night roads, real cars, your own build. It should feel like the garage you'd want at 2 a.m. before a
run down the mountain: dark, warm with neon, a little dangerous, never cluttered.

**Logo.** Two parts, always together in the top bar:

- the **hanko mark**: the kanji 峠 in white on a vermilion (`--tg-red`) square, like a signature stamp, slightly
  rotated (-4°);
- the **wordmark**: `TŌGE` in Barlow Condensed 800 italic, wide tracking (0.18em), white.

Don't recolour the mark, outline it or put it on a busy picture. On light or photographic backgrounds put it on an
ink panel.

**Tagline.** "Own the pass." Use it sparingly (the empty states, the loading card), never twice on a screen.

**Voice.**

- Short, confident, second person. "Race solo", "Host a race", "Your cars". Not "Click here to…".
- Car-culture words are welcome (pass, run, build, tune, rivals, ghost), memes and exclamation marks aren't. One `!`
  is allowed for a genuinely big moment (a jackpot, a mythic drop).
- Numbers carry units: `5.3 km`, `392 hp`, `$1,200`. Money is always gold and always `$` with thousands commas.
- Buttons are verbs. Section titles are nouns.

## 2. Colour

Defined as custom properties on `.tg` in hub.css.

| Token | Value | Use |
| --- | --- | --- |
| `--tg-ink-0` | `#05070b` | The deepest background, the showroom void. Matches the showroom's scene colour. |
| `--tg-ink-1` | `#0b0f17` | Panels and the top bar (usually at 70-85 % opacity over the showroom). |
| `--tg-ink-2` | `#121926` | Cards and rows. |
| `--tg-ink-3` | `#1a2333` | Hover / raised cards. |
| `--tg-line` / `--tg-line-2` | white at 8 % / 16 % | Hairlines and card borders. |
| `--tg-text` | `#eef2f8` | Body text. |
| `--tg-dim` | `#8e9ab0` | Secondary text, labels. |
| `--tg-faint` | `#5c6779` | Disabled, hints. |
| `--tg-red` | `#ff3b30` | **Brand and primary action.** The hanko, the one main button per screen (Race, Start, Buy, Open), the active tab underline. |
| `--tg-red-2` | `#ff7a2b` | The warm end of the primary gradient. |
| `--tg-cyan` | `#38c9ff` | **Selection and focus.** What's picked (a track, a pill, a slot), focus rings, progress bars. |
| `--tg-pink` | `#ff3d9a` | Neon accent only (the showroom's second neon, glows). Never for text or state. |
| `--tg-gold` | `#ffc940` | **Money and rewards only.** Wallet, prices, payouts, jackpots. |
| `--tg-good` / `--tg-bad` | `#3ddc84` / `#ff6b6b` | Success and danger (selling a car, errors). |

Rules:

- **Red acts, cyan selects, gold pays.** If you're tempted to use one of them for something else, don't.
- One red primary button visible per screen region. Everything else is a ghost or a pill.
- Car classes keep their own colours (`CLASS_COLORS` in cars.ts) and cosmetics their rarity colours (`RARITY` in
  cosmetics.ts). Those are data colours: show them on badges, borders and dots, not as large fills.
- Track themes have an accent each (`THEME_ART` in hub.ts) used for the track card's sky. Keep them in step with
  `LOOKS` in trackview.ts if a theme's mood changes.

## 3. Type

Fonts: **Barlow Condensed** (display) and **Barlow** (text), loaded once from Google Fonts at the top of race.css.

| Role | Style | Class / token |
| --- | --- | --- |
| Display (screen hero, car name on the card) | Barlow Condensed 800 *italic*, 40-56 px, tight leading, -0.01em | `.tg-display` |
| Title (card titles) | Barlow Condensed 800 italic, 22-28 px | `.tg-title` |
| Label (section heads, stat names, tabs) | Barlow Condensed 700, 12-18 px, UPPERCASE, 0.14-0.18em tracking | `.tg-h`, `.tg-label` |
| Body | Barlow 400/500, 14-15 px, 1.45 line height | default |
| Small | Barlow 500, 12 px, `--tg-dim` | `small` |
| Numbers | anything numeric uses `font-variant-numeric: tabular-nums` | `.tg-num` |

Italic condensed is the racing voice; use it for names and headlines, never for paragraphs.

## 4. Shape and texture

- **The speed cut.** Primary buttons, top tabs and the class badge are parallelograms leaning forward (`--tg-skew`,
  -12°). Do it with `clip-path` or `transform: skewX()` on a pseudo-element so the text stays upright.
- **The notch.** Cards have a 6 px radius and one clipped top-right corner (`--tg-notch`, 14 px), like a cut sheet of
  carbon. Use `.tg-cardbox` for it.
- **The kerb.** A red-and-white striped rule (`.tg-kerb`). At most one per screen, under the hero.
- **Glass.** Panels over the showroom are ink with blur (`backdrop-filter: blur(14px)`), never pure transparency: text
  must stay readable whatever colour car is behind it.
- Shadows are deep and soft (`--tg-shadow`). Glows are for neon things (focus, rarities, underglow), not for text.

## 5. Layout: the screen anatomy

Every home screen is the same frame:

```
┌ top bar ───────────────────────────────────────────────────────────────────────┐
│ ◀  [峠] TŌGE  LB  RACE  GARAGE  PERFORMANCE  STYLE  DRIVER  FRIENDS  SETTINGS  RB  $57,500 ◉ │
├──────────────────────────────┬──────────────────────────────────────────────────┤
│ rail (glass, scrolls)        │                                                  │
│  sub-tabs (if the tab has    │          the showroom: your car, full bleed,     │
│  more than one page)         │          framed in the space right of the rail   │
│  page content                │                                                  │
│                              │                                  ┌ car card ───┐ │
│                              │                                  └─────────────┘ │
└──────────────────────────────┴──────────────────────────────────────────────────┘
```

- The showroom canvas fills the whole window **behind** everything; the rail and the card float over it. The car is
  framed into the free space (`Showroom.place()`), so it's never hidden behind the rail.
- The rail is `--tg-rail` wide (560 px, shrinking on small screens), scrolls on its own, and keeps the page's main
  action visible without scrolling.
- The car card sits bottom right and always describes the car on the turntable (a dealer car or a try-on included);
  on the Driver page it describes your driver instead.
- Your driver stands on the turntable by the driver's door on every page. The Driver page turns the platform so they
  face the camera and walks in close; dragging then turns the driver, not the car.
- Under 900 px the rail goes full width under a short showroom strip and the card hides.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48. Gutters are 16 px on phones and up to 40 px on desktop.

## 6. Information architecture

Seven top tabs; a tab with more than one page shows sub-tabs at the top of the rail.

| Tab | Pages | What lives there |
| --- | --- | --- |
| **Race** | Race · Leaderboard | Race: the selected track as a hero with its map, rivals and *Race solo*; the track grid; Online (host, join by code, open races). Leaderboard (leaderboardui.ts): a track's hero with its record, where you stand and *Race it*; its all-time board (one time per account, top 50: yours lit cyan with a You tag, friends tagged, the record holder's row gets a red tick); every track with its record holder to switch boards. Michael asked for it (2026-11-05). |
| **Garage** | My cars · Dealer | Your cars (drive, sell) and driver stats; buying new cars. |
| **Performance** | Upgrades · Tuning | Upgrade crates per part; the tuning sliders. |
| **Style** | Paint · Locker · Cases | Free paint/wheels/body/glass and trim (cars only for the body and glass options); cosmetics you own (equip, try on, plates); buying cases. |
| **Driver** | (one page) | Your driver (riderui.ts): four cards (`.tg-driver`, each in the driver's glow colour `--c`), free to switch. The showroom walks in to the driver and the card gives their nickname and story. |
| **Friends** | (one page) | Add a friend by username, your friends (Mutual tag when they added you back), "Added you" with Add back, your best time per track. Opening a friend (friendsui.ts) shows their record, their garage (View puts a car on the turntable, their driver beside it, the card ribbon says whose garage it is) and their best times beside yours with the gap (green you're quicker, red slower). Signed in only; guests get a sign-in card and their own times. Michael asked for it (2026-11-03). |
| **Settings** | (one page) | Device settings (settingsui.ts), saved in this browser: Graphics High / Low as two option cards (`.tg-gfx`). Michael asked for it as its own tab (2026-11-02). |

Page ids (`dtab` in history, `Page` in hub.ts) are `race`, `leaderboard`, `garage`, `dealer`, `upgrades`, `tuning`, `paint`,
`locker`, `cases`, `driver`, `friends`, `settings`. Keep them stable: they're restored on reload.

**Adding a page:** add it to `PAGES` in hub.ts under the right tab and give it a body function. Add a new top tab only
if the page fits none of the seven; the bar is full at seven (it already tightens under 1100 px), so a new page goes under one of them.

## 7. Components

All in hub.css (cosmetics-specific ones, `.cz-*`, in cosmetics.css).

| Component | Class | Notes |
| --- | --- | --- |
| Primary button | `.tg-go` | Red gradient, speed-cut, uppercase italic label. `.small` for in-card use. One per region. |
| Secondary button | `.tg-go.alt` | Ink with a hairline; same shape. |
| Pill | `.tg-pill` | Small choices and actions. `aria-pressed="true"` turns it cyan. `.danger` for selling. |
| Segmented control | `.tg-seg` wrapping `.tg-pill`s | A single choice from a few (rivals, finish, spoiler). |
| Top tab | `.tg-tabs [role=tab]` | Uppercase condensed; the active one gets the red underline and white text. |
| Sub-tab | `.tg-subtabs [role=tab]` | Smaller, cyan underline. |
| Section head | `.tg-h` (+ `small`) | Uppercase label with a short red tick before it. |
| Card | `.tg-cardbox` | Notched ink card. |
| Class badge | `.tg-class` | Class letter on the class colour + PI. Always beside a car's name. |
| Stat bar | `.tg-stat` | Segmented bar (10 segments), cyan, value at the end. |
| Tag | `.tg-tag` | Tiny uppercase status (DRIVING, HOST, OWNED). `.you` is gold. |
| Status line | `.tg-status` | `role="status"`, gold; one per page, at the bottom of the rail. |
| Track tile | `.tg-track` | Theme sky + painted backdrop + track map; selected = cyan frame. |
| Modal | `.tg-modal` + `[data-nav-scope]` | Reels and confirmations. Esc / B closes when it's safe. |
| Mode card | `.tg-modes` > `.tg-mode` | The lobby's big choices: mode (Race, Time trial, Hill climb) and the car rule. Name + one-line blurb; selected = cyan frame. The track grid under it shows only the tracks the mode runs (a Hill climb: its mountain). |
| Crew | `.tg-crew` > `.tg-crew-m` | The lobby's row of drivers (portraits from riderportrait.ts) on a lit floor, name and car under each; yours is gold. |
| Option card | `.tg-gfx` > `.tg-gfx-opt` | A big either/or with a list of what each choice means (Settings → Graphics). Picked = cyan frame + `aria-pressed`. |
| Friend row | `.tg-friends` > `.tg-friend` | Initial in a ring (`.tg-friend-av`), name in the italic display face, a tag, pill actions. Remove takes two presses, like selling. |
| Times table | `.tg-times` | Track (name + kind and length) then times in tabular numbers with a small line under each (the car, the date, or the gap: `.good` / `.bad`). |
| New best | `.rh-pb` (race.css) | Gold tag before a finish time on the results: "New best −0.532", then `.rh-rank` (cyan outline, "#4") when it's on the all-time board. |
| Track record | `.rh-record`, `.rh-tr` (race.css) | A new all-time record: a red banner over the results (the speed-cut "Track record" tag, the racer, the time, the gap on the old record and whose it was) and a red tag on their row in place of New best. |
| Board | `.tg-lb` (a `.tg-times`) + `.tg-lb-tracks` > `.tg-lb-track` | The Leaderboard page: position, racer (car + date under), You / Friend tag, time with the gap to the record under. Track buttons give the record and its holder; the open one has the cyan frame. |
| Player card | `.tg-pcard` (modal) | Your name top right opens it (on a phone, the icon). A trading card drawn on one canvas (playercard.ts) in these tokens: hanko + wordmark, your car and driver under neon, name, the car's class badge, three big numbers (wins, win rate, races), six small ones and personal bests, the kerb and "Own the pass." at the foot. Tilts toward the pointer with a sheen. Download PNG is the red action; Share (where the browser shares files), Account / Sign in, Close. |
| Face | `.tg-face` | A racer's head cropped from their portrait, ringed in their car's paint. Grid rows. |
| Loading screen | `.tg-loader` (loading.css) | Shown while a race builds (loading.ts, called from `drive()` in src/client/main.ts; Gambol keeps its own). Full bleed: the track theme's sky and painted backdrop rolling slowly forward under an ink shade, logo top left, the run ("Solo · 5 rivals", "Online race · 4 racers · Physics") as a glass chip top right, then the track's kind and length, its name huge, its tag and the kerb; the track map draws itself on the right in the theme accent. At the foot a cyan Tip, an indeterminate cyan sweep and "Own the pass.". Stays up at least 1.1 s, fades in 0.6 s. Tips live in loadingcopy.ts: one line, house voice, true to the game. |

## 8. Motion

- Fast and directional: 160-240 ms, `cubic-bezier(.2,.8,.2,1)`. Page content slides in 12 px from the left as it
  appears; the hero fades up.
- Reels and reveals are the only long animations (4-5 s) besides the loading screen's slow backdrop roll, and they're skippable by Esc / B when finished.
- Respect `prefers-reduced-motion`: no slides, reels jump straight to the result (cosmeticsui.ts already does).

## 9. Controllers, keyboard and accessibility

- Every interactive thing is a real `<button>` / `<input>`; the pad's spatial navigation (src/client/pad.ts) walks
  them by position, so keep layouts on a clear grid.
- Focus is a **3 px cyan ring with a glow**, bigger in pad mode (`html.pad`). Never remove it.
- **LB / RB** walk the pages in order (Race → Leaderboard → My cars → Dealer → Upgrades → Tuning → Paint → Locker → Cases → Driver → Friends → Settings); the
  top tab follows. Start (Menu) is the page's main action where one exists.
- Each page marks its first sensible control `data-autofocus`.
- Text on glass must hit 4.5:1 against `--tg-ink-1`. `--tg-dim` on ink-1 passes; `--tg-faint` is only for disabled.
- Tabs use `role="tablist"` / `role="tab"` / `aria-selected`; choices use `aria-pressed`.

## 10. Do and don't

- Do lead every page with the thing you came to do (Race solo, your car list, the crate). Don't bury it under a list.
- Do show the car. Panels never cover the turntable completely.
- Do reuse the components above. Don't invent a new button style for one screen.
- Don't use emoji as UI icons in new work (the part icons and decals are content, they stay). Use the inline SVG
  icons in hub.ts (`ICON`).
- Don't put more than one gold number or one red button in the same card.
