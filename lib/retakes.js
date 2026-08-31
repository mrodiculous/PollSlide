/* Node-side entry point. The implementation lives in ../retakes.js so the browser
 * and the tests load THE SAME FILE — two copies of "which attempt counts" would
 * eventually disagree, and the disagreement would be a wrong grade. */
module.exports = require('../retakes.js');
