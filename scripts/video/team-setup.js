/* "Set up your team in 2 minutes" — sent with the Team plan confirmation email, linked
 * from Team admin, and on pollslide.com/team-setup + the help centre.
 *
 *   node scripts/video/record.js team-setup
 *
 * Two demo people: Alex (owner, bought Team Small) and Jamie (invited). The app's own
 * first-sign-in behaviour is filmed — Team admin opens by itself for a new owner.
 */
module.exports = {
  id: 'team-setup',
  title: 'Set up your PollSlide team in 2 minutes',
  previewLabel: 'Watch: set up your team in 2 minutes',
  // Email GIF highlights: [scene, offset s, seconds, speed, crop in stage px (16:9)]
  preview: [['find', 1.5, 2.0, 1.2, [330, 90, 1590, 799]], ['invite', 1.0, 3.0, 1.6, [330, 150, 1590, 859]],
            ['join', 2.0, 2.5, 1.2, [0, 0, 1920, 1080]], ['join', 7.0, 2.0, 1.2, [330, 150, 1590, 859]], ['owner', 5.0, 1.5, 1.0, [330, 150, 1590, 859]]],
  scenes: [
    {
      id: 'intro',
      say: "You've got a PollSlide team plan. Here's how to set up your team, in about two minutes.",
      pre: async (D) => {
        D.hideCursor();
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>Set up your <em>team</em><br>in 2 minutes</h1>
          <p>Invite people · roles · seats · one bill</p>
          <div class="steps"><span>✉️ Invite</span><span>🛡 Roles</span><span>🪑 Seats</span><span>💳 Billing</span></div>`, true);
      },
      run: async (D) => {
        // Alex has just bought Team Small: team plan, no team yet, never seen Team admin.
        await D.db([['users/demoTeacher01/tier', 'team_small'], ['users/demoTeacher01/workspaceId', null], ['users/demoTeacher01/teamIntroSeen', null]]);
        await D.load('app', '/presenter');
        await D.waitFor('#userBtn');
      },
    },
    {
      id: 'find',
      say: "The first time you sign in, Team admin opens by itself. You're the owner. You can always find it again: click your avatar at the top right, then Team admin.",
      run: async (D) => {
        D.card('');
        D.chip(1, 'Find Team admin');
        await D.waitFor((d) => { const m = d.getElementById('teamModal'); return m && !m.classList.contains('hidden') && d.getElementById('teamSeats').textContent.includes('seats') ? m : null; }, 'app', 8000);
        await D.sleep(900);
        await D.focus((d) => [...d.querySelectorAll('#teamBody div')].find(e => /Welcome to Team Small/.test(e.textContent) && e.children.length > 1), 1.7);
        await D.sleep(1800);
        await D.unfocus();
        await D.click(['#teamModal button', /^Close$/], 'app', { scroll: false, after: 600 });
        await D.click('#userBtn', 'app', { scroll: false, after: 700 });
        await D.click('#userMenuItems button[onclick^="openTeamPanel()"]', 'app', { scroll: false, after: 1000 });
      },
    },
    {
      id: 'invite',
      say: "Invite people by email. Choose Member, or Admin if they should help you run the team. They get an email with a link, and a short video to get them started.",
      run: async (D) => {
        D.chip(2, 'Invite people');
        await D.type('#teamInviteEmail', 'jamie@example.com', 'app', { cps: 16 });
        await D.click(['#teamBody button', /^Send$/], 'app', { after: 1200 });
        await D.type('#teamInviteEmail', 'priya@example.com', 'app', { cps: 16 });
        await D.click('#teamInviteRole', 'app', { after: 300 });
        D.js((w, d) => { const s = d.getElementById('teamInviteRole'); s.value = 'admin'; s.dispatchEvent(new w.Event('change', { bubbles: true })); });
        await D.sleep(500);
        await D.click(['#teamBody button', /^Send$/], 'app', { after: 1200 });
      },
    },
    {
      id: 'seats',
      say: "Each invite holds a seat until it's accepted. If someone can't find the email, press Resend. Admins can invite and remove people. Only you, the owner, can turn an admin back into a member.",
      run: async (D) => {
        D.chip(3, 'Seats & roles');
        await D.focus('#teamSeats', 2.4);
        await D.sleep(1500);
        await D.unfocus();
        await D.point(['#teamBody button', /^Resend$/], 'app', { scroll: false });
        await D.sleep(1600);
        D.hideCursor();
        await D.sleep(1500);
      },
    },
    {
      id: 'join',
      say: "When Jamie signs in with that email, they join automatically, on your plan: unlimited presentations, more Polly, all of it. You get an email when anyone joins. And members can leave the team themselves, whenever they like.",
      run: async (D) => {
        D.chip(4, 'Jamie joins');
        await D.load('app', '/presenter?as=member');
        await D.waitFor('#userBtn');
        await D.sleep(2600);   // the "You joined …!" toast
        await D.click('#userBtn', 'app', { scroll: false, after: 700 });
        await D.click('#userMenuItems button[onclick^="openTeamPanel()"]', 'app', { scroll: false, after: 1200 });
        await D.point(['#teamBody button', /Leave this team/], 'app');
        await D.sleep(1500);
        D.hideCursor();
      },
    },
    {
      id: 'owner',
      say: "Back as the owner, Jamie is on your team. You pay for everyone, on one bill. And if the team plan ever ends, members keep all their work, and simply go back to the free plan.",
      run: async (D) => {
        D.chip(5, 'One bill for everyone');
        await D.load('app', '/presenter');
        await D.waitFor('#userBtn');
        await D.click('#userBtn', 'app', { scroll: false, after: 700 });
        await D.click('#userMenuItems button[onclick^="openTeamPanel()"]', 'app', { scroll: false, after: 1200 });
        await D.point(['#teamBody button', /Make admin/], 'app');
        await D.sleep(1400);
        D.hideCursor();
        await D.snap('team-panel');
      },
    },
    {
      id: 'outro',
      say: "That's your team, set up. If you'd like a hand, email help at pollslide dot com, and we'll help you get everyone on board.",
      run: async (D) => {
        D.chip(0, '');
        await D.sleep(500);
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>Your team is <em>ready</em></h1>
          <p>Avatar menu → 👥 Team admin, any time.</p>
          <div class="url">app.pollslide.com</div>
          <p style="margin-top:34px;font-size:28px;">Need a hand? help@pollslide.com</p>`);
      },
    },
  ],
};
