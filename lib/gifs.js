/* Node-side entry point. The implementation lives in ../gifs.js so the browser and the
 * tests load THE SAME FILE — a second copy of "is this answer picturable" would
 * eventually disagree with the one that decides what goes on a projector. */
module.exports = require('../gifs.js');
