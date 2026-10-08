#!/usr/bin/env node
/* The phone says Correct / Partly right / Not quite once the presenter reveals (2026-10-07).
 * Verified end to end on the stage server (correct, wrong, next question, reload after
 * answering, presenter reset). This guards the properties that make it safe to add to a
 * live audience page. Run: node scripts/tests/phone-reveal.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const A = fs.readFileSync(path.join(ROOT, 'answer.html'), 'utf8');
const P = fs.readFileSync(path.join(ROOT, 'presenter.html'), 'utf8');
const block = A.slice(A.indexOf('let _rvRef = null'), A.indexOf('function goToQuestion(idx){'));

console.log('\nPhone: did I get it right?');
ok('the feature exists', /function renderRevealResult\(/.test(block) && /function startRevealWatch\(/.test(block));
ok('it is READ-ONLY — no set/update/push/remove/transaction anywhere in it', !/\.(set|update|push|remove|transaction)\(/.test(block.replace(/classList\.remove/g, '').replace(/el\.remove\(\)/g, '')));
ok('it listens to this question\'s own qstate node, keyed by the bucket the answer went to', /qstate\/\$\{qid\}`\)/.test(block) && /const qid = _rvQid = STABLE_QID/.test(block));
ok('…which is the node and the word the presenter writes on reveal', /qstate\/\$\{liveQId\}`\)\.update\(update\)/.test(P) && /phase: 'revealed'/.test(P) && /_rvPhase === 'revealed' \|\| _rvPhase === 'post_reveal'/.test(block));
ok('only graded multiple-choice questions get a verdict (polls, surveys, open text untouched)', /function _rvGradable\(q\)/.test(block) && /if \(!SESSION \|\| !STABLE_QID \|\| !_rvGradable\(questionData\)\) \{ stopRevealWatch\(\); return; \}/.test(block));
ok('the listener is stopped when the phone moves to another question', /function goToQuestion\(idx\)\{\n  if \(idx === Q_INDEX\) return;\n  stopRevealWatch\(\);/.test(A));
ok('it starts only after the bucket is derived from quiz_builder (the bucket invariant)', /STABLE_QID = PSQid\.bucket\(questionData, Q_INDEX, SESSION\); \} catch \(e\) \{\}\n  startRevealWatch\(\);/.test(A));
ok('a stale callback for an old question is ignored', /if \(qid !== STABLE_QID\) return;\n\s*const st = snap\.val\(\) \|\| \{\};\n\s*_rvPhase = st\.phase/.test(block) && /if \(qid !== STABLE_QID \|\| !\(_rvPhase/.test(block));
ok('a reset (phase back to live) takes the banner away', /if \(!shown\) \{ if \(el\) el\.remove\(\); return; \}/.test(block));
ok('the verdict is the phone\'s own score, kept at submit (no wait on the write)', /_rvMine = \{ isCorrect, submittedAt: Date\.now\(\) \};/.test(A));
ok('after a reload it reads its own response back, not anyone else\'s', /responses\/\$\{qid\}\/\$\{participantId\}/.test(block));
ok('the answer text is escaped before it is shown', /esc\(\(\(q\.options \|\| \[\]\)\[i\] \|\| \{\}\)\.text/.test(block));
ok('it is re-applied after every redraw that could wipe it', (A.match(/reapplyReveal\(\);/g) || []).length >= 4);
for (const l of ['es', 'de', 'fr', 'pt', 'it']) ok(l + ': the verdict and the already-answered screen are translated', new RegExp(`Object\\.assign\\(I18N\\.${l}, \\{ rvCorrect:`).test(A) && /alreadyAnswered:/.test(A));
ok('the already-answered screen no longer hard-codes English', /t\('alreadyAnswered'/.test(A) && /t\('nextQr'/.test(A));

console.log('\nStale-reveal guard (2026-10-08)');
ok('a reveal only counts if this phone saw the question open, or it was revealed after this phone answered', /const thisRun = _rvSawOpen \|\| \(_rvAt && mine && mine\.submittedAt && _rvAt >= Number\(mine\.submittedAt\) - 5000\);/.test(block) && /if \(!thisRun\)/.test(block));
ok('"saw it open" is set by any non-revealed phase and cleared on every question change', /if \(_rvPhase !== 'revealed' && _rvPhase !== 'post_reveal'\) _rvSawOpen = true;/.test(block) && /_rvSawOpen = false; _rvAt = 0;/.test(block));
ok('the presenter stamps revealedAt on reveal', /phase: 'revealed', revealedAt: Date\.now\(\)/.test(P));

console.log('\nMac companion + PowerPoint LIVE reach the phone too');
const C = fs.readFileSync(path.join(ROOT, 'companion.html'), 'utf8');
const pub = C.slice(C.indexOf('function publishCompanionReveal()'), C.indexOf('function forceReveal'));
ok('the companion publishes its reveal', pub.length > 50);
ok('…only in QR-targeted mode, for graded multiple choice', /if \(!phaseRef \|\| !session \|\| !qid \|\| !q\) return;/.test(pub) && /multiple_choice_multi/.test(pub) && /Array\.isArray\(ca\) && !ca\.length/.test(pub));
ok('…to the same qstate bucket the phone reads, after auth', /_authReady\.then\(\(\) => db\.ref\(`sessions\/\$\{session\}\/qstate\/\$\{qid\}`\)\.transaction\(/.test(pub));
ok('…in a transaction that never steps post_reveal back to revealed', /if \(cur && cur\.phase === 'post_reveal'\) return;/.test(pub) && /phase: 'revealed', revealedAt: Date\.now\(\)/.test(pub));
ok('…and is called at both companion reveal points (button + countdown end)', (C.match(/publishCompanionReveal\(\);/g) || []).length === 2 && /fireConfetti\(\); renderAll\(\); publishCompanionReveal\(\);/.test(C));
const PC = fs.readFileSync(path.join(ROOT, 'powerpoint-content', 'index.html'), 'utf8');
ok('PowerPoint LIVE (frozen, unchanged) already writes the phase word the phone reads', /qstate/.test(PC) && /'revealed'/.test(PC));

console.log('\nPresentSlide reaches the phone too (2026-10-08)');
const PR = fs.readFileSync(path.join(ROOT, 'present.html'), 'utf8');
const ppub = PR.slice(PR.indexOf('function publishPresentReveal(s)'), PR.indexOf('function publishPresentReveal(s)') + 1200);
ok('PresentSlide publishes its reveal from doReveal, for poll/quiz slides only (a study flip never publishes)', /else if\(slideHasPoll\(s\)\)\{_revealed=true; publishPresentReveal\(s\);\}/.test(PR) && /if\(s\.kind==='study'\)\{_revealed=!_revealed;\}/.test(PR));
ok('…graded multiple choice with a session only', /if\(!code\) return;/.test(ppub) && /multiple_choice_multi/.test(ppub) && /Array\.isArray\(ca\)&&!ca\.length/.test(ppub));
ok('…to the same bucket attachLive() counts answers from', /const qid=PSQid\.bucket\(q,\(q\.qIndex\|\|0\),code\);/.test(ppub) && /qId=PSQid\.bucket\(s\.question,\(s\.question\.qIndex\|\|0\),code\)/.test(PR));
ok('…in a transaction that never steps post_reveal back, and never throws into the show', /if\(cur&&cur\.phase==='post_reveal'\) return;/.test(ppub) && /phase:'revealed', revealedAt: Date\.now\(\)/.test(ppub) && /\.catch\(\(\)=>\{\}\);\n  \}catch\(e\)\{\}/.test(ppub));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
