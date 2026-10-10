# PollSlide Companion 1.3.6 (build 12) — how to validate it

Live today: **1.3.5 (build 11)**. 1.3.6 adds two things and changes nothing else:

1. **Control-Option-R reveals the answer** (and a "Reveal Answer" item in the menu).
2. **Five more languages** in the app's own menus and dialogs: Dutch, Japanese, Chinese, Arabic, Hindi (11 in all).

Files changed: `L10n.swift`, `PollSlideCompanionApp.swift`, `PairingView.swift`, and the version in the project file.
A copy of the 1.3.5 source is in the release folder (`~/Documents/PollSlide Companion Releases/1.3.5 (build 11)/source-…zip`) if you ever need to go back.

What I checked: it compiles (Debug, unsigned). What I could NOT check: pressing the hotkey in a running, signed app. That is test B below.

---

## A. Build a test copy (5 minutes, nothing is published)

1. Quit the PollSlide Companion that is running (menu bar icon → Quit).
2. Open `PollSlide Companion.xcodeproj` in Xcode.
3. Press **⌘R** (Run). The bar-chart icon appears in the menu bar.
4. Menu bar icon → **About PollSlide Companion** → it must say **Version 1.3.6 (build 12)**.

If macOS asks for Screen Recording again for the Xcode copy, allow it and use "Quit & Reopen".

## B. The reveal hotkey — the important test

Set up: open a quiz deck with a correct answer marked, start presenting in Keynote (or PowerPoint) with the QR slide on screen, so the companion window pops up. Answer from your phone.

| # | Do this | You should see |
|---|---|---|
| B1 | Keynote is in slideshow, companion window is showing a question. Press **Control-Option-R**. | The answer is revealed — exactly as if you had clicked Reveal in the window. Keynote does **not** change slide. |
| B2 | Look at your phone. | The phone shows the correct answer (same as a click on Reveal). |
| B3 | Go to the next question slide. | The new question opens **not** revealed. |
| B4 | Press Control-Option-R again on the new question. | It reveals. |
| B5 | Press **Control-Option-Y**. | The window hides. Press again: it comes back (unchanged from 1.3.5). |
| B6 | With the window **hidden**, press Control-Option-R. | Nothing happens (on purpose — it cannot reveal a question you cannot see). |
| B7 | Menu bar icon → **Reveal Answer**. | Same as B1. |
| B8 | Reset tallies in the presenter, then reveal again with the hotkey. | Reveal state clears on reset, and the hotkey reveals again. |
| B9 | A poll question with no correct answer: press Control-Option-R. | Same as clicking Reveal on that question; nothing breaks. |

If B1 fails but B7 works, the key combination is being taken by something else on your Mac — tell me what is running (see "Is Control-Option-R used by anything else?" below).

## C. Languages (optional, 2 minutes)

You have never had to do this because the app picks its language by itself: it follows your Mac. A Mac set to Dutch simply gets a Dutch menu. Since 1.3.5 there is also a **Language** item in the menu bar menu, for people who want a different language than their Mac's — that menu is all this check uses. Your Mac is in English, so without it you would never see the five new languages.

It is a quick look, not a requirement for the hotkey:

1. Menu bar icon → **Language**. The list now has 11 languages (it had 6), with "Automatic" at the top.
2. Pick **Nederlands** — the menu turns Dutch straight away.
3. Pick **العربية** — the menu is in Arabic and the companion window reads right to left.
4. Pick **Automatic** — you are back in English. Done.

If you would rather skip it: the only risk it covers is a language showing as boxes or question marks, and the text was checked by script for completeness. It was written by me, not read by a native speaker.

## D. Nothing else changed (the regression list)

- Pairing still works: Disconnect Account (Re-pair) → enter a new code → "Connected!".
- Auto-show: the window appears on a QR slide and hides on a slide without one.
- A question opened earlier in the session does **not** open already revealed.
- "Check for Updates…" opens the update page.

## E. Release (only after A–D pass)

1. Xcode: **Product → Archive** → Organizer → **Distribute App → Direct Distribution** → wait for "Ready to distribute" → **Export**.
2. Run (you type this — it uses your notary profile):

```bash
~/Documents/GitHub/PollSlide/scripts/mac-release/release-companion.sh "/path/to/exported/PollSlideCompanion.app" --publish
```

3. The script checks signing and notarization, builds the DMG, files the release, and puts the DMG and version on the website's download page. Push the website repo.
4. Admin → Health → **Mac companion** → set latest to **1.3.6** with a one-line note (e.g. "Reveal with Control-Option-R; five more languages"). Existing 1.3.5 users then see the update notice on the waiting screen.
5. Install the downloaded DMG on your Mac and repeat B1 and C1 on the real release.

To go back: `scripts/mac-release/rollback-companion.sh "1.3.5 (build 11)"`.

---

## Is Control-Option-R used by anything else?

What I checked on this Mac:

- **macOS system shortcuts** (`com.apple.symbolichotkeys`): nothing uses Control-Option with any key.
- **Keynote**: no Control-Option-R command. In a slideshow, plain R, B, W and the arrow keys are used — which is exactly why a plain "R" was not an option.
- **PowerPoint for Mac**: no Control-Option-R command that I know of.
- **The Companion itself**: only Control-Option-Y was registered before.

One real exception: **VoiceOver**. Control-Option is VoiceOver's own modifier, so while VoiceOver is switched on, Control-Option-R (and the existing Control-Option-Y) go to VoiceOver instead. A presenter who uses VoiceOver can use the "Reveal Answer" menu item or the button in the window. This is the same limitation 1.3.5 already has with Y.

I have not tested other third-party tools (window managers, launchers, remote-control software). If you run one of those with custom shortcuts, B1 is the test that tells you.
