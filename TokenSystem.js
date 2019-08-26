const PERMISSION = {
  SKINDB_ADMIN: 'SKINDB_ADMIN'
};

const tokens = require('./storage/tokens.json');

module.exports = {
  PERMISSION,

  /**
   * @param {Express.Request} req 
   * 
   * @returns {Array<PERMISSION>}
   */
  getPermissions(token) {
    return (token && token in tokens) ? tokens[token] : [];
  }
};