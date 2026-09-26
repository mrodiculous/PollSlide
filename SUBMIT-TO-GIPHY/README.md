# GIPHY Production key — what to upload

GIPHY dashboard → your app → **Upgrade to Production**. The form asks for three things:

| Form field | Upload this file |
|---|---|
| **Video of your app in action** (required, max 25 MB) | `1-app-demo-video.mp4` (1:36, 15 MB) |
| **Screenshot of your app's features + the GIPHY integration** (optional) | `2-screenshot-app-with-giphy.png` |
| **Screenshot with the 'Powered by GIPHY' attribution** (optional) | `3-screenshot-powered-by-giphy.png` |

## What the video shows (every screen in PollSlide that uses GIPHY)

1. **GIF picker on a question** (0:09): search "alarm clock", the results come from GIPHY, the footer says **Powered by GIPHY** (zoomed in), and a GIF is inserted into the question.
2. **GIF picker on an answer** (0:21): the same search, for one answer.
3. **GIFs for a whole deck** (0:36): the one-click fill, the review list, and the line "Powered by GIPHY, with safe search locked on" (zoomed in).
4. **The GIF is sent** (0:51): the quiz is presented. The GIFs appear on the big screen, credited "GIFs via GIPHY" (zoomed in), and on an audience member's phone.
5. **LoopSlide "Add media"** (1:11): GIF search in LoopSlide, with "Powered by GIPHY" under the results (zoomed in).

## If GIPHY asks questions, here are the answers

- **How do you use the API?** Search only (`/v1/gifs/search`), called from our server, so the key is never in the browser. The content rating is fixed at **G** on the server and can't be changed by users. Presenters pick a GIF, or review auto-picked ones, before anything is shown to an audience.
- **Where do you show attribution?** "Powered by GIPHY" is shown in every search interface (the question and answer picker, the whole-deck GIF panel, LoopSlide's Add media). The presenting screen also shows "GIFs via GIPHY".
- **Expected volume:** each search is made by a presenter while building a presentation. A 30-question quiz with GIFs on every question and answer uses about 150 searches.

## One thing to check before you submit

The form links to GIPHY's official **attribution marks** (their logo image). PollSlide currently credits GIPHY in **text** ("Powered by GIPHY"). If the reviewer asks for the official mark, download it from the link on the form, send it to me, and I'll put it in the picker and panels. It's a small change.

To re-record after the app changes: `node scripts/video/record.js giphy-review`
