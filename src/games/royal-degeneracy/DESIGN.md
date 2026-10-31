# Royal Degeneracy: design and build plan

Status: steps 1–4 of the build order are built; step 5 (the cast) is next. The cast is in [CAST.md](CAST.md), the floorplans are in
`floorplans/`, and the house is read off them in [CLAUDE.md](CLAUDE.md), which also says where to start. The guests
come later.

## The pitch

A first-person 3D social-deduction party game set in a copy of 282, our old university house, at real scale. You walk
the actual hallways, up the actual stairs, into the actual bedrooms. 4–12 friends play versions of the housemates,
and current friends play themselves as the house's guests. Something terrible has happened: Donal's drumset is in
pieces, or the sink is a biohazard, or someone didn't flush. One or two of the players did it. They're the
**Degenerates**. Everyone else does chores, digs up clues and argues at house meetings, while the Degenerates
sabotage the house, plant fake evidence and quietly take out anyone who gets too close. Vote the culprits out
before the night ends.

Among Us gives the bones: hidden culprits, takeouts, meetings and votes. Three things make it its own game:

1. **It's first person.** You only see what's in front of you. Footsteps on the stairs behind you, a door clicking
   shut down the hall, a torch beam in a power cut: that's how you know someone's there. Doing a chore means
   turning your back on the room.
2. **The evidence is real.** Every crime leaves clues you pick up and turn over in your hands, each pointing at a
   trait of whoever did it: their drink, their shoes, their hair. Clues narrow the suspects like Guess Who, but the
   culprit can wipe clues and plant fake ones to frame someone else.
3. **Who you are matters.** Every character has an ability based on the real person. Mikol reads the router logs,
   JJ spots anything that's been planted, Xang goes Bongus and sees hidden clues glow through walls. You need each
   other, and the culprit has an ability too, and can lie about what it showed.

## A round: one night in the house

1. **Lobby** (a party room): pick your character from their card (stats, ability, quirk), with them turning on a
   stand; the host picks the case and settings.
2. **Cold open** (8 s): the case card ("THE DRUMSET MASSACRE. Donal's kit is in pieces. He's home at 4 am. One of
   you did this."), then your private role card: Housemate or Degenerate. Degenerates see each other.
3. **The night** (~10 min, a clock on your phone): housemates wake up in their own bedrooms, guests on the sofa.
   Everyone roams: chores, searching, abilities. The Degenerates commit crimes.
4. **House meetings**: someone reports a body or rings the meeting bell, and everyone is sat down on the
   living-room sofas, facing each other. Discuss (60 s), vote (30 s). The most-voted player is **evicted**: marched
   out the front door into the rain with a bin bag of their stuff. Skipping is allowed; a tie evicts nobody.
5. **The Last Meeting**: at the case's deadline a final meeting is forced (Donal's taxi pulls up). If a Degenerate
   is still in the house after that vote, the Degenerates win.
6. **Case closed** (~30 s): everyone ends up in Wags's room with a record spinning, like after a real night out.
   The culprit's mugshot, a replay of their takeouts seen from above, a timeline of everything they did, the
   night's awards. Back to the lobby, where the host presses "Next night".

A night runs 8–12 minutes, and a session is as many nights as you like.

### A night, played out

> **The Drumset Massacre**. Six of the housemates are in tonight: Dev, Mikol, Xang, Wags, Will and JJ. One
> Degenerate. You're Dev, and you smashed the kit before the night began.
>
> 1. Everyone piles into Donal's room. Xang goes Bongus and spots something glowing under the bed: **an engineering
>    problem set**. Three of you study engineering, you included. He photographs it to the group chat.
> 2. Mikol heads upstairs for the router. You crouch up the stairs behind him so he can't hear you, shut the
>    bathroom door, and take him out. The game leaves **a neat stack of coasters** by the body, because your room is
>    tidy. Only you and Wags keep a tidy room, so you spend a plant: **a cigarette butt**. Out through the bathroom
>    window onto the kitchen roof.
> 3. Will opens the bathroom door and finds the body. At the meeting the board shows the coasters and the cigarette
>    butt: only Wags fits both. "I'm not mad, I'm just disappointed." He's evicted. "Wags was not a Degenerate."
> 4. JJ stands in the bathroom for three seconds and runs his Inspection: the cigarette butt sparkles. **Planted.**
>    Worse for you, someone finally notices that Wags doesn't study engineering, so he never fitted the drumset clue
>    either. Engineering and a tidy room: that's you, and only you. You have four minutes until the Last Meeting to
>    take out JJ, or to convince the house that he's the one lying.

## Sides and how they win

