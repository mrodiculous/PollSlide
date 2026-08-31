/* Node-side entry point. The implementation lives in ../offline-queue.js so the
 * browser and the tests load THE SAME FILE — a second copy of "has this answer been
 * sent" would eventually disagree, and the disagreement would be a lost answer. */
module.exports = require('../offline-queue.js');
