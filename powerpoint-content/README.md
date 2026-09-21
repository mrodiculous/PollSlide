# PollSlide LIVE — PowerPoint **content** add-in

**Live results rendered inside the slide, visible while you present.**

This folder is one product. It is **not** the same add-in as the task pane.

| | Task pane add-in | **This — content add-in** |
|---|---|---|
| Files | `/powerpoint.html` (repo root) | `powerpoint-content/` (this folder) |
| Served at | `app.pollslide.com/powerpoint` | `app.pollslide.com/powerpoint-content` |
| Manifest | `/powerpoint-manifest.xml` (root) | `manifest.xml` (here) |
| Manifest type | `TaskPaneApp` | `ContentApp` |
| Add-in Id | `7b3f9a14-…8e10` | `6a2cf181-…2599` |
| Where it appears | sidebar, beside the slides | **object on the slide** |
| Survives Slide Show | **no** — panes belong to the editing window | **yes** — this is the point |
| Job | authoring: pick a question, insert a QR | display: live results on the slide |
| AppSource offer | existing (rejected 09/17, fixable) | new, not yet submitted |

Microsoft does not allow one add-in to be both: the task-pane runtime *"cannot be
combined with a content add-in"*, and in the XML manifest `xsi:type` is one or the
other. Two add-ins, two Ids, two offers. Never reuse the other's `<Id>` — the store
would treat this as an update to that product and replace it.

## How it behaves

**Edit view** — the presenter clicks the object, signs in, picks a presentation and a
question. That binding is saved to this instance.

**Slide Show** — it renders results only: question, live tally, animated bars, the
correct answer on reveal, confetti. No sign-in, no chrome.

It needs no sign-in while presenting because `database-rules.json` grants
`.read: true` on `sessions/<code>`, so results are public. A login box on a slide in
front of a room would be indefensible.

## The binding problem, and how it is handled

Each embedded instance must remember *its own* question, so slide 3 and slide 7 can
show different ones. Office document settings are documented as per-instance for
content add-ins, which is the right store.

**But** `settings.get` is reported to return `null` in PowerPoint **on the web** while
in presentation mode ([office-js#3406](https://github.com/OfficeDev/office-js/issues/3406),
closed "not planned"). Losing the binding exactly when you present would make the
product pointless, so it resolves through a chain and re-caches whatever it finds:

1. document settings — the real store
2. `localStorage`, keyed by `Office.context.partitionKey` — survives the web null
3. the slide's notes marker `<!-- pollslide:CODE/idx -->` — written by the task pane

One visit in edit view arms presentation mode even if settings go dark there.

## Known Office limitations (not our bugs)

- **Clicking the object during a show captures focus** and blocks advancing until you
  click outside ([office-js Q&A](https://learn.microsoft.com/en-us/answers/questions/1149707/)).
  Mostly harmless here: results are display-only, nobody needs to click them.
- **Copy/pasting a slide** containing a content add-in can make `settings.get` return
  another instance's values on the web
  ([office-js#2765](https://github.com/OfficeDev/office-js/issues/2765)). If a pasted
  slide shows the wrong question, rebind it in edit view.
- `disableSnapshot` — Office otherwise saves a static snapshot into the file, which
  would look like frozen results to anyone opening the deck without the add-in.

## Sideloading to test

PowerPoint on the web is easiest (desktop sideloading is flaky):

1. office.com → PowerPoint → new presentation
2. **Insert → Add-ins → Upload My Add-in** → `manifest.xml`
3. **Insert → Add-ins → My Add-ins** → pick **PollSlide LIVE** — it drops **onto the
   slide** as an object, not as a pane
4. Click it, sign in, choose a question
5. Resize/position it like any shape; start the slide show

## Files

| File | Purpose |
|---|---|
| `index.html` | the add-in itself (served at `/powerpoint-content`) |
| `manifest.xml` | upload this to Partner Center |
| `README.md` | this |

`vercel.json` lists `powerpoint-content` in the no-cache header group — any new page
must be added there or returning users keep a stale copy.
