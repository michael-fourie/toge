# KANJO design system and brand identity

This is the rulebook for how KANJO looks, reads and moves outside the race itself: the home screens (`hub.ts`), the
race lobby (`lobby.ts`), cosmetics (`cosmeticsui.ts`) and anything new you add around them. The in-race HUD
(`.rh-*` in race.css) follows the colours and type here but keeps its own layout rules.

The tokens and the shared components live in **`src/kanjo/client/hub.css`**. Use them; don't hard-code colours, fonts or
radii in new CSS. If something you need is missing, add a token or a component there and write it up here.

## 1. Brand

**Name.** KANJO (峠): Japanese for a mountain pass, and the street racing that grew up on them. Always written
`KANJO`, all caps, with the macron. In code and URLs it's `kanjo`.

**Promise.** Night roads, real cars, your own build. It should feel like the garage you'd want at 2 a.m. before a
run down the mountain: dark, warm with neon, a little dangerous, never cluttered.

**Logo.** Two parts, always together in the top bar:

- the **hanko mark**: the kanji 峠 in white on a vermilion (`--tg-red`) square, like a signature stamp, slightly
  rotated (-4°);
- the **wordmark**: `KANJO` in Barlow Condensed 800 italic, wide tracking (0.18em), white.

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
│ ◀  [峠] KANJO  LB  RACE  GARAGE  PERFORMANCE  STYLE  DRIVER  FRIENDS  SETTINGS  RB  $57,500 ◉ │
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

Six top tabs; a tab with more than one page shows sub-tabs at the top of the rail.