| Side | Wins when |
| --- | --- |
| Housemates (guests included) | every Degenerate is evicted, **or** the chore list is done ("the house passes inspection") |
| Degenerates | they equal the living housemates, **or** a crisis sabotage isn't fixed in time, **or** one of them survives the Last Meeting |

Degenerates per night: 1 for 4–6 players, 2 for 7–10, 3 for 11–12. The host can change it.

The chore win matters: it stops the Degenerates from simply stalling, and it gives the dead something to do.

**Ghosts.** Taken-out and evicted players become ghosts: they float through walls and floors in a washed-out view
(Space up, crouch down). Housemate ghosts still do chores, so the chore win stays in reach. Every 30 s a ghost can
**rattle** something: a mug falls, a door creaks, a noise the living hear and may go and check. Degenerate ghosts
rattle too, to mislead, and can still sabotage. The honour rule from Among Us applies: ghosts don't talk on voice.

## Free roam: the house and each other

Everyone moves freely and at the same time. The only limits are walls, shut doors and your own field of view.
During a meeting nobody walks: everyone stays on the sofas until the vote is over.

**Things in the house** (everyone): doors (open, shut, peek round), chores, search spots (bins, under beds, sofa
cushions, cupboards), clues, the gadgets (router, Ring cam laptop, fuse box, stopcock, meeting bell, fridge board),
and your phone and torch at any time.

**Other players:**

