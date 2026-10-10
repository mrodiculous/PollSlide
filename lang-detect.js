/* PollSlide — which of our 11 languages is this deck written in?
 * ---------------------------------------------------------------------------
 * WHY (2026-10-10): a deck's language was only ever set by the picker inside the Polly
 * dialog. A deck typed by hand in Spanish stayed marked "English", so the phones were told
 * the source was English — an English phone showed the Spanish untranslated, and Spanish
 * phones were asked to "translate" Spanish. Rod hit it presenting in Spanish with an
 * English interface. The interface language says nothing about the deck's language; the
 * QUESTIONS do, so we read them.
 *
 * HOW: no network, no AI — it runs on every save.
 *   • Japanese, Chinese, Arabic and Hindi are identified by their script.
 *   • The seven Latin-script languages by their commonest function words, plus a few
 *     letters that settle close calls (ñ ¿ → Spanish, ß → German, ã õ → Portuguese…).
 * It answers only when it is SURE: enough words, and a clear lead over the runner-up.
 * A short or mixed deck returns confident:false and the deck's language is left alone —
 * a wrong automatic switch would be worse than none.
 * --------------------------------------------------------------------------- */
(function (root) {
  'use strict';

  var WORDS = {
    en: 'the of and to in is that it you for on with as are this what which who how does do not have has was were be your our from by an at or if can will would should there their they we when where why about into than then more most one all any',
    es: 'el la los las de del que y en un una es por con para no se su sus al lo como más pero qué cuál cuáles cuánto cuántos quién cómo dónde cuándo está están son fue ser este esta estos estas nos le les muy también entre sobre hay tu tus mi o si ya porque desde hasta cada todo todos',
    de: 'der die das und ist nicht zu den dem des ein eine einer eines einem einen mit auf für von im in es sich auch als an nach wie bei oder aus wird werden hat haben sind war wir ihr sie was welche welcher welches wer wo wann warum über durch zum zur noch nur aber wenn dass kann',
    fr: 'le la les de des du un une et est en que qui dans pour pas sur au aux avec ce cette ces se sa son ses plus par ne ou où il elle ils elles nous vous je tu quel quelle quels quelles comment pourquoi quand sont été être avoir fait mais comme tout tous très aussi leur leurs entre',
    pt: 'o a os as de do da dos das que e em um uma é para com não se por mais como mas ao aos à às no na nos nas seu sua seus suas qual quais quem onde quando quanto são foi ser este esta estes estas isso também muito entre sobre já ou você tem há cada todo todos pelo pela',
    it: 'il lo la i gli le di del della dei delle degli che e è in un una uno per con non si su al alla ai alle come più ma anche quale quali chi dove quando perché sono era essere questo questa questi queste nel nella nei nelle da dal dalla ha hanno molto tra fra o se già ogni tutto tutti',
    nl: 'de het een en van in is dat op te zijn met voor niet aan er ook als bij door om maar naar uit nog wel wat welke wie waar wanneer waarom hoe je jij u wij zij ze deze dit die heeft hebben was werd worden wordt over tot onder tussen kan zal zou meer veel geen al of'
  };
  // Letters that are strong evidence on their own (weight counted as extra word hits).
  var MARKS = { es: /[ñ¿¡]/g, de: /[ßäöü]/g, pt: /[ãõ]/g, fr: /[œçêèàùâîôû]/g, it: /[ìòù]|\bperché\b|\bcioè\b/g, nl: /\bij|ij\b|\b(een|het)\b/g };
  var SETS = {};
  Object.keys(WORDS).forEach(function (l) { SETS[l] = {}; WORDS[l].split(' ').forEach(function (w) { SETS[l][w] = 1; }); });

  var SCRIPT = [
    ['ja', /[぀-ヿ]/g],                 // hiragana + katakana: Japanese, even with kanji around it
    ['ar', /[؀-ۿݐ-ݿ]/g],
    ['hi', /[ऀ-ॿ]/g],
    ['zh', /[一-鿿]/g]                  // Han with no kana (checked after ja)
  ];

  function plain(t) { return String(t == null ? '' : t).replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, ' '); }

  /* texts: an array of strings (question text, options, card fronts and backs).
     Returns { lang, confident, words, scores } — lang is null when there is nothing to go on. */
  function detect(texts) {
    var all = plain((Array.isArray(texts) ? texts : [texts]).filter(Boolean).join(' \n '));
    var letters = (all.match(/[^\s\d.,;:!?¿¡'"“”‘’()\[\]{}\-–—_\/\\@#$%^&*+=<>|~`]/g) || []).length;
    if (letters < 12) return { lang: null, confident: false, words: 0, scores: {} };

    // 1) Non-Latin scripts decide by share of the letters.
    var kana = (all.match(SCRIPT[0][1]) || []).length;
    for (var i = 0; i < SCRIPT.length; i++) {
      var n = (all.match(SCRIPT[i][1]) || []).length;
      if (SCRIPT[i][0] === 'zh' && kana > 0) continue;
      if (SCRIPT[i][0] === 'ja' ? (n >= 4 && n / letters > 0.08) : (n / letters > 0.3)) {
        return { lang: SCRIPT[i][0], confident: true, words: letters, scores: {} };
      }
    }

    // 2) Latin script: count function words.
    var lower = all.toLowerCase();
    var tokens = lower.match(/[a-zà-öø-ÿœ]+(?:['’][a-zà-öø-ÿœ]+)?/g) || [];
    var scores = {}, langs = Object.keys(SETS);
    langs.forEach(function (l) { scores[l] = 0; });
    tokens.forEach(function (w) {
      var parts = w.split(/['’]/);                       // l'eau, d'un, qu'il → count the article
      parts.forEach(function (p) { langs.forEach(function (l) { if (SETS[l][p]) scores[l] += 1; }); });
    });
    Object.keys(MARKS).forEach(function (l) { var m = lower.match(MARKS[l]); if (m) scores[l] += Math.min(6, m.length) * (l === 'nl' ? 0.5 : 1.5); });

    var ranked = langs.slice().sort(function (a, b) { return scores[b] - scores[a]; });
    var top = ranked[0], second = ranked[1];
    if (!scores[top]) return { lang: null, confident: false, words: tokens.length, scores: scores };
    // Sure = enough text, enough evidence, and a clear lead.
    var confident = tokens.length >= 8 && scores[top] >= 4 && scores[top] >= scores[second] * 1.35 + 1;
    return { lang: top, confident: confident, words: tokens.length, scores: scores };
  }

  /* Every string in a deck that the audience will read — skipping questions the presenter
     locked to their original language (those are often deliberately in ANOTHER language). */
  function deckTexts(questions) {
    var out = [];
    var list = Array.isArray(questions) ? questions : (questions && typeof questions === 'object' ? Object.keys(questions).map(function (k) { return questions[k]; }) : []);
    list.forEach(function (q) {
      if (!q || typeof q !== 'object' || q.noTranslate) return;
      [q.text, q.front, q.back].forEach(function (t) { if (t) out.push(String(t)); });
      var opts = Array.isArray(q.options) ? q.options : (q.options && typeof q.options === 'object' ? Object.keys(q.options).map(function (k) { return q.options[k]; }) : []);
      opts.forEach(function (o) { if (o && o.text) out.push(String(o.text)); });
    });
    return out;
  }

  var api = { detect: detect, deckTexts: deckTexts, LANGS: Object.keys(WORDS).concat(['ja', 'zh', 'ar', 'hi']) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PSLangDetect = api;
})(typeof window !== 'undefined' ? window : null);
