const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const uuidv4 = require('uuid/v4');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  UUID_PATTERN_ADD_DASH = new RegExp('(.{8})(.{4})(.{4})(.{4})(.{12})'),
  URL_PATTERN = new RegExp('^(?!mailto:)(?:(?:http|https|ftp)://)(?:\\S+(?::\\S*)?@)?(?:(?:(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}(?:\\.(?:[0-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))|(?:(?:[a-z\\u00a1-\\uffff0-9]+-?)*[a-z\\u00a1-\\uffff0-9]+)(?:\\.(?:[a-z\\u00a1-\\uffff0-9]+-?)*[a-z\\u00a1-\\uffff0-9]+)*(?:\\.(?:[a-z\\u00a1-\\uffff]{2,})))|localhost)(?::\\d{2,5})?(?:(/|\\?|#)[^\\s]*)?$', 'i');;

module.exports = {
  /**
   * @param {Number} HTTPStatusCode The HTTP-StatusCode
   * @param {String} message A short description (or message)
   * 
   * @returns {Error}
   */
  createError(HTTPStatusCode = 500, message = 'An unknown error has occurred') {
    let err = new Error(message);
    err.status = HTTPStatusCode;

    return err;
  },

  /**
   * @param {Error} error
   * 
   * @returns {Error}
   */
  logAndCreateError(error) {
    console.error(error);

    return module.exports.createError();
  },

  /**
   * @param {String} str 
   * 
   * @returns {Boolean}
   */
  toBoolean(str) {
    return (typeof str === 'string')
      ? str === '1' || str.toLowerCase() === 'true'
      : false;
  },

  /**
   * @param {String} str 
   * 
   * @returns {Boolean}
   */
  isUUID(str) {
    if (typeof str !== 'string') return false;

    str = str.toLowerCase();

    return UUID_PATTERN.test(str) || UUID_PATTERN.test(str.replace(/-/g, '').replace(UUID_PATTERN_ADD_DASH, '$1-$2-$3-$4-$5'));
  },

  /**
   * @param {String} str 
   * 
   * @returns {Boolean}
   */
  isURL(str) {
    return str.length < 2083 && URL_PATTERN.test(str);
  },

  /**
   * @param {String|Number} str 
   * 
   * @returns {Number} A finite integer or NaN
   */
  toInteger(str) {
    if (typeof str === 'string') {
      let result = Number.parseInt(str);

      if (!Number.isNaN(result) && Number.isFinite(result)) return result;
    }

    return (typeof str === 'number') ? str : Number.NaN;
  },

  /**
   * @param {String} dirPath 
   * @param {Function} callback Optional if you want to handle an Error
   * 
   * @returns {Boolean} True on success, false otherwise
   */
  mkdirsSync(dirPath, callback) {
    dirPath = path.resolve(dirPath);

    try {
      if (!fs.existsSync(dirPath)) {
        let tempPath;

        dirPath.split(/[/\\]/).forEach((dirName) => {
          tempPath ? tempPath = path.join(tempPath, dirName) : tempPath = dirName;

          if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath);
          }
        });
      }

      if (callback) {
        callback();
      }

      return true;
    } catch (err) {
      if (callback) {
        callback(err);
      }

      return false;
    }
  },

  /**
   * @param {Express.Request} req 
   * @param {Express.Response} res 
   * 
   * @returns {String}
   */
  getClientToken(req, res) {
    let token = req.signedCookies.uIdent;

    if (!token) {
      token = crypto.createHash('sha256').update(uuidv4()).update(crypto.randomBytes(256)).digest('hex');
      req.signedCookies.uIdent = token;
    }

    res.cookie('uIdent', token, {
      maxAge: 31540000000, // 365 Tage in ms
      signed: true,
      httpOnly: true
    });

    return token;
  },

  /**
   * @param {String} str 
   * 
   * @returns {String} SHA1 (hex)
   */
  getSHA1(str) {
    return crypto.createHash('SHA1').update(str).digest('hex');
  },

  EOL: require('os').EOL
};