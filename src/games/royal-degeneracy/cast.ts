// The characters as data (from CAST.md): the eight housemates, the two regulars, Gare (visiting) and the guest. Name tags only; the
// shipped game never carries anything CAST.md keeps back. Pure: no three.js, no DOM.

export const CHAR_IDS = ['dev', 'mikol', 'jung', 'xang', 'selby', 'wags', 'will', 'jj', 'nash', 'shota', 'gare', 'guest'] as const;
export type CharId = (typeof CHAR_IDS)[number];

type HairStyle = 'buzz' | 'short' | 'swept' | 'medium' | 'shaggy' | 'long' | 'verylong';

/** How people.ts draws them. Colours are CSS hex strings. */
export interface Look {
  skin: string;
  hair: string;
  style: HairStyle;
  shirt: string;
  /** A second colour on the shirt (stripe, logo, open shirt's tee). */
  trim: string;
  pants: string;
  shoes: string;
  /** Shoulder width relative to normal (Shota's rugby build is 1.15). */
  build: number;
  glasses?: boolean;
  hat?: 'toque' | 'cap';
  hatColour?: string;
}

/** The facts clues are made of (DESIGN.md "Trait cards"). */
export interface Traits {
  notes: 'engineering' | 'computing' | 'teaching' | 'commerce' | 'science' | 'trade';
  smoke: 'weed' | 'cigarettes' | 'none';
  temper: 'short fuse' | 'calm';
  room: 'spotless' | 'tidy' | 'messy' | 'chaos' | 'the couch';
  drinking: 'heavy' | 'light';
  footprint: 'big' | 'medium' | 'small';
  hairColour: 'brown' | 'black' | 'red';
  hairLength: 'short' | 'medium' | 'long';
}

export interface Character {
  id: CharId;
  tag: string;
  /** Real height in cm: it's also your eye height in first person. */
  height: number;
  blurb: string;
  studies: string;
  ability: { name: string; text: string };
  quirk: { name: string; text: string };
  catchphrase: string;
  /** Speech bubbles: meeting chatter, finding a body, being evicted. */
  lines: { meeting: string[]; body: string; evicted: string };
  /** Room id in house.ts where they wake up. */
  wake: string;
  traits: Traits;
  belonging: string;
  look: Look;
}

const SKIN = { fair: '#f2d2bc', light: '#e8c3a4', tan: '#d6a77f', warm: '#c99572' };

