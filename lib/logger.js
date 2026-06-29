const fs = require('fs/promises');
const path = require('path');
const { ensureDir, sanitizePathSegment, buildRequestFilename } = require('./utils');

class Logger {
  constructor(loggingConfig = {}) {
    this.baseDir = path.resolve(loggingConfig.dir || './data');
    this.maxBodyLogSize = Number.isFinite(loggingConfig.maxBodyLogSize)
      ? Math.max(0, Math.floor(loggingConfig.maxBodyLogSize))
      : 1024 * 1024;
    this.prettyJson = loggingConfig.prettyJson !== false;
    this.enableConsole = loggingConfig.console !== false;
    this._writeQueue = new Map();
  }

  getMaxBodyLogSize() {
    return this.maxBodyLogSize;
  }

  async _getSiteDir(siteName) {
    const safeName = sanitizePathSegment(siteName, 'site');
    const dir = path.join(this.baseDir, safeName);
    await ensureDir(dir);
    return { dir, safeName };
  }

  _enqueue(key, task) {
    const prev = this._writeQueue.get(key) || Promise.resolve();
    const current = prev.catch(() => {}).then(task);
    this._writeQueue.set(key, current);
    return current;
  }

  _eventFilename(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `events_${year}${month}${day}.ndjson`;
  }

  async logRequest(siteName, requestId, logData) {
    const { dir, safeName } = await this._getSiteDir(siteName);
    const filename = buildRequestFilename(logData?.request?.path || '/', requestId);
    const filePath = path.join(dir, filename);
    const json = this.prettyJson ? JSON.stringify(logData, null, 2) : JSON.stringify(logData);

    await this._enqueue(`request:${safeName}`, async () => {
      await fs.writeFile(filePath, json, 'utf-8');
    });
    return filePath;
  }

  async logEvent(level, event, meta = {}) {
    const timestamp = new Date().toISOString();
    const eventData = {
      timestamp,
      level,
      event,
      ...meta,
    };

    const systemDir = path.join(this.baseDir, '_system');
    await ensureDir(systemDir);
    const filename = this._eventFilename();
    const filePath = path.join(systemDir, filename);
    const line = `${JSON.stringify(eventData)}\n`;

    await this._enqueue(`event:${filename}`, async () => {
      await fs.appendFile(filePath, line, 'utf-8');
    });

    if (this.enableConsole) {
      const text = meta.message ? `${event}: ${meta.message}` : event;
      console.log(`[${timestamp}] [${String(level).toUpperCase()}] ${text}`);
    }

    return filePath;
  }
}

module.exports = Logger;
