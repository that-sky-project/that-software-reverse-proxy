class Router {
  constructor(sites) {
    this._map = new Map();
    for (const site of sites) {
      const key = site.hostname.toLowerCase();
      this._map.set(key, site);
    }
  }

  resolve(host) {
    if (!host) return null;
    const key = host.split(':')[0].toLowerCase();
    return this._map.get(key) || null;
  }

  all() {
    return Array.from(this._map.values());
  }
}

module.exports = Router;
