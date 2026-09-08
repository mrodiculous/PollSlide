/* PollSlide — the vetted pictures for the demo deck.
 * ---------------------------------------------------------------------------
 * COLLECTED THROUGH OUR OWN /api/gif-search, THEN LOOKED AT. Every one of these was
 * rendered and inspected before it went in. That review is the whole point: this deck
 * opens identically for every new account, often on a projector in front of a class
 * before the teacher has seen the product at all. A live search would hand each of them
 * a different, unreviewed set, and a G rating is a filter rather than a promise.
 *
 * WHAT THE REVIEW THREW OUT, so nobody re-adds it by "improving" the search:
 *   • bare nouns return the meme corpus — "lion" gave two greyscale figures and no lion,
 *     "octopus" a person's face with tentacles, "chameleon" a cushion with a username
 *     watermarked on it
 *   • brand and franchise clips — Looney Tunes, DreamWorks, Tom & Jerry, a Tag Heuer
 *     advert, NFT art, a plastic-toy promo with a child in it
 *   • text burned into the pixels ("SNOOZE", "Happy National Koala Day"), which no
 *     metadata filter can see
 *   • wrong species — a RED panda for "panda"
 * What works is zoos, aquariums and wildlife broadcasters: San Diego Zoo, Monterey Bay
 * Aquarium, Brookfield Zoo, Nature on PBS, BBC Earth. Search terms are written to land
 * there, and the primaries below are nearly all from those channels.
 *
 * QUESTION-LEVEL PICTURES ARE OBJECTS, NOT ANIMALS. An earlier pass collected five and
 * rejected all five, because two of them (a seal, Jerry the mouse) put an unrelated
 * ANIMAL above a question asking which animal does something — worse than no picture at
 * all. The note then said the questions stay text, and the five q0–q4 slots sat empty
 * for months while starters.js still declared a gifTerm for each. They are filled now,
 * with the CLUE rather than the subject: an alarm clock over "sleeps the most", a
 * stopwatch over "fastest", a paint palette over "changes colour". Nothing in a question
 * picture can narrow the choices, which is what made the animal ones unusable.
 *
 * URLs are the canonical `media.giphy.com/media/<id>/200.gif` form: no cid/analytics
 * segment, 200px rather than the 100px the product's normaliser defaults to, and every
 * one has a real `_s` still so reduced-motion viewers get the frozen frame the UI
 * promises them. All 25 primaries were re-confirmed to load on 2026-09-08.
 *
 * WEIGHT IS PART OF THE REVIEW. This deck opens on school and conference wifi, so three
 * primaries that were 1.4–2.3MB were swapped for spares of the same subject and source
 * at 232–656KB (koala, frog, dolphin). The heavy ones stayed on as spares.
 *
 * `alts` are SPARES, reviewed at the same time. lib/starter-media-check.js promotes one
 * when a primary 404s — a repair must never be a fresh search, or the deck every new
 * account opens fills with images nobody has seen.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PSStarterMedia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Giphy's canonical rendition URLs, built from the id so the table stays readable.
  const G = (id, alt) => ({
    url:   'https://media.giphy.com/media/' + id + '/200.gif',
    still: 'https://media.giphy.com/media/' + id + '/200_s.gif',
    alt, id, source: 'giphy',
  });
  const slot = (term, primary, ...alts) => Object.assign({}, primary, { term, alts });

  return {
    /* ── QUESTION-LEVEL pictures ────────────────────────────────────────────────
     * These five were specified in starters.js (every question carries a gifTerm) and
     * then never filled, so the demo deck shipped with pictures on all twenty answers
     * and none on any question — half of what a new account is supposed to see.
     *
     * The subject is deliberately the CLUE, not the animal: a stopwatch over "which is
     * fastest", a paint palette over "which changes colour". An animal here would give
     * the answer away before the choices are even up.
     *
     * Licensed characters are avoided on purpose — this deck ships to every account and
     * gets projected in public, so no SpongeBob, Simpsons, Disney or PBS. So are the
     * "trampoline fail" clips the search is full of: they are real people getting hurt.
     * Every URL below was fetched and checked (200 + non-zero body) on 2026-09-08;
     * two candidates that answered intermittently were dropped rather than shipped. */
    q0: slot('alarm clock',
      G('SHvCPVGfLpyOPA69zq', 'Alarm Clock Animation GIF'),
      G('IY6iHDJrUIgJW50rSr', 'Alarm Clock Icon GIF by SUCCESSINSIDER'),
      G('hU9FpBh8Q56CfwXiVc', 'Digital alarm clock going off at 6:30'),
      G('yrRLB4Ba4ICQfiaGBn', 'Wake Up Clock GIF')),
    q1: slot('trampoline',
      G('gLGXoJixC1vItgVfcz', 'Jump Trampoline GIF'),
      G('d1GQguRA5Tx0PGDEz5', 'Jump Jumping GIF by Jumpsquare'),
      G('RIN5IRPmU6rVOyHas0', 'Positive_Jump trampoline GIF'),
      G('8YXRcxfk7u8B65glSD', 'big air trampoline park GIF')),
    q2: slot('heartbeat',
      G('JQRfa8kPwx5xgc51jG', 'Animation Heart GIF by Elle'),
      G('l3YSj6Oirgkb18AkE',  'beating heart love GIF by appikiko'),
      G('S9E88u47Lxc3uqhsse', 'Heart Loop GIF by xponentialdesign'),
      G('T1TqR5TT62mVG',      'Heartbeat Throb GIF')),
    q3: slot('stopwatch',
      G('wq1I3ILdsvYJub8Rwx', 'Sport Time GIF by TeamColorCodes'),
      G('ZbTPNi9bQXCtrxz0Hz', 'stopwatch timer GIF by ikonicstopwatch'),
      G('l6tgUFAg5xzB5LKccX', 'Timer Timing GIF by ikonicstopwatch'),
      G('pMq2kVIEfTvmeG8AVC', 'stopwatch timer GIF by ikonicstopwatch')),
    q4: slot('paint palette',
      G('kc6oPAnQyZNfjIrMaS', 'artist paint painter palette GIF by ZenARTSupplies'),
      G('W5ZfAcHuuoBdWXHBfK', 'Art Teacher Paint Palette GIF by theartofed'),
      G('ZbH1o1o3zJwmCgo0Q8', 'art artist painting GIF by loganelizabethdesigns'),
      G('nRCmNNkJE1R4to80Fa', 'Stop Motion Color GIF by Evan Hilton')),

    /* Q1 — which animal sleeps the most?  (answer: Koala, option C) */
    q0o0: slot('sloth zoo wildlife',
      G('KaJZkBnTnBdaYS0Kaz', 'Happy Sloth GIF by San Diego Zoo Wildlife Alliance'),
      G('H7Z7eBslsdCui96Z0y', 'Sloth GIF by Brookfield Zoo'),
      G('2G1LnvXYSyn5r6rsyD', 'Sloth Hanging GIF by Brookfield Zoo')),
    q0o1: slot('lion zoo wildlife',
      G('UPXLFSFtlO0PcQrRlf', 'Lion Yawn GIF by BristolZooGardens'),
      G('BSUtXQ7DLZqmbfq7HR', 'Lion Roar GIF by Brookfield Zoo'),
      G('Fq41ykxnSRdduPYE8U', 'Lion Cute Animals GIF by Brookfield Zoo'),
      G('S5FX2oPNR5ji1PK5yp', 'Lion Roar GIF by Brookfield Zoo')),
    q0o2: slot('koala zoo wildlife',
      G('3ohc0W7461KslLarLO', 'koala lol GIF by San Diego Zoo'),
      G('OJezshp284P9C',      'zoo koala GIF by Mitteldeutscher Rundfunk'),
      G('Z4Y5pgXHambPG',      'zoo koala GIF by Mitteldeutscher Rundfunk'),
      G('iFYuzoHk6XCaQ',      'zoo koala GIF by Mitteldeutscher Rundfunk')),
    // The VeeFriends spare was dropped: NFT brand art, not a panda.
    q0o3: slot('giant panda zoo bamboo',
      G('GefE7ts85UPyEslWVd', 'Peek A Boo Pandas GIF by San Diego Zoo Wildlife Alliance'),
      G('AGl4BWvZNfvby',      'panda GIF'),
      G('bMSMRrBm9vLfa',      'panda eating GIF')),

    /* Q2 — which of these cannot jump?  (answer: Elephant, option D) */
    q1o0: slot('kangaroo animal',
      G('D10hKcRT6JaLu',      'red kangaroo eating GIF'),
      G('Ddz0zMHIlBIg8',      'bbc natural world kangaroo GIF by Head Like an Orange'),
      G('3o7qE5866bLg4VKabe', 'Kangaroo Dundee Australia GIF by Nat Geo Wild'),
      G('LwPUCrQYRlZi8',      'red kangaroo GIF by Head Like an Orange')),
    q1o1: slot('frog nature wildlife',
      G('eocoJJgo4Ba8cYtroU', 'Deep Thoughts Frog GIF by U.S. Fish and Wildlife Service'),
      G('4BBZTNzhPGevd27wqv', 'Pbs Nature Frog GIF by Nature on PBS'),
      G('YNzedACGq3lXZtiRCQ', 'Surprise Frog GIF by BBC America'),
      G('8qnpAYUzPx4dPXa5AZ', 'Pbs Nature Frog GIF by Nature on PBS')),
    q1o2: slot('cat jumping',
      G('TjSPQgowhhJdHgvnwA', 'Cute Cat GIF'),
      G('Wv3GvRGWKIDBK',      'cat jump GIF'),
      G('XQebwq1LPmTWU',      'cat baby GIF')),
    q1o3: slot('elephant animal',
      G('dc3SimFyZvs6O6if5d', 'Pbs Nature Elephant GIF by Nature on PBS'),
      G('lTMbyLCN9kV4qUigRl', 'African Elephant Africa GIF by Born Free Foundation'),
      G('l3977NVbc2gilsoPm',  "nature's epic journeys elephants GIF by BBC Earth"),
      G('0xfk1JruM9utqV6w0D', 'Atlanta Elephant GIF by ZooATL')),

    /* Q3 — which has three hearts?  (answer: Octopus, option B) */
    // "knife crab" dropped as a spare — an odd image for a classroom.
    q2o0: slot('crab ocean wildlife',
      G('BHtw4SaCuTS6nG9FJS', 'Ocean Crab GIF by PBS Digital Studios'),
      G('HPEeq2hcIqG8tWDwC8', 'Snow Crabbing GIF by PBS Digital Studios')),
    q2o1: slot('octopus aquarium ocean',
      G('glEwcJVD8dbvwZbDOP', 'Giant Pacific Octopus Ocean GIF by Monterey Bay Aquarium'),
      G('Occ7SXRqFk52QCTSbG', 'Giant Pacific Octopus Ocean GIF by Monterey Bay Aquarium'),
      G('80ciXbozWdtKK42iPI', 'Giant Pacific Octopus Ocean GIF by Monterey Bay Aquarium')),
    q2o2: slot('dolphin aquarium ocean',
      G('l4FGtklbooKD0x0mk',  'bottlenose dolphin GIF by Monterey Bay Aquarium'),
      G('IeQzPldFcpS7R2iy3I', 'Dolphin GIF by Georgia Aquarium'),
      G('eh6mMxwPOveg7WYXjf', 'Dolphin GIF by Georgia Aquarium'),
      G('l4FGGSoEHgefTbWP6',  'bottlenose dolphin GIF by Monterey Bay Aquarium')),
    q2o3: slot('seahorse aquarium ocean',
      G('3o7bufkvhaQuq6pYpG', 'pacific seahorse GIF by Monterey Bay Aquarium'),
      G('26gR1KROinUmJ9vdm',  'pacific seahorse GIF by Monterey Bay Aquarium'),
      G('3o7buh6L9DcM9Vqbhm', 'pacific seahorse GIF by Monterey Bay Aquarium'),
      G('3o7btZQ3uXB7qVclqM', 'pacific seahorse GIF by Monterey Bay Aquarium')),

    /* Q4 — fastest on land?  (answer: Cheetah, option A) */
    q3o0: slot('cheetah zoo wildlife running',
      G('LkeVY47xrez9jTKuas', 'Cats Cheetah GIF by Cincinnati Zoo'),
      G('xULW8vJZtqvbp0KBvW', 'Zoo Cheetah GIF by euronews')),
    q3o1: slot('horse galloping wildlife',
      G('Me7kXfDASTpveVsMT0', 'Happy Horses GIF by Barbara Pozzi'),
      G('2d4Z2W5eohsl2',      'horse GIF'),
      G('k7rp8nUFtf9K0',      'horse galloping GIF'),
      G('epYPRUq3sj7vq',      'Horse GIF')),
    /* The top hit was an Amnesty International-branded GIF. Nothing wrong with it, but a
       campaigning organisation's identity on a deck shipped worldwide is a topic the
       teacher did not choose to raise, so the plain ostrich is promoted instead. */
    q3o2: slot('ostrich zoo wildlife',
      G('qghdusmfvfjri',      'Ostrich GIF'),
      G('bvhOTQTJr9BNpHaHUT', 'Ostrich GIF')),
    q3o3: slot('greyhound dog running',
      G('Id0O5de7UFTc3dHmQg', 'Rescue Dog GIF by Greyhound Rescue'),
      G('ggRD8sbB6y0fi8Aq2C', 'Awesome Dog GIF by Greyhound Rescue'),
      G('Zcta8eM2DQFm0OqJYz', 'Dog Noms GIF by Greyhound Rescue')),

    /* Q5 — which can change colour?  (answer: Chameleon, option D) */
    q4o0: slot('penguin animal',
      G('Dz61PRqACveZq',      'penguin GIF'),
      G('nAfzRC9fW8KDm',      'penguin swimming GIF'),
      G('DdJ9RsY88uBarMvVsb', 'Penguin GIF')),
    q4o1: slot('owl wildlife nature',
      G('L4WmnhDPrttRThihOn', 'Hungry Snow Owl GIF by John Ball Zoo'),
      G('can527t6uJBllkCEy6', 'Pbs Nature Owl GIF by Nature on PBS'),
      G('SQkqcCCesn0kQ3HH2b', 'Great Horned Owl GIF by U.S. Fish and Wildlife Service')),
    q4o2: slot('sea turtle aquarium',
      G('96mn64jKRkH52UbtgB', 'Tired Sea Turtle GIF by Aquarium of the Pacific'),
      G('3o7budBHBXvEuXgffO', 'sea turtle swimming GIF by Monterey Bay Aquarium'),
      G('3o7btWuHdqixPYqKuQ', 'sea turtle swimming GIF by Monterey Bay Aquarium'),
      G('h6WAvV5XZHNgJIQoqg', 'Sea Turtle Swimming GIF by Monterey Bay Aquarium')),
    // "Meccha Chameleon" dropped as a spare — it is a cushion, not a chameleon.
    q4o3: slot('chameleon reptile wildlife',
      G('11Aq0eIRutOHaE',     'pygmy leaf chameleon GIF by Head Like an Orange'),
      G('jj2amVuFUwo5a',      'panther chameleon lizard GIF by Head Like an Orange'),
      G('wZQBoc6V821fSJMrRO', 'Chameleon GIF')),
  };
});
