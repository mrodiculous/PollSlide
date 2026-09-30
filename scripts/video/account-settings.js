/* "Your account settings" — password, email, your data, deleting. Linked from the
 * help centre (pollslide.com/account-help) and sent by support to anyone who asks.
 *
 *   node scripts/video/record.js account-settings
 *
 * Filmed on the REAL presenter page (Account settings, 2026-09-30). The stage's sign-in
 * stub accepts any current password except "wrong", so the flows complete for real.
 */
module.exports = {
  id: 'account-settings',
  title: 'Your PollSlide account settings',
  previewLabel: 'Watch: change your password or email in 1 minute',
  // Email GIF highlights: [scene, offset s, seconds, speed, crop in stage px (16:9)]
  preview: [['open', 1.5, 2.2, 1.2, [330, 60, 1590, 769]], ['password', 1.0, 3.0, 1.6, [330, 120, 1590, 829]],
            ['email', 2.0, 3.0, 1.6, [330, 120, 1590, 829]], ['confirm', 1.0, 2.0, 1.0, [330, 60, 1590, 769]]],
  /* On-screen words per language (chips + title cards). The app's own words come from its
     translations (ui-lang.js) — the recording switches the app to the language. */
  t: {
    es: { h1: 'Tu <em>cuenta</em>,<br>a tu manera', sub: 'Contraseña · correo · tus datos', steps: ['🔑 Contraseña', '✉️ Correo', '⬇ Tus datos', '🗑 Eliminar'],
          c1: 'Abre los ajustes de la cuenta', c2: 'Cambia tu contraseña', c3: 'Cambia tu correo', c4: 'Confirma desde tu nuevo correo', c5: 'Descarga tus datos', c6: 'Elimina tu cuenta',
          oh1: 'Avatar → <em>⚙️ Ajustes de la cuenta</em>', osub: 'Contraseña · correo · tus datos · eliminar', help: '¿Necesitas ayuda?' },
    de: { h1: 'Dein <em>Konto</em>,<br>wie du willst', sub: 'Passwort · E-Mail · deine Daten', steps: ['🔑 Passwort', '✉️ E-Mail', '⬇ Deine Daten', '🗑 Löschen'],
          c1: 'Kontoeinstellungen öffnen', c2: 'Passwort ändern', c3: 'E-Mail ändern', c4: 'Im neuen Postfach bestätigen', c5: 'Daten herunterladen', c6: 'Konto löschen',
          oh1: 'Avatar → <em>⚙️ Kontoeinstellungen</em>', osub: 'Passwort · E-Mail · deine Daten · löschen', help: 'Brauchst du Hilfe?' },
    fr: { h1: 'Ton <em>compte</em>,<br>comme tu veux', sub: 'Mot de passe · e-mail · tes données', steps: ['🔑 Mot de passe', '✉️ E-mail', '⬇ Tes données', '🗑 Supprimer'],
          c1: 'Ouvre les paramètres du compte', c2: 'Change ton mot de passe', c3: 'Change ton e-mail', c4: 'Confirme depuis ta nouvelle boîte', c5: 'Télécharge tes données', c6: 'Supprime ton compte',
          oh1: 'Avatar → <em>⚙️ Paramètres du compte</em>', osub: 'Mot de passe · e-mail · tes données · supprimer', help: 'Besoin d’aide ?' },
    pt: { h1: 'A sua <em>conta</em>,<br>à sua maneira', sub: 'Palavra-passe · email · os seus dados', steps: ['🔑 Palavra-passe', '✉️ Email', '⬇ Os seus dados', '🗑 Eliminar'],
          c1: 'Abra as definições da conta', c2: 'Altere a palavra-passe', c3: 'Altere o email', c4: 'Confirme no novo email', c5: 'Descarregue os seus dados', c6: 'Elimine a conta',
          oh1: 'Avatar → <em>⚙️ Definições da conta</em>', osub: 'Palavra-passe · email · os seus dados · eliminar', help: 'Precisa de ajuda?' },
    it: { h1: 'Il tuo <em>account</em>,<br>a modo tuo', sub: 'Password · email · i tuoi dati', steps: ['🔑 Password', '✉️ Email', '⬇ I tuoi dati', '🗑 Elimina'],
          c1: 'Apri le impostazioni account', c2: 'Cambia la password', c3: 'Cambia l’email', c4: 'Conferma dalla nuova casella', c5: 'Scarica i tuoi dati', c6: 'Elimina l’account',
          oh1: 'Avatar → <em>⚙️ Impostazioni account</em>', osub: 'Password · email · i tuoi dati · elimina', help: 'Ti serve una mano?' },
  },
  scenes: [
    {
      id: 'intro',
      say: "Here's how to manage your PollSlide account: your password, your email address, and your data.",
      pre: async (D) => {
        D.hideCursor();
        const T = window.VT || {};
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>${T.h1 || 'Your <em>account</em>,<br>your way'}</h1>
          <p>${T.sub || 'Password · email · your data'}</p>
          <div class="steps">${(T.steps || ['🔑 Password', '✉️ Email', '⬇ Your data', '🗑 Delete']).map(x => '<span>' + x + '</span>').join('')}</div>`, true);
      },
      run: async (D) => {
        await D.db([['users/demoTeacher01/pendingEmail', null], ['users/demoTeacher01/pendingEmailFrom', null]]);
        await D.load('app', '/presenter');
        await D.waitFor('#userBtn');
      },
    },
    {
      id: 'open',
      say: "Everything about your account is in one place. Click your avatar at the top right, then Account settings.",
      run: async (D) => {
        D.card('');
        D.chip(1, (window.VT || {}).c1 || 'Open Account settings');
        await D.sleep(600);
        await D.click('#userBtn', 'app', { scroll: false, after: 800 });
        await D.click('#userMenuItems button[onclick^="openAccountSettings()"]', 'app', { scroll: false, after: 1200 });
        await D.waitFor('#acctBox', 'app', 5000);
      },
    },
    {
      id: 'password',
      say: "To change your password, type your current one, then the new one twice, and click Change password. Forgotten the current one? There's a reset link right below.",
      run: async (D) => {
        D.chip(2, (window.VT || {}).c2 || 'Change your password');
        await D.type('#acctCurPw', 'mypassword', 'app', { cps: 14 });
        await D.type('#acctNewPw', 'a-new-password', 'app', { cps: 16 });
        await D.type('#acctNewPw2', 'a-new-password', 'app', { cps: 16 });
        await D.click('#acctPwBtn', 'app', { after: 900 });
        await D.focus('#acctPwCard', 1.35);
        await D.sleep(1600);
        await D.unfocus();
      },
    },
    {
      id: 'email',
      say: "To change your email, enter the new address and your current password, and click Send confirmation link. Nothing changes until you click the link we send to the new address, and we let your old address know too.",
      run: async (D) => {
        D.chip(3, (window.VT || {}).c3 || 'Change your email');
        await D.type('#acctNewEmail', 'alex@newschool.org', 'app', { cps: 16 });
        await D.type('#acctEmailPw', 'mypassword', 'app', { cps: 14 });
        await D.click('#acctEmailBtn', 'app', { after: 900 });
        await D.focus('#acctEmailCard', 1.35);
        await D.sleep(2000);
        await D.unfocus();
      },
    },
    {
      id: 'confirm',
      say: "Until you confirm, you keep signing in with your current address. Your presentations, results and plan stay exactly as they are.",
      run: async (D) => {
        D.chip(4, (window.VT || {}).c4 || 'Confirm from your new inbox');
        D.js((w) => { w.closeAccountSettings(); });
        await D.sleep(500);
        D.js((w) => { w.openAccountSettings(); });
        await D.waitFor('#acctPending', 'app', 5000);
        await D.sleep(500);
        await D.focus('#acctPending', 1.6);
        await D.sleep(2400);
        await D.unfocus();
      },
    },
    {
      id: 'data',
      say: "Under Your data, you can download a copy of everything: your presentations, questions, and the answers they collected.",
      run: async (D) => {
        D.chip(5, (window.VT || {}).c5 || 'Download your data');
        await D.point('#acctExportBtn', 'app');
        await D.sleep(2200);
        D.hideCursor();
      },
    },
    {
      id: 'delete',
      say: "And if you ever want to leave, Delete account removes everything permanently. A paid plan simply stops renewing, so there are no further charges.",
      run: async (D) => {
        D.chip(6, (window.VT || {}).c6 || 'Delete your account');
        await D.focus('#acctDeleteCard', 1.35);
        await D.sleep(3200);
        await D.unfocus();
        await D.snap('account-settings');
      },
    },
    {
      id: 'outro',
      say: "Sign in with Google? Then your password and email are managed by Google, and we can move your presentations for you. Questions? Email help at pollslide dot com.",
      run: async (D) => {
        D.chip(0, '');
        await D.sleep(500);
        const T = window.VT || {};
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>${T.oh1 || 'Avatar → <em>⚙️ Account settings</em>'}</h1>
          <p>${T.osub || 'Password · email · your data · delete'}</p>
          <div class="url">app.pollslide.com</div>
          <p style="margin-top:34px;font-size:28px;">${T.help || 'Need a hand?'} help@pollslide.com</p>`);
      },
    },
  ],
};
