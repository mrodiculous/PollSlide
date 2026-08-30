/* Node-side entry point. The implementation lives in ../roster.js so the browser
 * and the tests load THE SAME FILE — two copies of name-matching logic would
 * eventually disagree about whether two students are one person. */
module.exports = require('../roster.js');
