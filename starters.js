/* PollSlide — the one deck a new account opens with.
 * ---------------------------------------------------------------------------
 * The first screen used to be "No presentations yet" and one button. Someone
 * evaluating the product at 9pm had to invent a quiz before they could see what it
 * does — and the thing they most want to see (a phone answering, a bar chart moving,
 * a reveal) is on the far side of that work.
 *
 * ONE DECK, NOT THREE. Three starters showed that Poll, Quiz and Survey are different
 * things, but nobody opens three. A single quiz that is actually good does more: it
 * scores, it reveals, it runs a leaderboard, and — unlike the text-only starters it
 * replaces — it shows that questions and answers can carry pictures, which is most of
 * what makes a room look up.
 *
 * WHY ANIMALS. This deck ships to every new account and will be projected in front of
 * classrooms, conferences and living rooms in countries we know nothing about. So the
 * subject has to be one that cannot land badly anywhere: no politics, no borders, no
 * religion, no history, no bodies, no national anything. Animal facts are true, mildly
 * surprising, work at any age, and every answer is a concrete creature — which also
 * makes them easy to picture. Each question is a real fact, checked, not a trick.
 *
 * THE PICTURES ARE FIXED, NOT SEARCHED.
 * A live GIF search at first run would hand every new user a different, unreviewed set
 * of images. Search results are third party and change daily; a G rating is a filter,
 * not a guarantee. For a deck that opens in front of somebody's class before they have
 * ever seen the product, "probably fine" is not good enough. So the media here is a
 * fixed set, fetched once by scripts/demo-media.js and LOOKED AT before it ships. The
 * teacher's own decks still use live search — they review those themselves.
 *
 * The question's own picture is deliberately NOT the answer. Searching a question's
 * words tends to surface the thing being asked about, which on "which animal sleeps
 * the most?" would put a koala on screen above four choices including Koala. Each
 * question therefore has a neutral term chosen by hand.
 */
