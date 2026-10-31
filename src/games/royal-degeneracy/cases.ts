// The mysteries as data: the cold-open card, the takeout weapon, the Last Meeting and the texts that come in during
// the night. Clue rules join them in step 4; new cases are cheap to add.

export interface Case {
  id: string;
  title: string;
  /** Where the opening crime happened (its clues are lying around there), and what the culprit did. */
  scene: { room: string; x: number; z: number; did: string };
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
    scene: { room: 'kitchen', x: 5.6, z: 1.5, did: 'started the tower of dishes' },
    open: 'The kitchen sink has become a tower. A frying pan is load-bearing. JJ has called it “a biohazard and a betrayal”. One of you started this.',
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
    open: 'Someone didn’t flush the top toilet. Worse: the floor. Wags has been in there twice to check and come out a different man. One of you did this.',
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
];

export const caseById = (id: string) => CASES.find((c) => c.id === id) ?? CASES[0];
