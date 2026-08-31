/* Node-side entry point. The implementation lives in ../progress.js so the browser and
 * the tests load THE SAME FILE — a second copy of "is this student improving" would
 * eventually disagree, and the disagreement would reach a parents' evening. */
module.exports = require('../progress.js');
