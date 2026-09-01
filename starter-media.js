/* PollSlide — the vetted pictures for the demo deck.
 * ---------------------------------------------------------------------------
 * GENERATED, THEN LOOKED AT. Produced by running the starter's search terms through
 * our own /api/gif-search (the same endpoint the app uses, so the key stays in Vercel
 * and never lands on anyone's disk), and then reviewed by eye before shipping.
 *
 * WHY THIS FILE EXISTS AT ALL, instead of the deck searching on first run:
 * this deck opens the same way for every new account, often in front of a class before
 * the teacher has seen the product themselves. A live search would hand each of them a
 * different, unreviewed set of images, and a G rating is a filter rather than a
 * promise. Fixed and inspected is the only version of this that is safe to ship.
 *
 * Keys are slots: 'q3' is the fourth question's own media box, 'q3o1' its second
 * choice. starters.js copies these into `image`/`img` — the same boxes a teacher types
 * a URL into — so they render everywhere and can be swapped or cleared normally.
 *
 * An empty map is not a failure. The deck is still a working five-question quiz; it
 * just arrives without pictures, which is the right outcome if this was never filled
 * in or failed to deploy.
 *
 * To (re)generate: sign in to the app, then run the collector in scripts/collect-starter-media.md.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PSStarterMedia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  return {
    // Filled by the collector. Shape per slot:
    //   { url, still, alt, term, source, id }
  };
});
