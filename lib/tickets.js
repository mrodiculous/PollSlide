/* Node-side entry point. The implementation lives in ../tickets.js so the admin panel,
 * the Support Chat, the watchdog and the tests all read a conversation with THE SAME
 * FILE — the admin panel having its own idea of what a ticket contains is exactly how
 * it came to show only the first message. */
module.exports = require('../tickets.js');
