// The mysteries as data: the cold-open card, the takeout weapon, the Last Meeting and the texts that come in during
// the night. Clue rules join them in step 4; new cases are cheap to add.

export interface Case {
  id: string;
  title: string;
  /** Where the opening crime happened (its clues are lying around there), and what the culprit did. */
  scene: { room: string; x: number; z: number; did: string; view?: number; hidden?: number; hide?: string };
  /** The cold-open card, a line or two. */
  open: string;
  /** What a takeout is done with (the bonk's name). */
  weapon: string;
  /** Who forces the Last Meeting at the deadline, and how. */
  last: string;
  /** Group-chat texts through the night: [fraction of the night, from, text]. `{hint}` becomes a true trait of
   * the case's culprit that no clue has shown yet. */
  texts: [number, string, string][];
  /** After the reveal: [the Degenerates won, the housemates won]. */
  ending: [string, string];
  /** Twists: extra plants for each Degenerate; how often the raccoon gets in (s); Wags gets the blame first. */
  extraPlants?: number;
  coonEvery?: number;
}

export const CASES: Case[] = [
  {
    id: 'drumset',
    title: 'The Drumset Massacre',
    scene: { room: 'xang', x: 6.6, z: 17.4, did: 'smashed Donal’s drum kit' },
    open: 'Donal’s drum kit is in pieces in Xang’s room, where Donal used to live and where he swears it was “just being stored”. He’s home at 4 am. One of you did this.',
    weapon: 'a drumstick',
    last: 'A taxi pulls up outside. Donal is home, and he has questions.',
    texts: [
      [0.08, 'Donal', 'yo is my kit ok. just checking. no reason'],
      [0.3, 'Donal', 'the ring cam app says {hint} was at the door at 11. WHO. WHY'],
      [0.55, 'Donal', 'if the snare is scratched i am moving back in'],
      [0.8, 'Donal', 'in the taxi. 10 mins. someone better be cleaning'],
    ],
    ending: ['Donal stands in the doorway holding half a cymbal. Nobody says anything. Someone puts a record on.', 'The culprit buys Donal a new snare. Donal is not moving back in. Everybody cheers that last part.'],
  },
  {
    id: 'sink',
    title: 'The Sink of Shame',
    // The twist: two of its clues are in the tower of dishes, and washing up is how you dig.
    scene: { room: 'kitchen', x: 4.8, z: 3.7, did: 'started the tower of dishes', view: 1, hidden: 2, hide: 's-sink' },
    open: 'The kitchen sink has become a tower. A frying pan is load-bearing. JJ has called it “a biohazard and a betrayal”. One of you started this, and the evidence is in the pile: wash up to dig.',
    weapon: 'a frying pan',
    last: 'The landlord texts: “inspection in the morning, see you all at 9”. Emergency house meeting.',
    texts: [
      [0.1, 'JJ', 'whose bowl is this. it has a SMELL'],
      [0.35, 'Landlord', 'Hi all, a neighbour says they saw {hint} carrying a frying pan around at midnight? :)'],
      [0.6, 'JJ', 'someone put a pizza box IN the sink. in it'],
      [0.85, 'Landlord', 'Inspection 9am sharp. Thanks guys!'],
    ],
    ending: ['The tower stands. The landlord takes photos. The deposit is a memory.', 'The sink shines. JJ wipes a single tear and updates the chore chart.'],
  },
  {
    id: 'unflushed',
    title: 'The Unflushed',
    scene: { room: 'bath3', x: 7.1, z: 8.4, did: 'didn’t flush (and the floor)' },
    open: 'Someone didn’t flush the top toilet. Worse: the floor. Nobody can stand it in there for more than 8 seconds, so search it in relays. One of you did this.',
    weapon: 'a plunger',
    last: 'Wags locks himself in his room and plays the saddest record he owns. The house has to settle this now.',
    texts: [
      [0.12, 'Wags', 'guys is the top bathroom safe to use'],
      [0.4, 'Wags', 'it is not safe to use'],
      [0.65, 'Jung', 'ran the numbers. it was {hint}. statistically. this is not a comforting statistic'],
      [0.88, 'Wags', 'putting on the sad record in 5 if nobody confesses'],
    ],
    ending: ['Nobody confesses. The toilet is sealed with tape and a sign that just says “NO”.', 'The culprit plunges in front of everyone. Wags puts on a happy record.'],
  },
  {
    id: 'record',
    title: 'The Scratched Record',
    scene: { room: 'wags', x: 4.8, z: 18.4, did: 'scratched Wags’s favourite record' },
    open: 'Wags’s favourite record is lying on his floor with a scratch right through side B. It skips. It will skip all night. He is not mad, he is just disappointed. One of you did this.',
    weapon: 'a record sleeve',
    last: 'Wags plays the scratched record at full volume until everybody comes down to the living room.',
    texts: [
      [0.1, 'Wags', 'guys. guys. side B.'],
      [0.32, 'Wags', 'the downstairs neighbour says {hint} was on the stairs right before it started skipping'],
      [0.6, 'Wags', 'i am not mad'],
      [0.85, 'Wags', 'i am just disappointed. meeting in 5'],
    ],
    ending: ['The record skips forever. Wags moves it to a shelf labelled “why”.', 'The culprit buys a new copy and a nicer turntable needle. Records in Wags’s room after.'],
  },
  {
    id: 'stash',
    title: 'The Sponsored Stash',
    scene: { room: 'will', x: 2.2, z: 15.8, did: 'drank all of Will’s sponsored liquor' },
    open: 'Will Palmer’s sponsored liquor, a whole crate of free bottles, is empty. Every last one. His room is spotless apart from the crime. One of you did this, and you did it thoroughly.',
    weapon: 'an empty bottle',
    last: 'The sponsor’s rep is outside, here to collect photos for Instagram. Will needs a name.',
    texts: [
      [0.08, 'Will Palmer', 'how’s it going buddy. who drank my sponsorship'],
      [0.35, 'Sponsor', 'Hey Will! Just checking you got the crate? Our driver said {hint} signed for it 😊'],
      [0.6, 'Will Palmer', 'drinks are NOT on my sponsor anymore'],
      [0.82, 'Sponsor', 'Swinging by for content in 10!'],
    ],
    ending: ['The sponsor posts a photo of an empty crate. Will loses his sponsorship and his will to live.', 'The culprit does the sponsor’s Instagram post, shirtless, at Will’s insistence.'],
  },
  {
    id: 'ragequit',
    title: 'The Rage Quit',
    scene: { room: 'living', x: 5, z: 8.2, did: 'threw Nash’s controller through the telly' },
    open: 'Someone lost one too many games and threw Nash’s controller through the telly. There is a controller-shaped hole in the screen. Nash is staying very calm. One of you did this.',
    weapon: 'a controller',
    last: 'Nash unplugs the broken telly in total silence and calls a house meeting from the couch.',
    texts: [
      [0.1, 'Nash', 'yo'],
      [0.33, 'Nash', 'the replay saved. you can see {hint} in the reflection'],
      [0.58, 'Nash', 'who left this here. that’s disgusting. also who broke my tv'],
      [0.84, 'Nash', 'one more game. of finding out who did it'],
    ],
    ending: ['The telly stays broken. Nash moves his setup to his own place and never comes back. (He comes back the next day.)', 'The culprit buys Nash a bigger telly. Nash nods once. Peace returns.'],
  },
  {
    id: 'cigarette',
    title: 'The Indoor Cigarette',
    scene: { room: 'dining', x: 2.4, z: 10.4, did: 'smoked a cigarette indoors' },
    open: 'The whole house reeks of cigarette smoke. Everyone is looking at Wags. Wags says it wasn’t him this time. It might genuinely not be him this time. One of you did this.',
    weapon: 'an ashtray',
    last: 'The landlord smells it through the front door and wants a name before he signs another lease.',
    texts: [
      [0.08, 'JJ', 'who smoked inside. it’s in the CURTAINS'],
      [0.3, 'Wags', 'it wasn’t me this time i swear'],
      [0.55, 'Landlord', 'Hi all, a neighbour mentioned {hint} smoking on the porch last week? :)'],
      [0.82, 'Wags', 'okay it was me last time. but not THIS time'],
    ],
    ending: ['Everyone blames Wags anyway. Wags buys an air purifier out of guilt for a crime he didn’t commit.', 'The culprit washes the curtains. Wags is finally, publicly, cleared.'],
    // Twist: the Degenerates get two extra plants (everyone will believe a cigarette butt).
    extraPlants: 2,
  },
  {
    id: 'raccoon',
    title: 'Who Let the Raccoon In',
    scene: { room: 'selby', x: 2.6, z: 2.4, did: 'left the balcony door open for the raccoon' },
    open: 'Someone left the balcony door open and the raccoon has moved in. It is in the bins. It is in the cupboards. It will be in your room. One of you did this.',
    weapon: 'a broom',
    last: 'Animal control is at the door. They need to know who to fine.',
    texts: [
      [0.1, 'Selby', 'the raccoon is in bike stu. it has a mic'],
      [0.36, 'Selby', 'my mate said {hint} opened the balcony door around 10'],
      [0.6, 'JJ', 'there is a raccoon in the kitchen cabinet. eating the chore chart'],
      [0.84, 'Animal control', 'On our way. Please do not feed it.'],
    ],
    ending: ['The raccoon gets a key. It pays no rent. It is the best housemate anyone has had.', 'The culprit is fined $200 and has to build the raccoon a nicer balcony.'],
    // Twist: the raccoon's in and out all night (and it runs off with clues).
    coonEvery: 35,
  },
];

export const caseById = (id: string) => CASES.find((c) => c.id === id) ?? CASES[0];