| Tab | Pages | What lives there |
| --- | --- | --- |
| **Race** | Race · Battle pass | Race (the landing page, 2026-11-15, Michael: "much better like Fortnite"): no rail. Your car and driver stand in the middle of the window (the showroom) and the cards sit round them: bottom left the Battle pass card (`.tg-hc-pass`: tier, XP bar, next reward; opens the Battle pass page), top right the Leaderboard card (`.tg-hc-lb`, with the red unseen-notices badge; opens the Leaderboard modal) and your races / wins / win rate, bottom right the car card, bottom centre the one red action, *Host a race*, with *or join with a code* and *Join* under it. Under 900 px it stacks under the showroom strip, Host first. The open-races list is gone (join with a code). Earlier the page was only *Host a race*, *or*, a four-letter code and *Join*, with the open races under them. Solo races, the solo time trial, Grand Prix and battle royale starts, the track grid and the rivals / CPU / Physics pills are gone from the page; every mode and track is picked in the lobby. Leaderboard (leaderboardui.ts `leaderboardModal`, a large modal over the landing, `.tg-lbm`: every track and its record down the left, the open track's hero, your standing, its board and the medal table on the right; Esc, Close or a click outside shuts it): a track's hero with its record, where you stand; its all-time board (one time per account, top 50: yours lit cyan with a You tag, friends tagged, the record holder's row gets a red tick); every track with its record holder to switch boards. Michael asked for it (2026-11-05). |
| **Race → Battle pass** | (second Race page; sub-tabs Race / Battle pass show only here) | passui.ts: the season hero (tier, cyan XP bar, the red Buy the pass with its gold price, or a Pass owned tag), the open reward's card (`.tg-pass-detail`, edged in its rarity) with what you can do with it, Home and Title pickers once owned, then the 50-tier track (`.tg-pass-tile`: ✓ unlocked, gold PASS when reached without the pass, a lock ahead). Picking a tile previews it on the showroom (car item tried on, the stage put up, your own driver walked in wearing the piece). The top bar's tier chip (`.tg-passchip`) opens it. Michael asked for it (2026-11-06). |
| **Garage** | My cars · Upgrades · Tuning · Dealer | Your cars (drive, sell) and driver stats; the upgrade crates per part and the tuning sliders (the old Performance tab, merged 2026-11-15); buying new cars. |
| **Style** | Paint · Locker · Driver | Free paint/wheels/body/glass and trim (cars only for the body and glass options); cosmetics you own (equip, try on, plates); your driver (riderui.ts, the old Driver tab): four cards (`.tg-driver`, each in the driver's glow colour `--c`), free to switch, the showroom walks in to the driver and the card gives their nickname and story. Cases are sold in the Shop now. |
| **Shop** | (one page) | shopui.ts + shop.css (2026-11-15, Michael: "a beautiful UI with cards ... like a professional AAA video game"): no rail and no car card, the page takes the full width over the dimmed showroom (`.tg-shopmode`). The Battle pass is the hero (`.sh-hero`: the season name, tier and XP bar, the next four rewards, the red *Get the pass* with its gold price, All rewards); under it a card per cosmetic case (`.sh-card`, in the case's colour `--c`: crate, blurb, odds, how many you've collected, *What's inside* in a modal, the red *Open* with its price; the Legend and Vanta cases carry a flag), then the Mystery upgrade crate and the Dealer. Opening a case runs the same reel as before. |
| **Social** | Friends · Clubs | Friends (the old Friends tab): add a friend by username, your friends (Mutual tag when they added you back), "Added you" with Add back, your best time per track. Opening a friend (friendsui.ts) shows their record, their garage (View puts a car on the turntable, their driver beside it, the card ribbon says whose garage it is) and their best times beside yours with the gap (green you're quicker, red slower). Signed in only; guests get a sign-in card and their own times. Michael asked for it (2026-11-03). Clubs (friendsui.ts `clubsTab`, 2026-11-15, Michael: "a Club where you can add your friends to clubs"): start a club by name, a card per club (`.tg-club`) with its members; the owner adds friends from a pick list and removes members or disbands, a member leaves (those three press twice). Up to 5 clubs each, 30 members, only friends can be added (`/api/clubs`, src/shared/clubs.ts). |
| **Settings** | (one page) | Device settings (settingsui.ts), saved in this browser: Graphics High / Low as two option cards (`.tg-gfx`). Michael asked for it as its own tab (2026-11-02). |

Page ids (`dtab` in history, `Page` in hub.ts) are `race`, `pass`, `garage`, `dealer`, `upgrades`, `tuning`, `paint`,
`locker`, `driver`, `shop`, `friends`, `clubs`, `settings` (`cases` became `shop`; a saved `cases` opens it). Keep them stable: they're restored on reload.

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
| Random tile | `.tg-track.tg-track-random` | First tile in the lobby's track grid (host only): a dark striped tile with a die. Pressing it rolls one of the mode's other tracks; it's never shown as selected. Michael asked for it (2026-11-11). |
| Modal | `.tg-modal` + `[data-nav-scope]` | Reels and confirmations. Esc / B closes when it's safe. |
| Cup card | `.tg-cups` > `.tg-cup` (trackart.ts `cupCard`) | A Grand Prix cup: an inset stripe and name in the cup's colour (`--cup`, from CUPS), its line and total km, then its rounds in order as little theme-sky strips (number, map, name). A five-round cup (the Postcard Cup) is `.wide`: two grid columns where the screen has room, so its names fit. On the Race page it's a button that starts the cup; in a Grand Prix lobby it's the host's pick (cyan frame), with the round under way framed cyan and those raced dimmed. |
| Cup table | `.rh-cup` (race.css, hud.ts `cupHtml`) | Under a Grand Prix round's results, topped by a rule in the cup's colour: the cup name in its colour and "After round n of 4" / "Final standings", then place, racer, a chip per round (gold / silver / bronze for a podium, dashed for rounds to come), +points this round in cyan and the total in gold. After the last round a banner in the cup's colour (`.rh-cup-win`) with your trophy (`trophySvg`: gold, silver, bronze) when you made the podium. Online a line under it counts down to the next round. |
| Team cards | `.rh-teams` > `.rh-team` (race.css, hud.ts `teamsHtml`) | A Team Grand Prix's cup table opens with Red and Blue side by side instead of the podium banner: each a card edged and washed in the team's colour, its name in the team colour (yours says "your team" and is outlined), the total in big numbers and +points this round in cyan; the leader first. After the last round the winner's card carries the gold trophy and the line over them says who won the cup. |
| Lap counter | `.tg-laps` (hub.css) | Lobby, Endurance: − and + step pills either side of a big typed number ("10 laps"), the race distance beside it in dim type, and a row of quick-pick pills (1 / 5 / 10 / 25 / 50 / 100 laps, the current one pressed cyan). Guests see it disabled. |
| Team chip | `.tg-team` (hub.css) | Lobby, Team Grand Prix: Red (`#ff3b30`) or Blue (`#38c9ff`) after a racer's name, its grid row edged in that colour. On your own row (and, for the host, a CPU racer's) it's a button with ⇄ that switches sides, between cups. |
| Mode card | `.tg-modes` > `.tg-mode` | The lobby's big choices: mode (Race, Time trial, Hill climb, Grand Prix, Team Grand Prix (a Grand Prix, Red against Blue), Free roam: the Kanjo open world, no CPU racers or Record ghost, its start line says friends can drive in any time; while it's on, someone who joins goes straight in; Battle royale: its arena, no Record ghost), Physics (the car rule and the Record ghost options are gone: cars are always your own and the Record ghost is always on, with a `.tg-ghost-note` under Physics naming whose run it is, or that the track has none yet; 2026-11-15, Michael). Name + one-line blurb; selected = cyan frame. The track grid under it shows only the tracks the mode runs (a Hill climb: its mountain); a Grand Prix shows the cup cards instead, and no Record ghost. |
| Crew | `.tg-crew` > `.tg-crew-m` | The lobby's racers, each their car with their driver standing in front of it (riderportrait.ts `racerPortrait`) on a lit floor, name and car under each; yours is gold. Wraps past two racers. |
| Option card | `.tg-gfx` > `.tg-gfx-opt` | A big either/or with a list of what each choice means (Settings → Graphics). Picked = cyan frame + `aria-pressed`. |
| Friend row | `.tg-friends` > `.tg-friend` | Initial in a ring (`.tg-friend-av`), name in the italic display face, a tag, pill actions. Remove takes two presses, like selling. |
| Times table | `.tg-times` | Track (name + kind and length) then times in tabular numbers with a small line under each (the car, the date, or the gap: `.good` / `.bad`). |
| New best | `.rh-pb` (race.css) | Gold tag before a finish time on the results: "New best −0.532", then `.rh-rank` (cyan outline, "#4") when it's on the all-time board. |
| Track record | `.rh-record`, `.rh-tr` (race.css) | A new all-time record: a red banner over the results (the speed-cut "Track record" tag, the racer, the time, the gap on the old record and whose it was) and a red tag on their row in place of New best. |
| Best Moment | `.rh-replay` (race.css, racegame.ts `bestMoment`) | The winner's 10 s replay before the results: ink letterbox bars slide in, a pulsing red REPLAY dot top right, bottom left "Winner" (dim label) and their name in italic, the "Best Moment" title in the red-to-orange primary gradient on a speed-cut slab, the moment's line on an ink chip ("Drift · 38° at 132 km/h"), a cyan progress bar that runs the replay's length, and a ghost Skip button (cyan on focus). Everything else on the HUD is hidden meanwhile. |
| Board | `.tg-lb` (a `.tg-times`) + `.tg-lb-tracks` > `.tg-lb-track` | The Leaderboard page: position, racer (car + date under), You / Friend tag, time with the gap to the record under. Track buttons give the record and its holder; the open one has the cyan frame. |
| Medal table | `.tg-medals` (a `.tg-times`) + `.tg-medal` `.g` / `.s` / `.b` | Leaderboard → Overall, above the track's board: place (ties share it), racer (total medals under), You / Friend tag, then a domed disc per medal in the podium colours (gold `#ffc940`, silver `#d9e1ec`, bronze `#d08a4a`, as the cup trophies) holding the count; none is a faint ring. Top 10, plus your row after a dashed rule. |
| Times beaten | `.tg-notices` > `.tg-notice`, popup `.tg-notice-pop` | Someone beat your time. On the Leaderboard, a card with a red edge at the top: a red speed-cut tag (Beaten, or Record lost), who beat which of your times on which track with what, your place now and before, how long ago; each line opens that track's board; Got it clears them. When a new one arrives the garage pops a glass card in the top right (the same tag, the line, View) for 9 s. |
| Badge | `.tg-badge` | A red count pill after a sub-tab's label (the Leaderboard's unseen times beaten). |
| Player card | `.tg-pcard` (modal) | Your name top right opens it (on a phone, the icon). A trading card drawn on one canvas (playercard.ts) in these tokens: hanko + wordmark, your car and driver under neon, name, the car's class badge, three big numbers (wins, win rate, races), six small ones and personal bests, the kerb and "Own the pass." at the foot. Tilts toward the pointer with a sheen. Download PNG is the red action; Share (where the browser shares files), Account / Sign in, Close. |
| Account | `.tg-account` (src/client/menu/account.css) | Sign in / Create account, or Sign out and Change password. One ink card centred on the ink background: back circle and logo, a display heading, a dim lede, cyan pills for the two modes, inputs on `--tg-ink-2` with a cyan focus ring, the red `tg-go` as the one action (Sign out is the quiet `alt`). Errors in `--tg-bad`. |
| Lobby leaderboard | `.tg-lobby-lb` (a `.tg-lb`) | Under the lobby's track hero (leaderboardui.ts `lobbyBoard`): the picked track's all-time top 5, your row after a dashed rule when you're further down, a Here tag on racers in the lobby, and a line pointing to Race → Leaderboard for the rest. In a race or Grand Prix lobby a note says the mode doesn't set times. Follows the host's track; not in free roam. Michael asked for it (2026-11-12). |
| Your car (lobby) | `.tg-mycar` | The lobby's card for the car you'll line up in: a stripe of your paint down the left, maker and drive, name, class badge, hp · kg · paint, then ‹ n / N › to switch between your cars right there (no Edit car: the garage is no longer opened over the lobby). |
| Face | `.tg-face` | A racer's head cropped from their portrait, ringed in their car's paint. Grid rows. |
| Landing card | `.tg-hc` (a `button` for the Battle pass and Leaderboard cards) | Glass card with a red tick top left; `.tg-hc-eyebrow`, `.tg-hc-row`, `.tg-hc-copy`. Hover edges it cyan (name the hover background: the old site's `button:hover` paints buttons cream). |
| Leaderboard modal | `.tg-lbm` in `.tg-modal` | See Race above. |
| Tier chip | `.tg-passchip` | Top bar, left of the wallet: your battle pass tier in a cyan square and a thin XP bar (the bar hides under 1560 px). Opens Race → Battle pass. |
| Pass tile | `.tg-pass-tile` (in `.tg-pass-track`) | A tier: number top left, the reward's art (`.cz-art`), name and kind, state top right; top edge in the reward's colour (rarity, gold for money, the stage's neon). Picked = cyan frame. |
| Locked pill | `.tg-pill.tg-locked` | A battle pass piece in the creator you haven't unlocked: dashed, disabled, "Tier n" in gold. |
| Loading screen | `.tg-loader` (loading.css) | Shown while a race builds (loading.ts, called from `drive()` in src/client/main.ts). Full bleed: the track theme's sky and painted backdrop rolling slowly forward under an ink shade, logo top left, the run ("Solo · 5 rivals", "Online race · 4 racers · Physics") as a glass chip top right, then the track's kind and length, its name huge, its tag and the kerb; the track map draws itself on the right in the theme accent. At the foot a cyan Tip, an indeterminate cyan sweep and "Own the pass.". Stays up at least 1.1 s, fades in 0.6 s. Tips live in loadingcopy.ts: one line, house voice, true to the game. |

## 8. Motion

- Fast and directional: 160-240 ms, `cubic-bezier(.2,.8,.2,1)`. Page content slides in 12 px from the left as it
  appears; the hero fades up.
- Reels and reveals are the only long animations (4-5 s) besides the loading screen's slow backdrop roll, and they're skippable by Esc / B when finished.
- Respect `prefers-reduced-motion`: no slides, reels jump straight to the result (cosmeticsui.ts already does).

## 9. Controllers, keyboard and accessibility

- Every interactive thing is a real `<button>` / `<input>`; the pad's spatial navigation (src/client/pad.ts) walks
  them by position, so keep layouts on a clear grid.
- Focus is a **3 px cyan ring with a glow**, bigger in pad mode (`html.pad`). Never remove it.
- **LB / RB** walk the pages in order (Race → Battle pass → My cars → Upgrades → Tuning → Dealer → Paint → Locker → Driver → Shop → Friends → Clubs → Settings); the
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
