const fs = require("fs");
const path = require("path");

class MihomoHealthService {
  constructor(options = {}) {
    this.apiUrl = (options.apiUrl || process.env.MIHOMO_API_URL || "http://127.0.0.1:9090").replace(/\/$/, "");
    this.secret = options.secret || process.env.MIHOMO_SECRET || "";
    this.testUrl = options.testUrl || process.env.MIHOMO_TEST_URL || "https://api.ipify.org";
    this.timeout = Number(options.timeout || process.env.MIHOMO_TEST_TIMEOUT || 8000);
    this.concurrency = Number(options.concurrency || process.env.MIHOMO_TEST_CONCURRENCY || 5);
    this.maxAgeMs = Number(options.maxAgeMs || process.env.MIHOMO_HEALTH_CACHE_MS || 6 * 60 * 60 * 1000);
    this.cacheFile = options.cacheFile || path.join(__dirname, "..", "data", "node-health-cache.json");
  }

  getHeaders() {
    return this.secret ? { Authorization: `Bearer ${this.secret}` } : {};
  }

  loadCache() {
    try {
      if (!fs.existsSync(this.cacheFile)) return {};
      return JSON.parse(fs.readFileSync(this.cacheFile, "utf8"));
    } catch (error) {
      console.warn("读取 Mihomo 节点健康缓存失败:", error.message);
      return {};
    }
  }

  saveCache(cache) {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify(cache, null, 2), "utf8");
    } catch (error) {
      console.warn("保存 Mihomo 节点健康缓存失败:", error.message);
    }
  }

  attachCachedHealth(nodes) {
    const cache = this.loadCache();
    const now = Date.now();
    return nodes.map((node) => {
      const cached = cache[node.name];
      if (!cached || now - Date.parse(cached.checkedAt || 0) > this.maxAgeMs) {
        return { ...node, health: null };
      }
      return { ...node, health: cached };
    });
  }

  async getProxyNames() {
    const response = await fetch(`${this.apiUrl}/proxies`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Mihomo API /proxies 返回 ${response.status}`);
    }
    const data = await response.json();
    return new Set(Object.keys(data.proxies || {}));
  }

  async testNodes(names) {
    const uniqueNames = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
    const proxyNames = await this.getProxyNames();
    const cache = this.loadCache();
    const results = [];

    await this.runLimited(uniqueNames, async (name) => {
      const result = proxyNames.has(name)
        ? await this.testNode(name)
        : {
            name,
            alive: false,
            delay: null,
            checkedAt: new Date().toISOString(),
            error: "节点不存在于当前 Mihomo 配置",
          };
      cache[name] = result;
      results.push(result);
    });

    this.saveCache(cache);
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  async testNode(name) {
    const endpoint = `${this.apiUrl}/proxies/${encodeURIComponent(name)}/delay?timeout=${encodeURIComponent(this.timeout)}&url=${encodeURIComponent(this.testUrl)}`;
    const checkedAt = new Date().toISOString();

    try {
      const response = await fetch(endpoint, {
        headers: this.getHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          name,
          alive: false,
          delay: null,
          checkedAt,
          error: data.message || `Mihomo API 返回 ${response.status}`,
        };
      }

      const delay = Number(data.delay);
      return {
        name,
        alive: Number.isFinite(delay) && delay >= 0,
        delay: Number.isFinite(delay) ? delay : null,
        checkedAt,
        error: null,
      };
    } catch (error) {
      return {
        name,
        alive: false,
        delay: null,
        checkedAt,
        error: error.message,
      };
    }
  }

  async runLimited(items, worker) {
    const workers = Array.from({ length: Math.min(this.concurrency, items.length) }, async (_, workerIndex) => {
      for (let index = workerIndex; index < items.length; index += this.concurrency) {
        await worker(items[index]);
      }
    });
    await Promise.all(workers);
  }
}

module.exports = MihomoHealthService;
