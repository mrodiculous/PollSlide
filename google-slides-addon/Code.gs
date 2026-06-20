/**
 * PollSlide — Google Slides add-on (server side).
 *
 * Mirrors the PowerPoint add-in: a sidebar (Sidebar.html) signs the presenter in,
 * lists their PollSlide presentations, shows live results, and inserts a question's
 * QR code onto the current slide. Live data comes straight from Firebase inside the
 * sidebar; this server file only handles the menu, the sidebar, and slide edits.
 */

function onOpen() {
  SlidesApp.getUi()
    .createMenu('PollSlide')
    .addItem('Open live results', 'showSidebar')
    .addToUi();
}

function onInstall(e) { onOpen(); }

// Editor add-on entry (classic) — show the sidebar.
function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('PollSlide');
  SlidesApp.getUi().showSidebar(html);
}

// Workspace add-on homepage card (when launched from the side panel) — point users
// at the sidebar via the menu. (Classic sidebar is the richer experience.)
function onHomepage(e) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('PollSlide').setSubtitle('Live polls, quizzes & surveys'))
    .addSection(CardService.newCardSection().addWidget(
      CardService.newTextParagraph().setText('Open <b>Extensions → PollSlide → Open live results</b> to sign in, see live results, and drop a question’s QR code onto your slide.')
    ))
    .build();
}

/**
 * Insert a QR image (passed as a data URL from the sidebar) onto the current slide,
 * sized and placed in the bottom-right corner. Returns true on success.
 */
function insertQrOnSlide(dataUrl) {
  var pres = SlidesApp.getActivePresentation();
  if (!pres) throw new Error('No active presentation.');
  var sel = pres.getSelection();
  var page = sel ? sel.getCurrentPage() : null;
  var slide = (page && page.getPageType && page.getPageType() === SlidesApp.PageType.SLIDE)
    ? page.asSlide()
    : pres.getSlides()[0];
  if (!slide) throw new Error('No slide to add the QR to.');

  var b64 = String(dataUrl).split(',')[1];
  if (!b64) throw new Error('Bad image data.');
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', 'pollslide-qr.png');

  var size = 110; // points
  var img = slide.insertImage(blob);
  img.setWidth(size).setHeight(size);
  img.setLeft(pres.getPageWidth() - size - 20);
  img.setTop(pres.getPageHeight() - size - 20);
  return true;
}
