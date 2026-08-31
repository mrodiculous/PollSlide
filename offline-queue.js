/* PollSlide — answers survive bad wifi.
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS EXISTS FOR
 * Thirty phones on school wifi. A student taps Submit, the write fails, and until now
 * they got a toast saying "check your connection and try again" — and their answer was
 * gone. That was survivable when this was a polling toy. It is not survivable now:
 * with class rosters and a gradebook, a lost answer is a wrong mark on a named child's
 * record, caused by the school's network rather than by the child.
 *
 * SO: a failed submit is queued, not discarded. It retries on its own when the
 * connection comes back, it survives the page being closed and reopened, and the
 * student is told plainly that it is saved.
 *
 * TWO TIMESTAMPS, AND THE DIFFERENCE MATTERS
 *   submittedAt  when the student TAPPED. This is the answer's real time and it is
 *                never rewritten — it is what stops them being penalised for the wifi.
 *   arrivedAt    when the write actually landed.
 * A gap between them is the fact a teacher needs to judge a late answer. Collapsing
 * them would either punish the student or hide the delay, and both are dishonest.
 *
 * WHY BACKOFF: a room where the wifi just died is thirty phones retrying at once. A
 * fixed one-second interval turns a network problem into a thundering herd against the
 * access point that is already struggling.
 * --------------------------------------------------------------------------- */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PSQueue = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const KEY = 'ps_pending_answers';
  const MAX_ITEMS = 60;          // one deck's worth, generously
  const MAX_ATTEMPTS = 12;
  const GIVE_UP_MS = 6 * 60 * 60 * 1000;   // six hours: the lesson is long over

  /* Exponential with a ceiling and jitter. The jitter is the important part in a
   * classroom: without it every phone that lost wifi at the same moment retries at
   * the same moment, forever, in lockstep. */
  function nextDelay(attempt, rand) {
    const n = Math.max(0, attempt | 0);
    const base = Math.min(1000 * Math.pow(2, n), 60000);
    const jitter = (typeof rand === 'number' ? rand : Math.random()) * base * 0.3;
    return Math.round(base + jitter);
  }

  // One answer is one queue entry. A retake of the same question REPLACES the pending
  // one — sending both would record an attempt the student never intended.
  const idOf = (item) => `${item.session}|${item.qid}|${item.pid}`;

  function enqueue(queue, item, now) {
    const q = Array.isArray(queue) ? queue.slice() : [];
    if (!item || !item.session || !item.qid || !item.pid) return q;
    const t = typeof now === 'number' ? now : Date.now();
    const id = idOf(item);
    const entry = {
      id, session: item.session, qid: item.qid, pid: item.pid,
      record: item.record || {},
      queuedAt: t, attempts: 0, nextAt: t,
    };
    const i = q.findIndex(x => x.id === id);
    if (i >= 0) q[i] = entry; else q.push(entry);
    // Oldest out first if it somehow overflows — a very old answer is the least useful.
    return q.length > MAX_ITEMS ? q.slice(q.length - MAX_ITEMS) : q;
  }

  const dueItems = (queue, now) => (Array.isArray(queue) ? queue : [])
    .filter(x => x && (x.nextAt || 0) <= (typeof now === 'number' ? now : Date.now()));

  function markFailed(queue, id, now, rand) {
    const t = typeof now === 'number' ? now : Date.now();
    return (Array.isArray(queue) ? queue : []).map(x => {
      if (x.id !== id) return x;
      const attempts = (x.attempts || 0) + 1;
      return { ...x, attempts, nextAt: t + nextDelay(attempts, rand) };
    });
  }

  const markSent = (queue, id) => (Array.isArray(queue) ? queue : []).filter(x => x.id !== id);

  /* Give up eventually, but LOUDLY — the student is told, so they can tell the teacher.
   * Silently dropping an answer would be the original bug wearing a disguise. */
  function expired(queue, now) {
    const t = typeof now === 'number' ? now : Date.now();
    return (Array.isArray(queue) ? queue : [])
      .filter(x => (x.attempts || 0) >= MAX_ATTEMPTS || (t - (x.queuedAt || t)) > GIVE_UP_MS);
  }
  const drop = (queue, ids) => (Array.isArray(queue) ? queue : []).filter(x => !ids.includes(x.id));

  /* What actually gets written when a queued answer finally lands. The original
   * submittedAt is preserved; the delay is recorded as its own fact. */
  function recordFor(item, now) {
    const t = typeof now === 'number' ? now : Date.now();
    const rec = Object.assign({}, item.record);
    const queuedMs = Math.max(0, t - (rec.submittedAt || item.queuedAt || t));
    if (queuedMs > 1500) {          // under 1.5s is a normal round trip, not an outage
      rec.arrivedAt = t;
      rec.queuedMs = queuedMs;
      rec.offline = true;
    }
    return rec;
  }

  /* localStorage can be full, disabled, or throw outright in a private window. None of
   * that may take the answer page down, so every access is guarded and a failure just
   * means the queue is in memory only for this page view. */
  function load(storage) {
    try {
      const raw = (storage || window.localStorage).getItem(KEY);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v.filter(x => x && x.id) : [];
    } catch (e) { return []; }
  }
  function save(queue, storage) {
    try {
      (storage || window.localStorage).setItem(KEY, JSON.stringify(Array.isArray(queue) ? queue : []));
      return true;
    } catch (e) { return false; }
  }

  return { KEY, MAX_ITEMS, MAX_ATTEMPTS, GIVE_UP_MS,
           nextDelay, idOf, enqueue, dueItems, markFailed, markSent,
           expired, drop, recordFor, load, save };
});
