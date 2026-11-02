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
│ ◀  [峠] TŌGE   LB  RACE  GARAGE  PERFORMANCE  STYLE  RB         $57,500  ◉ Name │
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
- The car card sits bottom right and always describes the car on the turntable (a dealer car or a try-on included).
- Under 900 px the rail goes full width under a short showroom strip and the card hides.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48. Gutters are 16 px on phones and up to 40 px on desktop.

## 6. Information architecture

Four top tabs; a tab with more than one page shows sub-tabs at the top of the rail.

| Tab | Pages | What lives there |
| --- | --- | --- |
| **Race** | (one page) | The selected track as a hero with its map, rivals and *Race solo*; the track grid; Online (host, join by code, open races). |
| **Garage** | My cars · Dealer | Your cars (drive, sell) and driver stats; buying new cars. |
| **Performance** | Upgrades · Tuning | Upgrade crates per part; the tuning sliders. |
| **Style** | Paint · Locker · Cases | Free paint/wheels/body/glass and trim; cosmetics you own (equip, try on, plates); buying cases. |

Page ids (`dtab` in history, `Page` in hub.ts) are `race`, `garage`, `dealer`, `upgrades`, `tuning`, `paint`,
`locker`, `cases`. Keep them stable: they're restored on reload.

**Adding a page:** add it to `PAGES` in hub.ts under the right tab and give it a body function. Add a new top tab only
if the page fits none of the four; the bar shouldn't grow past five.

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

## 8. Motion

- Fast and directional: 160-240 ms, `cubic-bezier(.2,.8,.2,1)`. Page content slides in 12 px from the left as it
  appears; the hero fades up.
- Reels and reveals are the only long animations (4-5 s), and they're skippable by Esc / B when finished.
- Respect `prefers-reduced-motion`: no slides, reels jump straight to the result (cosmeticsui.ts already does).

## 9. Controllers, keyboard and accessibility

- Every interactive thing is a real `<button>` / `<input>`; the pad's spatial navigation (src/client/pad.ts) walks
  them by position, so keep layouts on a clear grid.
- Focus is a **3 px cyan ring with a glow**, bigger in pad mode (`html.pad`). Never remove it.
- **LB / RB** walk the pages in order (Race → My cars → Dealer → Upgrades → Tuning → Paint → Locker → Cases); the
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