- Everyone: see and hear each other, emote, point, report a body, pair up on two-person chores, use abilities that
  target a person (Wags guarding someone, Jung's Proof), and the playful touches below.
- Degenerates only: take someone out, drag and hide a body, climb through the sneak routes.
- Ghosts: float through walls and do chores, but can't touch the living or most of the house; they can only rattle
  things.

**Nobody blocks anybody.** Players pass through each other, with a soft nudge apart when they overlap, as in Among
Us. A real house has narrow halls and doorways, and solid bodies would let one person block the bathroom door or trap
someone on the stairs. It also suits the netcode: each player moves themselves, so solid bodies would jitter. Each
client nudges only its own player out of the overlap, gently, so nobody gets shoved into a wall. Bodies on the floor
don't block either. A door won't swing shut on someone standing in the doorway.

**Playful touches** (no effect on who wins; they're there for the laughs):

- **Shove**: a little push at whoever's in your crosshair within 1.5 m. They stagger about half a metre (never
  through a wall) with a "oof". A 3 s cooldown keeps it from becoming a weapon, and you can't shove someone who's in
  the middle of a chore.
- **High-five** and **hug**: offer one from the emote wheel at whoever you're looking at; it lands if they offer it
  back at you within 3 s, with a slap or a squeeze and a little burst. Left hanging, your hand just stays up there.
  A hug from the Degenerate is still a hug.

## The mystery layer

### Trait cards

Every character has a **trait card** with a value in each of eight categories, all real facts about the person
(everyone's are in [CAST.md](CAST.md)):

| Category | Values | How it turns up as a clue |
| --- | --- | --- |
| Notes | engineering, computing, teaching, commerce, science | a problem set, a code printout, a lesson plan, a case-study handout, a lab report |
| Smoke | weed, cigarettes, none | a roach, a grinder or the smell; a cigarette butt (only Wags smokes them, and nobody will believe it) |
| Temper | short fuse, calm | a fist-sized dent in the drywall, a furious sticky note |
| Room | spotless, tidy, messy, chaos (the regulars' own place; "the couch" for guests) | something from their room: a folded hand towel, a stack of coasters, a crumpled hoodie, a sock that stands up on its own |
| Drinking | heavy, light (from the Booze rating) | a pile of empties; one warm, half-finished can |
| Footprint | big, medium, small (from height) | a footprint |
| Hair colour | brown, black, red | a hair |
| Hair length | short, medium, long | a hair in the plughole, a hairbrush |

Some values leave no trace ("none" for Smoke, "calm" for Temper): the referee never draws that category for
someone it can't show, though a plant still can. Most values are shared, so one clue is never enough and three or
four usually are. A few belong to one person alone (only Wags smokes cigarettes, only Selby has red hair): those
narrow hardest, so the referee saves them for later in the night.

Everyone also has a **signature belonging** (Xang's labelled rock sample, Will's party wristbands, ...). It's one
person's alone, rare as a real clue, and the Degenerates' favourite thing to plant.

Tests check that every trait card is unique, so a full set of real clues always singles out the culprit, and that
no two categories split the cast the same way, which would make one of them pointless. All ten main characters'
cards pass both today.

### Crimes leave clues

Every crime spawns clues: the case's opening crime leaves 2–3 at the scene, each takeout 1–2 on and around the
body, and some sabotages one at the panel. Each clue shows one **true** trait of whoever committed that crime, and
is tagged with the crime it came from. The referee picks categories so early clues narrow the field a little and
later ones a lot.

Clues are physical things in the house:

- **On view**: lying at the scene (a footprint in the spilled beer). Look at it and press Use to **inspect**: it
  floats in front of you and you turn it with the mouse or stick. Some only give themselves away from one side
  (the order is printed on the back of the receipt).
- **Hidden**: in a search spot near the scene (the bin, under the bed, the sofa cushions, the bathroom cabinet).
  Hold Use for 2 s to search. The Degenerate isn't told where their hidden clues landed, so they can never fully
  clean up.
- **Dug up by chores**: some chores in the scene's room turn one up (unblocking the shower drain finds a hair).
- **Locked**: a phone with a passcode, a locked bedroom, a knotted bin bag. Anyone can open one with a slow fiddle
  (30–40 s). JJ's spare keys open doors and bags in 2 s, and Mikol gets into phones in 2 s. A locked clue shows
  who opens it fast.

When you inspect a clue, only you learn what it says, and it goes into your phone's **Case File**. Press **Photo**
to post it to the house group chat: then everyone sees it, with your name on it. A photo always shows what the
object really says. You can also keep quiet about a find, or lie about it out loud.

### Plants and wipes

- **Plant** (3 per Degenerate per night): drop a fake clue showing a trait value you choose. Pick values to frame
  someone. A plant looks exactly like a real clue.
- **Wipe**: destroy a clue that's on view (hold 3 s; anyone who walks in sees you crouched over it).
- Plants are exposed by JJ's Inspection, by Jung's Proof (which only counts real clues), or by logic: a plant's
  value is false, so it contradicts the other clues from the same crime.

### Your phone

Your phone is your one tool, and you can see it in your hand:

- **Torch** (T): a real light. In a power cut it's all you've got.
- **Camera**: photographs a clue you're inspecting to the group chat. Flip it round and it's a selfie, which is
  one of the few ways you see your own character.
- **Group chat**: everyone's clue photos, house announcements, and the case's texts (Donal, getting angrier).
- **Case File** and **Suspect Board** (Tab): Guess Who for the house. A grid of everyone in the night × the six
  categories, with every posted clue marked against the people it fits, grouped by crime. You cross people out
  yourself; the game never does it for you, because plants exist. It makes the deduction readable for people who
  don't do logic puzzles.

While your phone is up you look down at it, and others see you doing it. Reading the board in a dark hallway is a
risk.

### The fridge

The fridge door in the kitchen is the physical case board: posted clues appear on it as Polaroids and sticky notes,
and the night's crimes as a magnet list. It's where people gather to argue.

## The cast and their abilities

The eight housemates and two **regulars** (Nash and Shota, who didn't live at 282 but were always there) are
drafted in [CAST.md](CAST.md): who they are, their character cards, trait cards, abilities, signature belongings
and lines. The regulars have no bedroom: Nash wakes up on the sofa with a controller, Shota in Mikol's room. A party
room holds 12, so the rest of a full lobby are friends who join as **guests**. Guests wake up on the sofa, their
room trait is "the couch", and they get abilities from the pool below once their sheets are in.

Characters are data (`cast.ts`): name tag, look, height, card stats, trait card, bedroom, ability, quirk, signature
belonging, catchphrase and a handful of lines (speech bubbles when they greet someone, at meetings, on finding a
body, when evicted). The housemates wake up in their real bedrooms. Your eye height is your character's real height:
Wags (190 cm) sees over the fridge, Will Palmer (165 cm) looks up at everyone.

Each character has one **active** ability (a cooldown, or a few uses a night) and one passive **quirk**. Both sides
use them. Results come to you privately, and sharing them is up to you, which is what makes them worth arguing
about. Rules for designing them:

- An ability helps; it never decides a night alone. No night needs a particular character to be solvable: locked
  clues have a slow fallback, and two-person jobs take any two people.
- Feeling like *them* beats balanced-on-paper. Tune the numbers, keep the joke.

### The housemates

| | Ability | Quirk |
| --- | --- | --- |
| **Dev** | **Toboggan Run**: rides the team's concrete toboggan down a staircase or along a hall at 3× walking speed. Loud | **Engineer**: fixes sabotages twice as fast |
| **Mikol** | **Router Logs**: at the router, which room every phone was in over the last 90 s. Gets into locked phones in 2 s | **Unbothered**: the fire alarm and the bathroom gross-out don't touch him |
| **Jung** | **Proof**: pick a player and a crime: "consistent" or "contradiction" against that crime's real posted clues. Plants can't fool it | **Illogical!**: his phone buzzes the moment two posted clues from one crime can't both be true |
| **Xang** | **Bongus Mode**: one huge rip; for 15 s his tag reads BONGUS, he walks slower, the world goes hazy, and hidden clues within 6 m glow through walls | **Rock Hound**: searches twice as fast |
| **Selby** | **Bike Stu Session**: two randoms from his studio wander the house for 45 s; if one sees a crime, Selby gets a text with one trait of whoever did it | **Dire**: fixes a crisis sabotage alone |
| **Wags** | **Look Out**: guards a friend for 30 s: they can't be taken out, and he's told if someone tries | **Worrier**: a crime on his floor buzzes his phone, with an arrow to it for 3 s |
| **Will Palmer** | **Campus Legend**: once a night at a meeting, his vote counts double | **Supervisor**: his own chores are slow, but anyone working within 3 m of him works 50% faster |
| **JJ** | **Inspection**: stands in a room for 3 s: anything moved or planted in it sparkles | **Spare Keys**: opens locked doors and locked clues in 2 s |
| **Nash** (regular) | **Wallhack**: for 3 s, everyone within 8 m shows as an outline through walls and floors | **Couch Lock**: on the living-room sofa, he hears every footstep in the house at full volume |
| **Shota** (regular) | **Ruck**: bursts through a locked door; lifts two-person chores on his own | **Always Down**: anyone can ping him from their phone, and he gets an arrow to them |

Teamwork is built in:

- Information chains across people: Router Logs says who was upstairs, Bongus Mode finds the hidden clue, Jung's
  Proof checks a suspect against it, JJ's Inspection says whether that cigarette butt was ever real.
- Some people make others better: Will speeds up whoever works next to him, Wags keeps someone alive, JJ and Shota
  open what others can't, and anyone can call Shota over. In first person, whoever stands behind you while you work
  is either your bodyguard or your killer.
- Locked clues and two-person chores ("carry the sofa", "flip the mattress") push people into pairs, and the worst
  sabotage (the toilet flood) needs two people at two places at once, unless Selby decides it's dire.

### Tells

Some characters give themselves away and can't switch it off:

- **Will Palmer's cologne**: every room he's been in smells of it for 20 s after he leaves. Stand still for 2 s to
  sniff, and you'll know he was just there.
- **Shota overheats**: once a night, at a random moment, he gets too hot and takes his shirt off, and it drops
  wherever he's standing. A shirt on the floor says Shota came through, and it might be the one next to a body.
- **Wags's cigarettes**: the only cigarette smoker, so a butt at a crime scene points straight at him. Nobody will
  believe it, and the Degenerates know that.

### Others in the house

- **Donal**: never seen until the deadline of his case; he texts the group chat all night.
- **The raccoon**: lives on the covered balcony outside Selby's room. Now and then it gets in. It knocks things over
  (noises that sound a lot like a crime), raids the bins, and can run off with a clue that's on view and stash it on
  the balcony, where a search finds it. Anyone can shoo it out.
- **Bike Stu randoms**: strangers from Selby's studio, out only during his ability. Nobody else knows who they are,
  which is accurate.

### Abilities for the guests

The pool for friends who join as guests (or I'll invent one that fits them better):

| Ability | What it does |
| --- | --- |
| Swab | Check one clue: real or planted. 2 a night |
| Eavesdrop | Ear to a wall or door: everyone in the next room shows as a silhouette through it, with names, for 5 s |
| Spill the Tea | Once a night: one true fact from the night's log ("X was in the bathroom at 1:12") |
| Aux Cord | Blast music in a room for 10 s: everyone in it shows through walls, to the whole house |
| Night Owl | Sees in the dark in a power cut; footprints glow for 5 s after a crime |
| Taste Test | Food and drink clues show two traits instead of one |
| Objection! | Once a night at a meeting: void the vote and run it again |
| Sleepwalk | Lie on the sofa and drift out of your body through walls for 8 s; your body stays there, defenceless |

## The Degenerate's toolkit

Every Degenerate action except walking and lying is a crime, and crimes leave clues.

- **Take out** (30 s cooldown): look at someone within 1.5 m and click. A slapstick bonk; they slump X_X where they
  stood, with a chalk outline. From behind, they never see who it was. The body is a crime scene. The weapon fits
  the case: a drumstick, a frying pan, a plunger.
- **Hide the body**: drag it a few metres and stuff it in a wardrobe or the wheelie bin (4 s). Searching that spot
  finds it.
- **Plant** and **wipe** (above).
- **Sneak routes**, the house's vents: certain windows and hatches only Degenerates can climb through (say,
  bathroom window → kitchen roof → back garden; the attic hatch; the back door → side passage → front door).
  Others see a curtain twitch and hear it. Which ones exist depends on the real house.
- **Sabotage** (one at a time, shared cooldown):

| Sabotage | Effect | Fix |
| --- | --- | --- |
| Power cut | every light in the house goes out; phone torches only | flip the trip switch at the fuse box |
| Toilet flood (crisis) | water spreading over the floor; 45 s or the Degenerates win | plunge the toilet and shut the stopcock at the same time (two people, or Selby alone) |
| WiFi down | no photos to the group chat, no router logs, no Ring cam | reboot the router (hold 5 s, then a 10 s wait) |
| Fire alarm | a piercing noise that drowns out footsteps; no meetings can be called | wave a tea towel under the detector |
| Lock doors | one floor's bedroom doors lock for 12 s | JJ's Spare Keys, Shota's Ruck, or wait |

Anyone can **crouch** to walk slower and silently. Everyone uses it; the Degenerate needs it.

### House gadgets

The Among Us admin table and cameras, as things a student house actually has:

- **The router**: where Router Logs is used and WiFi is fixed.
- **The Ring cam**: the laptop on the living-room table shows the front door and hall live, on its actual screen.
  Anyone can stand and watch it; a red light on the doorbell tells people someone is.
- **The meeting bell**: a pot and a wooden spoon (where depends on the house). One ring per player per night.
- **The fuse box** and **the stopcock**: sabotage fixes.
- **The fridge**: the case board.

## Meetings and evictions

- Called by reporting a body or ringing the bell.
- Everyone is sat on the sofas and bean bags around the coffee table, still in first person, so you're looking at
  each other. Heads turn where players look, and you can **point** at whoever is in your crosshair, which is how
  accusations look across a room. A chat panel serves anyone not on voice.
- The vote is a grid of portrait buttons (mouse, keyboard or pad), plus pointing for show.
- The evicted player is marched out the front door with a bin bag. "They were (not) a Degenerate." Whether that is
  revealed is a host setting.

## Chores

You walk up to the chore, press Use, and the view moves in close while a short (5–15 s) minigame plays on top:
mouse, keyboard or pad. While you're in a chore you can't look around, so you listen. Every chore fills the
inspection bar, and some dig up clues. A starting list, to be replaced with the real house's chores once I've seen
the photos:

- scrub the pan (circles), wash up a stack, plunge the toilet (rhythm), unblock the shower drain (pull out the
  hair: a clue), find the remote in the sofa, defrost the freezer (chip the ice), hang the washing on the radiator,
  wipe the mould off the bathroom ceiling, sort the recycling, hoover the stairs
- walking chores: carry the bin bags out to the wheelie bins, take the empties to the recycling
- two-person chores: carry the sofa, flip the mattress

## The cases

A case is data: title, cold-open text, the crime scene (room, props, damage), where its clues spawn, a twist rule,
the takeout weapon, the deadline and the ending lines. New ones are cheap to add, and the best ones will be real
house stories.

1. **The Drumset Massacre.** Donal's kit is in pieces in his room. Twist: Donal texts the group chat as the night
   goes on, each text a small hint ("the Ring cam caught someone really short at the door at 11"), and they get
   angrier. At the deadline his taxi pulls up and the Last Meeting is him storming in. The weapon is a drumstick.
   Donal is an NPC, never playable.
2. **The Sink of Shame.** A tower of dishes. Twist: the pile grows (the Degenerate adds to it), and washing up is
   how you dig: each dish carries a takeaway clue. The weapon is a frying pan.
3. **The Unflushed.** Someone didn't flush, and worse, the floor. Twist: the bathroom is so foul you can only stay in
   it for 8 s at a time (gagging, a swimming view), so searching it is a relay. The weapon is a plunger.

More from the house's own stories (details in [CAST.md](CAST.md)): the Scratched Record (Wags's), the Sponsored
Stash (Will's free liquor, drunk), Who Let the Raccoon In, the Indoor Cigarette (everyone suspects Wags), the
Toboggan Job, the Missing Geode (Xang's), the Great Clean-Up (someone keeps undoing the chores) and the Rage Quit
(Nash's controller, through the telly). Plus the classics: the fridge thief, the 4 am fire alarm, the stranger
asleep on the couch.

## Making it a game you play for hours

- **Short nights, instant rematch.** 8–12 minutes, then "Next night" from the lobby. Roles reshuffle, clue spots
  and their contents change, cases rotate.
- **The reveal is the payoff.** The culprit's mugshot, each takeout replayed from above (everyone's movements are
  recorded through the night, like Gambol's killcam), and the timeline: "1:12 took out Mikol in the bathroom.
  1:13 planted a cigarette butt. 1:40 framed Wags at the fridge." People want to see how they were fooled.
- **Awards** every night, from the night's log: Sherlock (most real clues posted), Framed (evicted while innocent),
  Sus Magnet (most votes against), First Blood (taken out first, again), Chore Champion, Untouchable (a Degenerate
  nobody voted for).
- **Character cards**: in the lobby every character is a trading card with their stats (Brains, Chill, Bro, Green,
  Booze, Tidy), ability, quirk and a line.
- **Stats** kept in the browser: nights, wins per side, cases cracked, times evicted, favourite character.
- **Host settings**: case (random or pick), number of Degenerates, night length, takeout cooldown, discussion and
  vote times, reveal roles on eviction, anonymous votes, and **Cosy mode**: no takeouts, the Degenerates only
  sabotage, plant and lie. A pure whodunit for quieter nights.
- **Inside jokes are content.** Character lines, props, posters and cases from the real house are what make it ours.

## Look and feel

- **First person at real scale.** The house is built at its true size from the floorplan; your eye height comes
  from your character's height. Field of view 85° by default with a slider, a gentle head bob you can turn off,
  mouse sensitivity and stick speed in settings.
- **Sight is natural.** Walls, shut doors and your own field of view hide people; there's no map. Name tags float
  over heads but are hidden by walls like everything else, so they never give anyone away.
- **Sound is the radar.** Footsteps per floor surface (carpet, lino, the creaky stair), doors, flushes and the
  takeout thud are positioned in 3D and muffled through walls. Crouching is silent. The fire alarm drowns it all.
- **What you can use is lit up.** Look at anything you can use within 2 m and it glows, with the prompt under the
  crosshair ("E Search the bin").
- **Seeing yourself and your friends.** You don't see your own body in play, so: the lobby shows your character on
  a turning stand, the bathroom mirror reflects you, the phone does selfies, and meetings sit everyone face to face.
  An emote wheel (wave, point, shrug, facepalm, dance, high-five, hug) lets people talk with their bodies.
- **Characters**: stylised rather than tiny chibis: real heights, slightly big heads, soft toon shading,
  canvas-drawn faces (X_X when taken out). Built from the cast sheets and photos.
- **The house**: a warm, messy student house at night. Lamp light, fairy lights, cans, pizza boxes, laundry piles,
  the traffic cone. Procedural models and canvas textures; the photos are reference only and never go in the repo.
- **Tone**: silly. A takeout is a slapstick bonk, an eviction is a bin bag in the rain, and Donal's texts get
  angrier.

### Controls

| | Keyboard and mouse | Pad |
| --- | --- | --- |
| Move / look | WASD / mouse | left / right stick |
| Jump / crouch | Space / Ctrl | Ⓐ / Ⓑ |
| Use, search, inspect, chore, report (hold for search) | E | Ⓧ |
| Ability | Q | Ⓨ |
| Take out (Degenerates) | left click | RT |
| Sabotage, plant, wipe (Degenerates) | R (a wheel) | LB (a wheel) |
| Phone: Case File, Suspect Board, chat | Tab | View |
| Torch | T | D-pad up |
| Shove | V | right stick click |
| Emotes, high-five, hug | G (a wheel) | D-pad down |

Esc frees the mouse and opens the pause menu (Resume, Settings, Leave the house). The game catches Esc while it's
open, so a stray press never quits you out of a night; leaving is the Leave button.

## Tech plan

It follows the plug-in rules in `src/games/CLAUDE.md`: everything lives in this folder, `three` is the only library,
CSS is scoped under `.royal-degeneracy`, menus are real buttons, and the cleanup tears down every loop, listener,
renderer, pointer lock and party.

### Files

```
src/games/royal-degeneracy/
  channel.ts     the menu tile (banner: the house at night, windows lighting up, a silhouette passing) + mount
  game.ts        screens and the main loop: menu, lobby, night, meeting, reveal, pause
  house.ts       the house as data: floors, rooms, walls with door/window gaps, doors, stairs, furniture, spots
  cast.ts        the characters as data (from CAST.md): look, height, card stats, trait card, bedroom, ability,
                 quirk, signature belonging, lines
  cases.ts       the mysteries as data
  npcs.ts        pure: the raccoon and the Bike Stu randoms (run by the host, sent like poses)
  rules.ts       pure: roles, phases, the clock, cooldowns, votes, wins (the referee's logic)
  clues.ts       pure: trait clues, picking them per crime, plants, who matches what
  abilities.ts   pure: each ability's rule (range, uses, what it reveals)
  move.ts        pure: the first-person walker (walk, crouch, jump, stairs) on src/shared/collision.ts
  net.ts         message types and shape checks; the host referee and the client side
  input.ts       pointer lock, mouse, keys, pad; the pause menu's Esc handling
  world.ts       three.js: builds the house per room, lights, the Ring cam screen, the bathroom mirror
  props.ts       procedural furniture and clutter
  people.ts      procedural characters from cast.ts looks: walk, crouch, idle, sit, point, emotes, X_X, ghost
  phone.ts       the phone in your hand and its screens (torch, camera, chat, Case File, Suspect Board)
  textures.ts    canvas textures: carpet, lino, wallpaper, tiles, posters
  audio.ts       WebAudio synth sounds, positioned in 3D and muffled through walls
  chores.ts      the chore close-ups and minigames
  replay.ts      records everyone's poses through the night; the reveal's replays
  hud.ts, meeting.ts, royal.css
tests/royal-degeneracy.test.ts (rules, clues, abilities), tests/royal-degeneracy-house.test.ts (the house)
```

### Walking and the house

The house is traced from the floorplan, in metres. Per floor: rooms, walls as boxes with gaps (doors, windows,
arches), doors with ids and an open/shut state, stairs as ramps, furniture with a kind, and spots (chore, search,
hide, bell, fuse box, router, stopcock, Ring cam, sneak in/out, spawns). Real houses are almost all right angles, so
walls and furniture are axis-aligned boxes.

That matches what Gambol's `src/shared/collision.ts` already does: move-and-slide against boxes, walkable ramps
(the stairs), snapping to the ground, and ray casts (what's under your crosshair, what blocks a sound). `move.ts`
imports it as-is and adds a plain walker: no bhop, no air control. Shut doors are boxes that come and go, like the
Foundry's doors. Nothing in `src/shared` gets edited; if Gambol ever changes that file, our house test fails and
says so.

Tests: every room reaches every other on foot, every spot is reachable and inside its room, no furniture blocks a
doorway, spawns are clear, sneak routes connect, nobody walks through a wall or a shut door, the stairs change
floors, a shove never pushes anyone through a wall, and two overlapping players drift apart.

### Netcode on party rooms

The PartyRoom only relays, so the **host's browser is the referee** (the SNAP pattern):

- Each player sends their own pose (position, facing, where they look, crouching, phone up, torch on, emote) about
  15 times a second to everyone. That's well under the 60 messages/s limit. Others are drawn 100 ms in the past,
  interpolated.
- Everything else is a request to the host: `kill`, `search`, `inspect`, `post`, `plant`, `wipe`, `ability`,
  `sabotage`, `fix`, `chore`, `report`, `bell`, `vote`, `door`, `shove`, `greet` (high-five or hug). The host
  checks it (phase, range, cooldown, role), updates the night, and answers: public events to everyone (`body`,
  `meeting`, `posted`, `evicted`, `sabotage`, `door`, `shoved`, `greeted`), private ones to one player with `party.send(data, id)` (your role, what a clue says, what your ability
  showed).
- Secrets never go to everyone: roles, where hidden clues are, what each clue says, which clues are plants. Only the
  host holds them. Everyone sees that a clue object is there; only whoever inspects it learns what it says.
- Every incoming message is shape-checked before use (a `readMsg` like SNAP's). Names only ever go in with
  `textContent`.
- If the host leaves mid-night, the room promotes someone else, but the secrets left with the old host, so the
  night ends ("The host left: night's off") and everyone goes back to the lobby.
- The room closes to joiners during a night (`setOpen(false)`). A player who drops counts as taken out.
- A known shortcut: the host's browser knows everything, so a host with devtools could cheat. Fine among friends. If
  it ever matters, a small server room for this game would fix it, but that touches `src/server`, so it would need
  your go-ahead.

### Rendering and performance

- The static house is merged per material per room (a few draw calls a room), and rooms out of view are culled.
  Clutter is instanced.
- **Lighting without stalls.** Lamp light is baked into the house's vertex colours when it loads. On top of that is
  a fixed pool of four real point lights that follow the lamps nearest you, plus your phone torch as a spotlight
  that's always in the scene and just switches intensity. The number of lights never changes, so three.js never
  recompiles shaders mid-night (TŌGE's lesson). Other players' torches are faked with a glowing cone, not real
  lights.
- The Ring cam laptop and the bathroom mirror each render a second view, small and only while you're near them.
- Pixel ratio capped at 1.5, with a resolution slider. The target is smooth play on a laptop's integrated GPU with
  12 characters in the house.

## Build order

Each step ends in something playable, so we find out early whether it's fun.

1. **Channel and lobby**: the tile, host / join / list, character picks with the turning stand, host settings.
2. **Walk the house**: the floorplan as data, a greybox house in first person, walking, crouching, stairs, doors,
   torch, positional footsteps, other players walking around online with name tags, passing through each other
   with a nudge, shoves.
3. **The Among Us core**: roles, takeouts, bodies, reports, the bell, meetings on the sofas, votes, evictions,
   ghosts, four chores, every win condition. **Playtest with the group here before anything else.** If this isn't
   fun, clues won't save it.
4. **The mystery**: trait cards, clues from crimes, inspecting, search spots, the phone (Case File, photos, chat,
   Suspect Board), plants and wipes, the fridge, the reveal timeline. The first case: the Drumset Massacre.
5. **The cast**: the real characters' models, heights, trait cards, lines and abilities; locked clues; two-person
   chores; emotes, high-fives and hugs.
6. **The house comes alive**: sabotages, sneak routes, the gadgets, the Sink of Shame and the Unflushed, the rest of
   the chores, awards, stats, Cosy mode, the reveal replays.
7. **Art pass** from the photos: materials, clutter, baked lighting, the mirror, sound, the banner.
8. **Later**: touch controls for phones (harder in first person; Gambol's touch controls are the model), more
   cases, proximity voice chat (WebRTC signalled through party messages; it would suit first person brilliantly,
   but without a TURN server some connections fail, so it comes last).

## Starting numbers

| | |
| --- | --- |
| Players | 4–12 (best at 6–9) |
| Degenerates | 1 (4–6 players), 2 (7–10), 3 (11–12) |
| Night length | 10 min |
| Walking | 3.2 m/s, crouched 1.4 m/s (silent) |
| Reach | 2 m to use things, 1.5 m to take someone out, shove or greet |
| Shove | ~0.5 m stagger, 3 s cooldown |
| High-five / hug | the other player has 3 s to offer it back |
| Takeout | 30 s cooldown; none in the first 15 s of a night or 10 s after a meeting |
| Meeting | 60 s discussion, 30 s vote; one bell ring per player per night |
| Plants | 3 per Degenerate per night |
| Search / wipe / sniff | 2 s / 3 s / 2 s |
| Crisis timer | 45 s |
| Field of view | 85° (slider) |

## What I need from you

1. **A floorplan of each of the three levels** (on the way). A photo of a hand sketch is fine. Mark room names (whose bedroom), doors and which
   way they swing, windows, the stairs (which way they turn, roughly how many steps), ceiling heights if anything is
   odd (an attic, a sloped ceiling), and at least one real measurement ("the kitchen is about 4 m long") so I can
   scale it. Include the garden, yard, side passage and any shed. In first person, scale and proportions are what
   make it feel like the real place.
2. **Photos**: each room from a corner or two, the hall and stairs, the front and back outside, and the notable
   things (the drumset, the fridge, the sofa, the posters, the carpets). They're reference only: I'll recreate them
   in code and never copy them into the repo. Drop them in a folder outside the repo, or straight into the chat.
3. **The cast**: the housemates and regulars are drafted in [CAST.md](CAST.md); the questions at its end fill in
   what's missing. Friends who join as guests use the sheet below.
4. **House lore**: things that actually happened, running jokes, who always got blamed for what. These become cases,
   lines and props.
5. **Donal**: where his room was, where the drumset lived, and the kind of thing he'd text the group chat.

```
Name or nickname (shown in game):
Height (roughly, in cm):
Look: build, hair (style, colour), facial hair, glasses, skin tone,
      usual outfit, signature items (cap, headphones, chain, ...)
Personality in one sentence:
What they'd be doing in the house at 2 am:
Card stats out of 10: brains | chill | bro | green | booze | tidy
Trait card (overlaps between people are good):
  studies | smokes? | temper | go-to drink | shoes | hair
Something they'd leave lying around (their signature belonging):
Ability idea (optional; I'll match one if it's blank):
3–5 things they always say:
```

Since gambol.lol is public: first names or nicknames only, never the address or street name, and no photos in the
repo. CAST.md marks what stays out of the shipped game (partners' names, money). It's worth showing each
housemate their card before it ships.

## Risks

- **A real house is small.** First person helps a lot (you can't see behind you or round corners), and so do shut
  doors, the garden and the sounds. The walk test in step 2 tells us early whether it needs more space (say, the
  back garden opened up or a cellar).
- **Motion sickness and mixed gaming skill.** FOV slider, head bob off, controller support, and nothing in the game
  needs aim: the crosshair just picks what you're using.
- **Clues could turn it into a logic puzzle with no social game.** Plants, wipes, shared trait values and private
  finds keep it social. Tune in playtests: if it's solved too fast, fewer clues per crime; if it's hopeless, more.
- **Lighting cost.** Interiors at night live or die by their lighting; the baked-plus-light-pool approach keeps it
  cheap, and the art pass has to be checked on a weak laptop.
- **Host cheating and host leaving** are accepted for now (see Netcode).
- **Voice**: the game assumes you're on a call or in the same room; the meeting chat covers everyone else.
