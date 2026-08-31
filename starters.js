/* PollSlide — something to open on day one.
 * ---------------------------------------------------------------------------
 * The first screen used to be "No presentations yet" and one button. Someone
 * evaluating the product at 9pm had to invent a quiz before they could see what it
 * does — and the thing they most want to see (a phone answering, a bar chart moving,
 * a reveal) is on the far side of that work.
 *
 * These are three real decks, one per product, each openable and presentable in a
 * click. They are written to be USED, not to be a demo: an icebreaker that works on
 * any audience, a quiz whose questions have real answers, a feedback survey a trainer
 * could send today. A starter that is obviously filler teaches someone that the
 * product is filler.
 *
 * WHY THREE AND NOT TEN: the point is to remove a blank page, not to open a catalogue.
 * Three is enough to show that Poll, Quiz and Survey are different things.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PSStarters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const mc = (text, options, correctAnswer) => {
    const q = { text, type: 'multiple_choice', options: options.map(t => ({ text: t })) };
    if (correctAnswer !== undefined) q.correctAnswer = correctAnswer;
    return q;
  };
  const words = (text) => ({ text, type: 'word_cloud', options: null });
  const scale = (text, low, high) => ({ text, type: 'rating', ratingLabels: { low, high }, options: null });
  const open = (text) => ({ text, type: 'free_text', options: null });

  const STARTERS = [
    {
      id: 'icebreaker',
      product: 'poll',
      icon: '🎪',
      name: 'Room warm-up',
      blurb: 'Five questions that work on any audience. Good for the first two minutes while people are still arriving.',
      takes: 'about 3 minutes',
      questions: [
        words('In one word, how are you arriving today?'),
        mc('How far did you travel to be here?', ['I live nearby', 'Across town', 'Another city', 'Another country']),
        mc('Coffee or tea?', ['Coffee', 'Tea', 'Neither', 'Whatever is closest']),
        scale('How familiar are you with today’s topic?', 'Never heard of it', 'I could teach it'),
        open('What is one thing you want to leave here knowing?'),
      ],
    },
    {
      id: 'quiz',
      product: 'quiz',
      icon: '🏆',
      name: 'Example quiz — general knowledge',
      blurb: 'Six graded questions with real answers, so you can watch scoring, the reveal and the leaderboard work.',
      takes: 'about 5 minutes',
      questions: [
        mc('Which planet has the most moons?', ['Saturn', 'Jupiter', 'Neptune', 'Uranus'], 0),
        mc('What is the powerhouse of the cell?', ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi body'], 1),
        mc('In what year did the Berlin Wall come down?', ['1987', '1989', '1991', '1993'], 1),
        mc('Which of these is NOT a programming language?', ['Rust', 'Kotlin', 'Cobalt', 'Elixir'], 2),
        mc('How many time zones does China officially use?', ['One', 'Three', 'Five', 'Eight'], 0),
        open('Which question was hardest, and why?'),
      ],
    },
    {
      id: 'feedback',
      product: 'survey',
      icon: '📋',
      name: 'Session feedback',
      blurb: 'Send this afterwards by link or email. Short enough that people actually finish it.',
      takes: 'about 2 minutes to answer',
      questions: [
        scale('How useful was today?', 'Not useful', 'Extremely useful'),
        scale('How was the pace?', 'Too slow', 'Too fast'),
        mc('What would you most like more of?', ['Worked examples', 'Discussion', 'Practice time', 'Q&A']),
        open('What is one thing we should change next time?'),
        open('Anything else you want to tell us?'),
      ],
    },
  ];

  const byId = (id) => STARTERS.find(s => s.id === id) || null;

  /* Build the deck object. Questions are deep-copied so two starters created from the
   * same template never share option arrays — editing one would otherwise silently
   * edit the other, which is the kind of bug that takes an afternoon to believe. */
  function deckFrom(starter, opts) {
    const s = typeof starter === 'string' ? byId(starter) : starter;
    if (!s) return null;
    const o = opts || {};
    return {
      name: s.name,
      productType: s.product,
      questions: JSON.parse(JSON.stringify(s.questions)),
      createdAt: o.now || Date.now(),
      sessionCode: o.sessionCode || null,
      // Marks it as something we supplied. Lets the UI offer "remove the examples"
      // later without guessing which decks the user actually made.
      fromStarter: s.id,
    };
  }

  const forProduct = (product) => STARTERS.filter(s => s.product === product);

  return { STARTERS, byId, deckFrom, forProduct };
});
