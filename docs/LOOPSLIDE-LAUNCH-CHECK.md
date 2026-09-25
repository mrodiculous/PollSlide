# LoopSlide — the 20-minute launch check

Everything below has automated tests (`node scripts/qa.js`) and was clicked through in a
browser against a stand-in database. What automated testing **cannot** prove is the part
that needs a real signed-in account, real devices and the real AI providers — that is this
list. Do it once after each deploy that touches LoopSlide.

## 0. Deploy order (every time rules change)
1. Push the app repo and the website repo.
2. Publish `database-rules.json` in the Firebase console.
3. Wait for Vercel to finish (1–2 min).

## 1. Studio (laptop, signed in) — 8 min
- [ ] app.pollslide.com/loop → **+ New loop** → **+ Question** adds a question (the v255 bug)
- [ ] **✨ Draft with Polly** → topic "space" → 5 questions + a "💡 Did you know?" card appear, marked ✨ Made with AI
- [ ] **🖼 Add media** on a question → a GIF search shows results with "Powered by GIPHY/Tenor" → pick one
- [ ] **🖼 Add media** → **⬆ Upload a photo or video** → your own picture appears
- [ ] **🎮 Game extras**: tick *Table vs table*, type 3 team names; add a reward (text + code)
- [ ] **Publish** → it asks for organiser, contact and an official rules link (the reward is a prize) → fill them → publishes
- [ ] a few seconds later: toast "Translations for players are ready"
- [ ] switch the Studio language (top right) → the Studio is translated

## 2. TV — 4 min
- [ ] On a TV or a second browser: **pollslide.com/tv** → a 6-letter code and a QR
- [ ] Scan the QR with your phone → sign in → pick the loop → **Pair** → the TV starts playing
- [ ] Studio **📺 Screens**: rename it, switch loops, then **Unpair** → the TV goes back to its code

## 3. Phone — 6 min (use a phone set to another language, e.g. Spanish)
- [ ] Scan the QR on the TV → the join screen is in Spanish, with the organiser and the reward shown
- [ ] Pick a team, nickname and emoji → play
- [ ] A question shows in Spanish with "🌐 Traducción automática"; answers work
- [ ] Tap **⚡ Double points**, answer right → points doubled; the button is gone for the rest of the round
- [ ] Tap reactions → they float up the TV; tapping fast is limited to one every ~1.5 s
- [ ] Right answer → confetti (and a buzz on Android; iPhones don't allow web pages to vibrate)
- [ ] On a leaderboard: badges listed, team position shown, **📣 Share my rank** opens the share sheet (or shows the image to save)
- [ ] If you're in the top places: the reward card with the code, your name and a ticking clock
- [ ] TV: the team board beside the players, the podium on the overall board, 🔥/🏅 by names

## 4. Clean up
- [ ] Studio → **🗑 Delete loop** → the TV returns to its pairing code

If anything fails, note the step number and what you saw; Admin → Errors will usually
already have the details.

---

# Supporting LoopSlide — quick answers

| They say | Answer |
|---|---|
| "The TV shows a code again" | It was unpaired (or its loop deleted). Pair it again from 📺 Screens. |
| "The TV keeps asking to pair" | Its browser isn't keeping settings (private/guest mode). Turn that off, or use a Fire TV Stick. |
| "The TV is black / says the browser is too old" | TVs from about 2018 or newer. Otherwise a Fire TV Stick (Silk browser). |
| "Players can't join — 'This game is full'" | Free plans take 25 players per leaderboard; it frees up when the board resets. Upgrade for unlimited. |
| "I can't add more questions" | Slides (questions + cards) per loop: Free 10, Pro 20, Team Small 40, Team Large 150. |
| "I can't publish another loop / pair another TV" | Loops: 1 / 5 / 20 / 80. TVs: 1 / 3 / 10 / 40. Delete or unpair one, or upgrade. |
| "Polly stopped working" | The plan's monthly Polly allowance is used up (pictures count too). Credits or an upgrade. |
| "Questions aren't translated" | Translation runs after publishing and takes a few seconds; the original shows until then. It needs the "Translate questions for players" box ticked. |
| "Someone has a rude nickname" | Studio → 👥 Players & moderation → Remove. They vanish from the screen and can't react or play. |
| "Staff: is this reward real?" | The player's phone shows their name, the code and a ticking clock. A screenshot's clock doesn't move. |

Where things live: `loop.html` (Studio), `screen.html` (TV), `play.html` (phones), `tv.html`
(pairing), `loop-engine.js` (rules of the game), `loop-i18n.js` (languages),
`api/loop-translate.js`, `api/loop-sweep.js` (nightly clean-up), tests in
`scripts/tests/loopslide.test.js`.
