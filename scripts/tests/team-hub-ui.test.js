#!/usr/bin/env node
/* Team hub screens in presenter.html (2026-10-10): Library, Usage, bulk tools.
 * The server rules are proven in team-hub.test.js; this guards how the screens are wired,
 * and above all that the Members tab — the panel customers already use — is untouched.
 * Verified in a real browser on the stage server as an owner (Team Large and Team Small)
 * and as a plain member. Run: node scripts/tests/team-hub-ui.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const P = fs.readFileSync(path.join(ROOT, 'presenter.html'), 'utf8');
const fn = (sig) => { const i = P.indexOf(sig); return i < 0 ? '' : P.slice(i, P.indexOf('\n}\n', i) + 3); };

console.log('\nThe Members tab is the panel exactly as it was');
const rp = fn('function renderTeamPanel(){');
ok('renderTeamPanel still draws members, pending invites, the invite form and Leave', /const memHtml = /.test(rp) && /const invHtml = /.test(rp) && /id="teamInviteEmail"/.test(rp) && /teamLeave\(\)/.test(rp));
ok('…and gained exactly one line: the bulk tools appended underneath', (rp.match(/teamRenderBulk\(\)/g) || []).length === 1 && /\+ inviteForm \+ leave;\n  teamRenderBulk\(\);/.test(rp));
ok('the one-at-a-time actions are unchanged', ['async function teamInvite(){', 'async function teamRevoke(k){', 'async function teamRemove(uid){', 'async function teamSetRole(uid, role){', 'async function teamResend(k){'].every(s => P.includes(s)));
ok('Team admin opens on Members unless asked for a hub tab', /teamShowTab\(\['library','usage'\]\.includes\(tab\) \? tab : 'members'\);/.test(P));

console.log('\nTabs');
ok('three tabs: Members, Library, Usage', /data-tab="members"/.test(P) && /data-tab="library"/.test(P) && /data-tab="usage" id="teamTabUsage"/.test(P));
ok('Usage is hidden from plain members (and the server refuses them anyway)', /usageTab\.style\.display = teamCanManage\(\) \? '' : 'none';/.test(P) && /if \(!teamCanManage\(\)\) \{ thMsg\(tr\('Only owners and admins can see team usage\.'\)\); return; \}/.test(P));
ok('the header (team name + seats) is set on every tab', /document\.getElementById\('teamSub'\)\.textContent = ws\.data\.name;\n  \}\n  if \(tab === 'library'\)/.test(P));

console.log('\nBulk tools');
const rb = fn('function teamRenderBulk() {');
ok('only for managers, only on the Members tab', /teamTab !== 'members' \|\| !teamCanManage\(\)\) return;/.test(rb));
ok('Team Small sees what it is and where to get it — not dead buttons', /if \(!teamIsLarge\(\)\) \{/.test(rb) && /Part of Team Large\./.test(rb) && /openPlanPicker\(\)/.test(rb));
ok('a pasted list is CHECKED first; nothing is sent until the confirm button', /teamHub\('inviteMany', \{ text, preview: true \}\)/.test(P) && /Nothing is sent until you confirm\./.test(P));
ok('bulk remove never offers the owner or yourself, and asks before removing', /uid !== userId && m\.role !== 'owner'/.test(rb) && /if \(!confirm\(trp\(uids\.length, 'Remove \{n\} member from the team\?/.test(P));
ok('CSV export defuses spreadsheet formulas', /\/\^\[=\+\\-@\]\/\.test\(s\)/.test(P));

console.log('\nLibrary');
ok('using a deck goes through the same refresh-and-open steps as accepting a share', /const d = await teamHub\('libUse', \{ itemId: id \}\);\n    await loadPresentations\(\);/.test(P) && /if \(d\.presId\) selectPresentation\(d\.presId\);/.test(P));
ok('a plan-limit refusal offers the upgrade, not a red error', /if \(e\.data && e\.data\.limitReached\) \{[^}]*showUpgradePrompt\(/.test(P));
const use = fn('async function teamLibUse(id) {');
ok('a question is normalised BEFORE it goes near the deck (a list can arrive as an object)', use.indexOf('q.options = toQArr(q.options)') > 0 && use.indexOf('q.options = toQArr(q.options)') < use.indexOf('questions.push(q)'));
ok('…gets a fresh id, and is added through the same steps as "+ Add question"', /q\.id = PSQid\.fresh\(\);\n      questions\.push\(q\); presentations\[activePresId\]\.questions = questions;\n      syncStudyButtons\(\); selIdx = questions\.length - 1; renderQList\(\); renderEditor\(selIdx\); scheduleSave\(\);/.test(use));
ok('a study card cannot be dropped into a poll, nor a question into a study set', /\(q\.type === 'flashcard'\) !== study/.test(use));
ok('needs one of YOUR OWN decks open (never a deck you only collaborate on)', /if \(isCollabDeck\(activePresId\)\)/.test(use));
ok('"Add to team library" is in the deck menu for team plans only, never on a shared deck', /\(!isCollabDeck\(id\) && \['team_small','team_large'\]\.includes\(normalizeTier\(userTier\)\)\)\s*\? \[\{ icon: '📚', label: 'Add to team library'/.test(P));

console.log('\nUsage');
ok('the product mix uses the validated colour-blind-safe palette, in a fixed order', /const TH_MIX = \{ poll: \['#2a78d6', '#3987e5'\], survey: \['#eb6834', '#d95926'\], quiz: \['#1baf7a', '#199e70'\], study: \['#eda100', '#c98500'\] \};/.test(P));
ok('…and every segment is also labelled with its count (never colour alone)', /class="th-legend"/.test(P) && /thTypeName\(k\)\} <b>\$\{thNum\(t\.byType\[k\]\)\}<\/b>/.test(P));
ok('the trend has a readable hover readout and an accessible label', /function thTrendHover\(i\)/.test(P) && /role="img" aria-label=/.test(P));
ok('the privacy promise is on the screen', /never what anyone in an audience answered, and never an audience member’s name\./.test(P));

console.log('\nSafety');
const hub = P.slice(P.indexOf('// TEAM HUB (2026-10-10)'), P.indexOf('// On login: if this email was invited'));
const raw = [...hub.matchAll(/\$\{(i|m|r|d|p|q|inv|item)\.(title|email|name|by|text|front|back|note)\b[^}]*\}/g)].map(m => m[0]).filter(x => !/escapeHtml|escAttr/.test(x));
ok('every name, title and email is escaped before it reaches the page', raw.length === 0, raw);
ok('all hub requests go through one function that keeps the server\'s status and reply', /async function teamHub\(action, payload\)/.test(hub) && /err\.status = r\.status; err\.data = d \|\| \{\};/.test(hub));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
