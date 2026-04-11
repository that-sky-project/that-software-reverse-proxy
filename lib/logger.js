const fs = require('fs/promises');
const path = require('path');
const { ensureDir, buildRequestFilename } = require('./utils');

class Logger {
  constructor(loggingConfig) {
    this.baseDir = path.resolve(loggingConfig.dir || './data');
    this.maxBodyLogSize = loggingConfig.maxBodyLogSize || 1048576;
    this._writeQueue = new Map();
  }

  async _getSiteDir(siteName) {
    const dir = path.join(this.baseDir, siteName);
    await ensureDir(dir);
    return dir;
  }

  async logRequest(siteName, logData) {
    const dir = await this._getSiteDir(siteName);
    const filename = buildRequestFilename(logData.request.path);
    const filePath = path.join(dir, filename);

    const json = JSON.stringify(logData, null, 2);
    await fs.writeFile(filePath, json, 'utf-8');

    return filePath;
  }
}

module.exports = Logger;
