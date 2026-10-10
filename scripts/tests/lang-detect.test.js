#!/usr/bin/env node
/* The deck's language comes from what is written in it (2026-10-10).
 * Rod presented a Spanish deck with an English interface; the deck was still marked
 * English, so phones were told the wrong source language. lang-detect.js reads the
 * questions. This checks all 11 languages, the close pairs, and — most important — the
 * cases where it must NOT answer. Run: node scripts/tests/lang-detect.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const D = require(path.join(ROOT, 'lang-detect.js'));
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const q = (text, ...opts) => ({ text, type: 'multiple_choice', options: opts.map(t => ({ text: t })) });

const DECKS = {
  en: [q('Which animal has three hearts?', 'Crab', 'Octopus', 'Dolphin'), q('What is the capital of Australia?', 'Sydney', 'Canberra', 'Perth'), q('How confident are you in the launch date?')],
  es: [q('¿Qué animal tiene tres corazones?', 'Cangrejo', 'Pulpo', 'Delfín'), q('¿Cuál es la capital de Australia?', 'Sídney', 'Canberra', 'Perth'), q('¿Qué tan seguro estás de la fecha de lanzamiento?')],
  de: [q('Welches Tier hat drei Herzen?', 'Krabbe', 'Krake', 'Delfin'), q('Was ist die Hauptstadt von Australien?', 'Sydney', 'Canberra', 'Perth'), q('Wie sicher bist du dir mit dem Starttermin?')],
  fr: [q('Quel animal a trois cœurs ?', 'Crabe', 'Pieuvre', 'Dauphin'), q('Quelle est la capitale de l’Australie ?', 'Sydney', 'Canberra', 'Perth'), q('Es-tu sûr de la date de lancement ?')],
  pt: [q('Que animal tem três corações?', 'Caranguejo', 'Polvo', 'Golfinho'), q('Qual é a capital da Austrália?', 'Sydney', 'Camberra', 'Perth'), q('Quão confiante está na data de lançamento?', 'Muito', 'Não muito')],
  it: [q('Quale animale ha tre cuori?', 'Granchio', 'Polpo', 'Delfino'), q('Qual è la capitale dell’Australia?', 'Sydney', 'Canberra', 'Perth'), q('Quanto sei sicuro della data di lancio? Perché?')],
  nl: [q('Welk dier heeft drie harten?', 'Krab', 'Octopus', 'Dolfijn'), q('Wat is de hoofdstad van Australië?', 'Sydney', 'Canberra', 'Perth'), q('Hoe zeker ben je van de lanceerdatum?')],
  ja: [q('心臓が3つある動物はどれですか？', 'カニ', 'タコ', 'イルカ'), q('オーストラリアの首都はどこですか？', 'シドニー', 'キャンベラ')],
  zh: [q('哪种动物有三颗心脏？', '螃蟹', '章鱼', '海豚'), q('澳大利亚的首都是哪里？', '悉尼', '堪培拉')],
  ar: [q('أي حيوان لديه ثلاثة قلوب؟', 'السلطعون', 'الأخطبوط', 'الدلفين'), q('ما هي عاصمة أستراليا؟', 'سيدني', 'كانبرا')],
  hi: [q('किस जानवर के तीन दिल होते हैं?', 'केकड़ा', 'ऑक्टोपस', 'डॉल्फ़िन'), q('ऑस्ट्रेलिया की राजधानी क्या है?', 'सिडनी', 'कैनबरा')],
};

console.log('\nAll 11 languages');
for (const [lang, deck] of Object.entries(DECKS)) {
  const r = D.detect(D.deckTexts(deck));
  ok(`${lang}: a three-question deck is recognised, with confidence`, r.lang === lang && r.confident === true, { got: r.lang, confident: r.confident, scores: r.scores });
}

console.log('\nRod\'s case, and close calls');
const rod = [q('¿Cuál de estos es un planeta?', 'Marte', 'La Luna', 'El Sol'), q('¿Cuántos continentes hay en el mundo?', 'Cinco', 'Siete'), q('Escribe una palabra que describa tu semana')];
ok('a Spanish deck is Spanish, whatever language the presenter\'s interface is in', D.detect(D.deckTexts(rod)).lang === 'es' && D.detect(D.deckTexts(rod)).confident);
ok('Portuguese is not mistaken for Spanish', D.detect(['Qual destas opções não é uma cor?', 'Como você descreveria a sua semana em uma palavra?', 'Quantos anos tem o seu cão? Não sei, mas é muito velho.']).lang === 'pt');
ok('Italian is not mistaken for Spanish', D.detect(['Quale di queste non è una città italiana?', 'Come descriveresti la tua settimana? Perché?', 'Quanti anni hanno i tuoi fratelli e le tue sorelle?']).lang === 'it');
ok('Dutch is not mistaken for German', D.detect(['Welke van deze steden ligt niet in Nederland?', 'Hoe zou je jouw week omschrijven? Waarom is dat zo?', 'Wat is het grootste land van de wereld?']).lang === 'nl');
ok('English with foreign names in the answers is still English', D.detect(D.deckTexts([q('Which of these is the capital of Spain?', 'Madrid', 'Barcelona', 'Sevilla'), q('Who painted the Mona Lisa?', 'Leonardo da Vinci', 'Michelangelo'), q('What is the largest country in the world?')])).lang === 'en');
ok('Japanese with many kanji is Japanese, not Chinese', D.detect(['日本の首都は東京です。世界で一番高い山は何ですか？']).lang === 'ja');

console.log('\nWhen it must stay silent');
ok('one short question is not enough to be sure', D.detect(['Madrid?']).confident === false);
ok('an empty deck gives no answer', D.detect(D.deckTexts([])).lang === null);
ok('numbers and symbols alone give no answer', D.detect(['2 + 2 = ?', '4', '5', '22']).lang === null);
const mixed = D.detect(['The cat sat on the mat and looked at the dog.', 'El gato se sentó en la alfombra y miró al perro.', 'What is the answer? ¿Cuál es la respuesta?']);
ok('an evenly mixed deck is not declared one language', mixed.confident === false, mixed);
const lesson = [Object.assign(q('¿Cómo se dice "dog" en español?', 'perro', 'gato'), { noTranslate: true }), q('Which animal has three hearts?', 'Crab', 'Octopus'), q('What is the capital of Australia? Is it Sydney or Canberra?'), q('How confident are you that the answer is right?')];
ok('questions locked to their original language are ignored (a Spanish lesson taught in English stays English)', D.detect(D.deckTexts(lesson)).lang === 'en');
ok('HTML and links in a question do not count as words', D.detect(['<b>https://example.com/the/of/and/to</b>']).lang === null);
ok('options stored as an object (as the database can return them) are still read', D.deckTexts([{ text: 'x', options: { 0: { text: 'uno' }, 1: { text: 'dos' } } }]).join('|') === 'x|uno|dos');

console.log('\nWired into the presenter');
const P = fs.readFileSync(path.join(ROOT, 'presenter.html'), 'utf8');
ok('the presenter loads lang-detect.js', /<script src="\/lang-detect\.js\?v=[a-z0-9]+"><\/script>/.test(P));
ok('the deck language is checked on every save, BEFORE the deck is written', /function autoDeckLanguage\(pres\)/.test(P) && P.indexOf('autoDeckLanguage(pres);') > 0 && P.indexOf('autoDeckLanguage(pres);') < P.indexOf('await db.ref(deckPath(activePresId)).set(pres);'));
ok('a language the presenter chose is never overridden', /if \(pres\.languageBy === 'user'\) return false;/.test(P) && /presentations\[activePresId\]\.languageBy = 'user';/.test(P));
ok('it only switches when the detector is sure', /if \(!d\.lang \|\| !d\.confident \|\| d\.lang === \(pres\.language \|\| 'en'\)\) return false;/.test(P));
ok('the deck menu shows the language and lets the presenter change it', /label: 'Language: ' \+ LANGUAGES\[p\.language \|\| 'en'\]/.test(P) && /function openDeckLanguage\(id\)/.test(P));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