(function (root, factory) {
  const api = factory(typeof globalThis !== 'undefined' ? globalThis : this);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PSStarters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (glob) {

  /* A choice, and the word its picture is searched on. The term is kept beside the
   * option rather than derived from it so a bad automatic guess can never reach this
   * deck — "Panda" is a term; "Which animal sleeps the most" is not. */
  const opt = (text, gifTerm) => ({ text, img: '', gifTerm });

  const quiz = (text, gifTerm, options, correctAnswer) => ({
    text,
    type: 'multiple_choice',
    correctAnswer,
    image: '',
    gifTerm,
    options,
  });

  const STARTERS = [
    {
      id: 'demo-quiz',
      product: 'quiz',
      icon: '🦥',
      name: 'Animal quiz — a 2-minute demo',
      blurb: 'Five real animal facts, with a picture on every question and every answer. Press ▶ Present and answer it on your phone to see the whole thing work.',
      takes: 'about 2 minutes',
      questions: [
        /* Every question's own term is a thing, never a creature. "sleepy" would have
           returned a koala on the question whose answer is Koala, and "running fast" a
           cheetah on the one whose answer is Cheetah — the picture above the choices
           would have answered the question. An object can't do that. */
        /* The right answer moves: A, B, C, D across the five. Every correct answer sat
           at option A in the first draft, so anyone who noticed could score full marks
           without reading a question — not the impression a demo should leave. */
        quiz('Which animal sleeps the most?', 'alarm clock', [
          opt('Sloth', 'sloth'),
          opt('Lion',  'lion'),
          opt('Koala', 'koala'),
          opt('Panda', 'panda'),
        ], 2),   // koalas sleep about 20–22 hours a day

        quiz('Which of these animals cannot jump?', 'trampoline', [
          opt('Kangaroo', 'kangaroo'),
          opt('Frog',     'frog'),
          opt('Cat',      'cat'),
          opt('Elephant', 'elephant'),
        ], 3),   // the only mammal that can't leave the ground

        /* Every choice is a CREATURE, not a number. An earlier draft asked "how many
           hearts does an octopus have?" with numeric answers — which left an octopus
           pictured beside "Three" and a jellyfish beside "One": pictures that matched
           nothing the choice said, and pointed straight at the right one. */
        quiz('Which of these animals has three hearts?', 'heartbeat', [
          opt('Crab',     'crab'),
          opt('Octopus',  'octopus'),
          opt('Dolphin',  'dolphin'),
          opt('Seahorse', 'seahorse'),
        ], 1),   // two pump the gills, one the rest of the body

        quiz('Which is the fastest animal on land?', 'stopwatch', [
          opt('Cheetah',   'cheetah'),
          opt('Horse',     'horse'),
          opt('Ostrich',   'ostrich'),
          opt('Greyhound', 'greyhound'),
        ], 0),   // ~110 km/h, well clear of the others

        quiz('Which of these animals can change colour?', 'paint palette', [
          opt('Penguin',   'penguin'),
          opt('Owl',       'owl'),
          opt('Turtle',    'turtle'),
          opt('Chameleon', 'chameleon'),
        ], 3),
      ],
    },
  ];

  const byId = (id) => STARTERS.find(s => s.id === id) || null;

  /* Every place a picture goes, flattened, so the fetch script has one list to walk and
   * one naming scheme to write back against. 'q3' is the fourth question's own box,
   * 'q3o1' its second choice. */
  function mediaSlots() {
    const out = [];
    STARTERS.forEach(s => (s.questions || []).forEach((q, qi) => {
      if (q.gifTerm) out.push({ starter: s.id, slot: 'q' + qi, term: q.gifTerm, about: q.text });
      (q.options || []).forEach((o, oi) => {
        if (o && o.gifTerm) {
          out.push({ starter: s.id, slot: 'q' + qi + 'o' + oi, term: o.gifTerm, about: o.text });
        }
      });
    }));
    return out;
  }

  /* The vetted media, published by starter-media.js as PSStarterMedia. Read at build
   * time rather than captured on load so the two files can arrive in either order. A
   * missing map is not an error: the deck is still a working quiz, just without
   * pictures, which is exactly what should happen if the media file was not deployed. */
  const mediaMap = (injected) => {
    if (injected && typeof injected === 'object') return injected;
    const g = glob || {};
    return (g.PSStarterMedia && typeof g.PSStarterMedia === 'object') ? g.PSStarterMedia : {};
  };

  /* Build the deck object. Questions are deep-copied so two decks created from the
   * same template never share option arrays — editing one would otherwise silently
   * edit the other, which is the kind of bug that takes an afternoon to believe. */
  function deckFrom(starter, opts) {
    const s = typeof starter === 'string' ? byId(starter) : starter;
    if (!s) return null;
    const o = opts || {};
    const media = mediaMap(o.media);
    const questions = JSON.parse(JSON.stringify(s.questions));

    questions.forEach((q, qi) => {
      /* The picture goes in the media box the editor already shows — same field a
       * teacher types a URL into — so it renders everywhere and can be swapped or
       * cleared without knowing it came from us. */
      const put = (target, key, metaKey, rec) => {
        if (!rec || !rec.url) return;
        target[key] = rec.url;
        target[metaKey] = { term: rec.term || '', source: rec.source || '',
                            alt: rec.alt || '', still: rec.still || '', id: rec.id || '' };
      };
      put(q, 'image', 'imageGif', media['q' + qi]);
      delete q.gifTerm;
      (q.options || []).forEach((op, oi) => {
        put(op, 'img', 'imgGif', media['q' + qi + 'o' + oi]);
        delete op.gifTerm;
      });
    });

    return {
      name: s.name,
      productType: s.product,
      questions,
      createdAt: o.now || Date.now(),
      sessionCode: o.sessionCode || null,
      // Marks it as something we supplied. Lets the UI offer "remove the example"
      // later without guessing which decks the user actually made.
      fromStarter: s.id,
    };
  }

  const forProduct = (product) => STARTERS.filter(s => s.product === product);

  return { STARTERS, byId, deckFrom, forProduct, mediaSlots };
});
