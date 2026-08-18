/**
 * External reading and viewing.
 *
 * Every URL here was checked to resolve when this list was written. They are
 * deliberately stable landing pages — encyclopedia articles, project homepages,
 * channels — rather than deep links to individual videos, which rot fastest.
 * If you add one, check it first; a Learn page full of dead links is worse than
 * a short one.
 */

export interface Resource {
  readonly title: string;
  readonly url: string;
  readonly kind: 'read' | 'watch' | 'play';
  readonly note: string;
}

export interface ResourceGroup {
  readonly heading: string;
  readonly blurb: string;
  readonly items: readonly Resource[];
}

export const RESOURCE_GROUPS: readonly ResourceGroup[] = [
  {
    heading: 'The basics',
    blurb:
      'If the target column and the gates still feel unfamiliar, start with these.',
    items: [
      {
        title: 'Truth tables',
        url: 'https://en.wikipedia.org/wiki/Truth_table',
        kind: 'read',
        note: 'Exactly the thing in the TARGET panel: every input combination and what comes out.',
      },
      {
        title: 'Logic gates',
        url: 'https://en.wikipedia.org/wiki/Logic_gate',
        kind: 'read',
        note: 'AND, OR, NOT and the rest, with the symbols you will see everywhere else.',
      },
      {
        title: 'Boolean algebra',
        url: 'https://en.wikipedia.org/wiki/Boolean_algebra',
        kind: 'read',
        note: 'The algebra underneath the board. Useful once you want to rearrange a circuit on paper.',
      },
      {
        title: 'Crash Course Computer Science',
        url: 'https://www.youtube.com/playlist?list=PL8dPuuaLjXtNlUrzyH5r6jN9ulIgZBpdo',
        kind: 'watch',
        note: 'Short, friendly episodes. The early ones cover Boolean logic and how gates build up into arithmetic.',
      },
    ],
  },
  {
    heading: 'Getting fewer parts',
    blurb: 'How to shrink a circuit once it already works — the actual skill here.',
    items: [
      {
        title: "De Morgan's laws",
        url: 'https://en.wikipedia.org/wiki/De_Morgan%27s_laws',
        kind: 'read',
        note: 'The rewrite that turns an AND into an OR with inverters, and back. The single most useful trick for cutting parts.',
      },
      {
        title: 'Karnaugh maps',
        url: 'https://en.wikipedia.org/wiki/Karnaugh_map',
        kind: 'read',
        note: 'A visual way to find the smallest sum-of-products for a truth table. Practical up to about four inputs — exactly this game.',
      },
      {
        title: 'Quine–McCluskey algorithm',
        url: 'https://en.wikipedia.org/wiki/Quine%E2%80%93McCluskey_algorithm',
        kind: 'read',
        note: 'What you do when the truth table gets too big to eyeball. The systematic version of a Karnaugh map.',
      },
      {
        title: 'Adders',
        url: 'https://en.wikipedia.org/wiki/Adder_(electronics)',
        kind: 'read',
        note: 'Half adders and full adders — the classic worked example of building something useful out of XOR and AND.',
      },
    ],
  },
  {
    heading: 'Go deeper',
    blurb: 'Where this leads if you enjoy it: gates all the way up to a computer.',
    items: [
      {
        title: 'Nandgame',
        url: 'https://nandgame.com/',
        kind: 'play',
        note: 'Build a working computer starting from a single NAND. The closest relative to this game, and worth playing.',
      },
      {
        title: 'Nand to Tetris',
        url: 'https://www.nand2tetris.org/',
        kind: 'play',
        note: 'A full course on the same idea: from logic gates to a working machine and compiler.',
      },
      {
        title: 'Ben Eater — 8-bit computer',
        url: 'https://eater.net/8bit',
        kind: 'watch',
        note: 'Building a computer on breadboards, one chip at a time. Unhurried and very clear.',
      },
      {
        title: 'Ben Eater on YouTube',
        url: 'https://www.youtube.com/@BenEater',
        kind: 'watch',
        note: 'The channel, if you would rather browse than follow a series.',
      },
    ],
  },
  {
    heading: 'Play with gates elsewhere',
    blurb: 'Sandboxes for trying an idea outside a puzzle.',
    items: [
      {
        title: 'Academo logic gate simulator',
        url: 'https://academo.org/demos/logic-gate-simulator/',
        kind: 'play',
        note: 'A free browser sandbox. Drag gates around with no target to hit.',
      },
      {
        title: 'Logic.ly demo',
        url: 'https://logic.ly/demo/',
        kind: 'play',
        note: 'A polished circuit simulator with a free online demo.',
      },
      {
        title: 'Khan Academy — AP Computer Science Principles',
        url: 'https://www.khanacademy.org/computing/ap-computer-science-principles',
        kind: 'watch',
        note: 'Broader computing course with a gentle treatment of binary and logic.',
      },
    ],
  },
];