export const CAST: Record<CharId, Character> = {
  dev: {
    id: 'dev',
    tag: 'Dev',
    height: 185,
    blurb: 'Captain of the concrete toboggan. The tidy, chill one.',
    studies: 'Mechanical Engineering',
    ability: { name: 'Toboggan Run', text: 'Rides the concrete toboggan down a staircase or a hall at 3× walking speed. Loud.' },
    quirk: { name: 'Engineer', text: 'Fixes sabotages twice as fast.' },
    catchphrase: '*nods*',
    lines: {
      meeting: ['Captain’s orders: vote with your head.', 'My room’s clean, just saying.', 'I was on the stairs. Measuring them. For reasons.'],
      body: 'Oh no. Oh, that’s a lot of chalk.',
      evicted: 'You’ll regret this on race day.',
    },
    wake: 'dev',
    traits: { notes: 'engineering', smoke: 'none', temper: 'short fuse', room: 'tidy', drinking: 'light', footprint: 'big', hairColour: 'brown', hairLength: 'long' },
    belonging: 'a concrete toboggan team toque',
    look: { skin: SKIN.tan, hair: '#4a2f1c', style: 'shaggy', shirt: '#3d5a80', trim: '#e0e6ee', pants: '#2f3440', shoes: '#ece6da', build: 1 },
  },
  mikol: {
    id: 'mikol',
    tag: 'Mikol',
    height: 185,
    blurb: 'Has never once been angry. Quietly a crypto genius.',
    studies: 'Computer Science',
    ability: { name: 'Router Logs', text: 'At the router: which room every phone was in over the last 90 s. Cracks locked phones in 2 s.' },
    quirk: { name: 'Unbothered', text: 'The fire alarm and the bathroom gross-out don’t touch him.' },
    catchphrase: 'What bro.',
    lines: {
      meeting: ['It’s all good. Probably.', 'I’m not selling, and I’m not the Degenerate.', 'What bro. What.'],
      body: 'What bro. WHAT bro.',
      evicted: 'What bro.',
    },
    wake: 'mikol',
    traits: { notes: 'computing', smoke: 'weed', temper: 'calm', room: 'messy', drinking: 'light', footprint: 'big', hairColour: 'brown', hairLength: 'medium' },
    belonging: 'a hardware crypto wallet',
    look: { skin: SKIN.fair, hair: '#5a3a22', style: 'swept', shirt: '#2b2d31', trim: '#6b8f71', pants: '#40506a', shoes: '#1d1d1f', build: 1 },
  },
  jung: {
    id: 'jung',
    tag: 'Jung',
    height: 175,
    blurb: 'The maths brain, with a short fuse for nonsense.',
    studies: 'Applied Mathematics Engineering',
    ability: { name: 'Proof', text: 'Pick a player and a crime: “consistent” or “contradiction” against its real posted clues.' },
    quirk: { name: 'Illogical!', text: 'His phone buzzes the moment two posted clues from one crime can’t both be true.' },
    catchphrase: 'Wagwan.',
    lines: {
      meeting: ['That’s not logical.', 'Explain to me how that makes sense.', 'Wagwan. Also, you’re lying.'],
      body: 'This is statistically upsetting.',
      evicted: 'This is statistically ridiculous.',
    },
    wake: 'jung',
    traits: { notes: 'engineering', smoke: 'weed', temper: 'short fuse', room: 'messy', drinking: 'light', footprint: 'medium', hairColour: 'black', hairLength: 'medium' },
    belonging: 'a page of proofs with ILLOGICAL circled in red',
    look: { skin: SKIN.light, hair: '#15130f', style: 'medium', shirt: '#e9e4d8', trim: '#b23a3a', pants: '#26282d', shoes: '#f3f3f3', build: 0.98 },
  },
  xang: {
    id: 'xang',
    tag: 'Xang',
    height: 175,
    blurb: 'The kindest, humblest man alive, until he becomes Bongus.',
    studies: 'Mining Engineering',
    ability: { name: 'Bongus Mode', text: 'One huge rip: for 15 s he walks slower, the world goes hazy, and hidden clues within 6 m glow.' },
    quirk: { name: 'Rock Hound', text: 'Searches twice as fast. He knows where to dig.' },
    catchphrase: 'Yoooooo.',
    lines: {
      meeting: ['No worries at all, but it wasn’t me.', 'Has anyone seen my rock?', 'Yoooooo. Okay. Okay okay okay.'],
      body: 'Yoooooo… no. No no no.',
      evicted: 'All good guys, love you.',
    },
    wake: 'xang',
    traits: { notes: 'engineering', smoke: 'weed', temper: 'calm', room: 'chaos', drinking: 'heavy', footprint: 'medium', hairColour: 'brown', hairLength: 'short' },
    belonging: 'a labelled rock sample',
    look: { skin: SKIN.fair, hair: '#6b4426', style: 'short', shirt: '#7a8b3f', trim: '#d8c89a', pants: '#5b4a3a', shoes: '#8a7a68', build: 1 },
  },
  selby: {
    id: 'selby',
    tag: 'Selby',
    height: 175,
    blurb: 'Runs Bike Stu, a studio full of people nobody else has met.',
    studies: 'Teaching',
    ability: { name: 'Bike Stu Session', text: 'Two randoms from his studio wander the house for 45 s. If one sees a crime, he gets a trait.' },
    quirk: { name: 'Dire', text: 'Fixes a crisis sabotage alone.' },
    catchphrase: '*nods*',
    lines: {
      meeting: ['Come through to Bike Stu after this.', 'Okay. This is actually dire.', '*nods slowly*'],
      body: 'Okay. This is actually dire.',
      evicted: 'Bike Stu will remember this.',
    },
    wake: 'selby',
    traits: { notes: 'teaching', smoke: 'weed', temper: 'calm', room: 'chaos', drinking: 'heavy', footprint: 'medium', hairColour: 'red', hairLength: 'long' },
    belonging: 'a burned Bike Stu mixtape',
    look: { skin: SKIN.fair, hair: '#c4622d', style: 'shaggy', shirt: '#8c5aa8', trim: '#f0c24b', pants: '#3a4a5c', shoes: '#c9b79c', build: 0.97 },
  },
  wags: {
    id: 'wags',
    tag: 'Wags',
    height: 190,
    blurb: 'Genuinely the nicest person ever. Stressed about everything.',
    studies: 'Commerce',
    ability: { name: 'Look Out', text: 'Guards a friend for 30 s: they can’t be taken out, and he’s told if someone tries.' },
    quirk: { name: 'Worrier', text: 'A crime on his floor buzzes his phone, with an arrow to it for 3 s.' },
    catchphrase: 'How’s it goin.',
    lines: {
      meeting: ['Guys, is this safe?', 'I’m not mad, I’m just disappointed.', 'Records in my room after? Please?'],
      body: 'Guys. Guys. GUYS.',
      evicted: '…I’m just disappointed.',
    },
    wake: 'wags',
    traits: { notes: 'commerce', smoke: 'cigarettes', temper: 'calm', room: 'tidy', drinking: 'heavy', footprint: 'big', hairColour: 'brown', hairLength: 'short' },
    belonging: 'a sleeve from his record collection',
    look: { skin: SKIN.fair, hair: '#4e3420', style: 'short', shirt: '#5d7a9c', trim: '#ffffff', pants: '#c8b48a', shoes: '#6b4a32', build: 1.02, glasses: true },
  },
  will: {
    id: 'will',
    tag: 'Will Palmer',
    height: 165,
    blurb: 'Campus famous. Somehow gets great grades. Somehow never at the house clean-up.',
    studies: 'Mechanical Engineering',
    ability: { name: 'Campus Legend', text: 'Once a night at a meeting, his vote counts double, and everyone sees it.' },
    quirk: { name: 'Supervisor', text: 'His own chores are slow, but anyone working within 3 m of him works 50% faster.' },
    catchphrase: 'How’s it going, buddy.',
    lines: {
      meeting: ['Drinks are on my sponsor if you vote with me.', 'I was literally about to help.', 'How’s it going, buddy. You’re lying, buddy.'],
      body: 'Buddy? Buddy!',
      evicted: 'You’ll all be at my party next week anyway.',
    },
    wake: 'will',
    traits: { notes: 'engineering', smoke: 'none', temper: 'short fuse', room: 'spotless', drinking: 'heavy', footprint: 'small', hairColour: 'brown', hairLength: 'medium' },
    belonging: 'a fistful of party wristbands',
    look: { skin: SKIN.light, hair: '#5c3b22', style: 'swept', shirt: '#f4f1ea', trim: '#1e3a5f', pants: '#1e2633', shoes: '#3b2416', build: 0.98 },
  },
  jj: {
    id: 'jj',
    tag: 'JJ',
    height: 170,
    blurb: 'The responsible one. Has everything figured out.',
    studies: 'Chemical Engineering',
    ability: { name: 'Inspection', text: 'Stands in a room for 3 s: anything moved or planted in it sparkles.' },
    quirk: { name: 'Spare Keys', text: 'Opens locked doors and locked clues in 2 s.' },
    catchphrase: 'Hey, how are you?',
    lines: {
      meeting: ['Whose dishes are these? Focus. Whose dishes.', 'We have a chore chart for a reason.', 'Hey, how are you? Be honest.'],
      body: 'Okay. Nobody touch anything.',
      evicted: 'Fine. But someone clean the kitchen.',
    },
    wake: 'mikol',
    traits: { notes: 'engineering', smoke: 'none', temper: 'short fuse', room: 'spotless', drinking: 'heavy', footprint: 'small', hairColour: 'black', hairLength: 'short' },
    belonging: 'a page torn off the chore chart',
    look: { skin: SKIN.light, hair: '#17130f', style: 'short', shirt: '#2f6f6a', trim: '#f2efe6', pants: '#3a3f4b', shoes: '#f1f1f1', build: 1 },
  },
  nash: {
    id: 'nash',
    tag: 'Nash',
    height: 170,
    blurb: 'Ten out of ten green. Staying in.',
    studies: 'Commerce',
    ability: { name: 'Wallhack', text: 'For 3 s, everyone within 8 m shows as an outline through walls and floors.' },
    quirk: { name: 'Couch Lock', text: 'On the living-room sofa, he hears every footstep in the house at full volume.' },
    catchphrase: 'Yo.',
    lines: {
      meeting: ['One more game, then I vote.', 'Who left this here? That’s disgusting.', 'Yo. It’s them. Trust.'],
      body: 'Yo. That’s disgusting.',
      evicted: 'Cool. I’ll be on the couch.',
    },
    wake: 'living',
    traits: { notes: 'commerce', smoke: 'weed', temper: 'short fuse', room: 'tidy', drinking: 'light', footprint: 'small', hairColour: 'brown', hairLength: 'short' },
    belonging: 'a potted bonsai tree',
    look: { skin: SKIN.light, hair: '#4a3020', style: 'buzz', shirt: '#4b4f58', trim: '#9ad04a', pants: '#2d2f36', shoes: '#ffffff', build: 0.98, hat: 'cap', hatColour: '#1d2026' },
  },
  shota: {
    id: 'shota',
    tag: 'Shota',
    height: 185,
    blurb: 'Shirt off. Always down. Never, ever angry.',
    studies: 'Sciences',
    ability: { name: 'Ruck', text: 'Bursts through a locked door; lifts two-person chores on his own.' },
    quirk: { name: 'Always Down', text: 'Anyone can ping him from their phone, and he gets an arrow to them.' },
    catchphrase: 'Broooooo no broooooo.',
    lines: {
      meeting: ['I’m down. For voting. Who’s down?', 'Broooooo what broooooo.', 'I was shirtless the whole time, check the cams.'],
      body: 'Broooooo no broooooo.',
      evicted: 'Broooooo what broooooo.',
    },
    wake: 'mikol',
    traits: { notes: 'science', smoke: 'weed', temper: 'calm', room: 'messy', drinking: 'light', footprint: 'big', hairColour: 'black', hairLength: 'long' },
    belonging: 'a miniature bong',
    look: { skin: SKIN.warm, hair: '#0f0d0b', style: 'verylong', shirt: '#b8452f', trim: '#2b2b2b', pants: '#30323a', shoes: '#22252b', build: 1.15 },
  },
  gare: {
    id: 'gare',
    tag: 'Gare',
    height: 180,
    blurb: 'Shota’s friend from back home, in town for homecoming. An electrician who fought Muay Thai in Thailand.',
    studies: 'Electrician (here to party)',
    ability: { name: 'Trip Wire', text: 'Wires a motion sensor into a room’s lights for 60 s: anyone walking in, and he gets a text about their footsteps.' },
    quirk: { name: 'Teep', text: 'Muay Thai: his shoves send people twice as far, and nobody can shove him.' },
    catchphrase: '*BUUURP*',
    lines: {
      meeting: ['I’m just here for homecoming, boys.', 'I rewired your kitchen and this is the thanks I get?', 'Say that again. *cracks knuckles*'],
      body: 'Oh. Oh no. Who turned the lights off on this guy?',
      evicted: 'Fine. I’ll go party somewhere that appreciates me. *BURP*',
    },
    wake: 'porch',
    traits: { notes: 'trade', smoke: 'none', temper: 'short fuse', room: 'messy', drinking: 'heavy', footprint: 'medium', hairColour: 'brown', hairLength: 'short' },
    belonging: 'a roll of electrical tape',
    look: { skin: SKIN.fair, hair: '#5a3a22', style: 'short', shirt: '#d9822b', trim: '#2b2b2b', pants: '#3c4a5e', shoes: '#2a2724', build: 1.08 },
  },
  guest: {
    id: 'guest',
    tag: 'Guest',
    height: 178,
    blurb: 'Here for the party. Sleeps on the sofa. Knows nobody’s room by name.',
    studies: 'Undeclared',
    ability: { name: 'Plus One', text: 'Guest abilities arrive with their sheets. For now: vibes.' },
    quirk: { name: 'Couch Surfer', text: 'Wakes up on the living-room sofa.' },
    catchphrase: 'Whose house is this?',
    lines: {
      meeting: ['I just got here.', 'I don’t even know whose room that was.', 'Is this always how it goes here?'],
      body: 'Is that… normal here?',
      evicted: 'Thanks for having me, I guess.',
    },
    wake: 'living',
    traits: { notes: 'commerce', smoke: 'none', temper: 'calm', room: 'the couch', drinking: 'light', footprint: 'medium', hairColour: 'brown', hairLength: 'short' },
    belonging: 'a borrowed hoodie',
    look: { skin: SKIN.light, hair: '#3b2a1c', style: 'short', shirt: '#6a6f7a', trim: '#c9a227', pants: '#3a3a40', shoes: '#d0d0d0', build: 1 },
  },
};

/** Guests share one card, so their looks vary a little by name. */
const GUEST_SHIRTS = ['#6a6f7a', '#a0522d', '#2e8b57', '#4169e1', '#c71585', '#b8860b', '#008b8b', '#8b4513'];
const GUEST_HAIR = ['#3b2a1c', '#15130f', '#7b5534', '#c9a14a', '#a14a2a'];

export function lookFor(id: CharId, name: string): Look {
  const base = CAST[id].look;
  if (id !== 'guest') return base;
  let h = 7;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { ...base, shirt: GUEST_SHIRTS[h % GUEST_SHIRTS.length], hair: GUEST_HAIR[(h >>> 4) % GUEST_HAIR.length] };
}

/** Eye height in metres for first person (a little under the top of the head). */
export const eyeHeight = (id: CharId) => CAST[id].height / 100 - 0.11;

export const isCharId = (v: unknown): v is CharId => typeof v === 'string' && (CHAR_IDS as readonly string[]).includes(v);

/** The name shown over a player's head: the character's tag, or a guest's own name. */
export const tagFor = (id: CharId, name: string) => (id === 'guest' ? name : CAST[id].tag);
