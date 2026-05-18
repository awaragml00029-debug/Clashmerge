const fs = require("fs");
const net = require("net");
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

  async pushConfig(payload, { force = true } = {}) {
    const response = await fetch(`${this.apiUrl}/configs${force ? "?force=true" : ""}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...this.getHeaders(),
      },
      body: JSON.stringify({ path: "", payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || `Mihomo API /configs 返回 ${response.status}`);
    }
    return data;
  }

  async getConfig() {
    const response = await fetch(`${this.apiUrl}/configs`, {
      headers: this.getHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || `Mihomo API /configs 返回 ${response.status}`);
    }
    return data;
  }

  getApiHostname() {
    try {
      const url = new URL(this.apiUrl.includes("://") ? this.apiUrl : `http://${this.apiUrl}`);
      return url.hostname;
    } catch {
      return this.apiUrl.replace(/^https?:\/\//, "").split("/")[0].split(":")[0].trim();
    }
  }

  getVerificationHost() {
    const host = this.getApiHostname();
    return ["0.0.0.0", "::", ""].includes(host) ? "127.0.0.1" : host;
  }

  async verifyListeners(listeners) {
    const results = [];
    await this.runLimited(listeners, async (listener) => {
      results.push(await this.verifyListener(listener));
    });
    return results.sort((a, b) => a.port - b.port);
  }

  async verifyListener(listener) {
    const port = Number(listener?.port);
    const type = String(listener?.type || "mixed").toLowerCase();
    const host = this.getVerificationHost();
    const result = {
      name: String(listener?.name || ""),
      type,
      listen: String(listener?.listen || ""),
      port,
      proxy: String(listener?.proxy || ""),
      host,
      alive: false,
      protocol: ["mixed", "socks"].includes(type) ? "socks5" : "tcp",
      error: null,
    };

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ...result, error: "监听端口无效" };
    }

    if (["mixed", "socks"].includes(type)) {
      const user = Array.isArray(listener?.users) ? listener.users[0] : null;
      return {
        ...result,
        ...(await this.testSocks5Listener(
          host,
          port,
          String(user?.username || ""),
          String(user?.password || ""),
        )),
      };
    }

    return { ...result, ...(await this.testTcpPort(host, port)) };
  }

  async testTcpPort(host, port) {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(this.timeout);
      socket.once("connect", () => finish({ alive: true, protocol: "tcp", error: null }));
      socket.once("timeout", () => finish({ alive: false, protocol: "tcp", error: "连接超时" }));
      socket.once("error", (error) => finish({ alive: false, protocol: "tcp", error: error.message }));
    });
  }

  async testSocks5Listener(host, port, username, password) {
    let socket;
    try {
      socket = await this.openSocket(host, port);
      const methods = username && password ? [0x00, 0x02] : [0x00];
      socket.write(Buffer.from([0x05, methods.length, ...methods]));
      const methodResponse = await this.readSocketBytes(socket, 2);
      if (methodResponse[0] !== 0x05) {
        throw new Error("SOCKS5 握手响应无效");
      }
      if (methodResponse[1] === 0xff) {
        throw new Error("SOCKS5 不接受当前认证方式");
      }
      if (methodResponse[1] === 0x02) {
        const usernameBuffer = Buffer.from(username, "utf8");
        const passwordBuffer = Buffer.from(password, "utf8");
        if (usernameBuffer.length > 255 || passwordBuffer.length > 255) {
          throw new Error("SOCKS5 用户名或密码过长");
        }
        socket.write(Buffer.concat([
          Buffer.from([0x01, usernameBuffer.length]),
          usernameBuffer,
          Buffer.from([passwordBuffer.length]),
          passwordBuffer,
        ]));
        const authResponse = await this.readSocketBytes(socket, 2);
        if (authResponse[0] !== 0x01 || authResponse[1] !== 0x00) {
          throw new Error("SOCKS5 用户名或密码认证失败");
        }
      }
      socket.end();
      return { alive: true, protocol: "socks5", error: null };
    } catch (error) {
      if (socket) socket.destroy();
      return { alive: false, protocol: "socks5", error: error.message };
    }
  }

  openSocket(host, port) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const cleanup = () => {
        socket.off("connect", onConnect);
        socket.off("timeout", onTimeout);
        socket.off("error", onError);
      };
      const onConnect = () => {
        cleanup();
        resolve(socket);
      };
      const onTimeout = () => {
        cleanup();
        socket.destroy();
        reject(new Error("连接超时"));
      };
      const onError = (error) => {
        cleanup();
        socket.destroy();
        reject(error);
      };
      socket.setTimeout(this.timeout);
      socket.once("connect", onConnect);
      socket.once("timeout", onTimeout);
      socket.once("error", onError);
    });
  }

  readSocketBytes(socket, length) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let totalLength = 0;
      const cleanup = () => {
        socket.off("data", onData);
        socket.off("timeout", onTimeout);
        socket.off("error", onError);
        socket.off("close", onClose);
      };
      const onData = (chunk) => {
        chunks.push(chunk);
        totalLength += chunk.length;
        if (totalLength >= length) {
          cleanup();
          resolve(Buffer.concat(chunks, totalLength).subarray(0, length));
        }
      };
      const onTimeout = () => {
        cleanup();
        reject(new Error("读取响应超时"));
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("连接已关闭"));
      };
      socket.once("timeout", onTimeout);
      socket.once("error", onError);
      socket.once("close", onClose);
      socket.on("data", onData);
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

  async waitForProxyNames(names, { timeoutMs = 12000, intervalMs = 300 } = {}) {
    const expectedNames = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
    if (expectedNames.length === 0) {
      return { ready: true, proxyNames: new Set(), proxyCount: 0, missingNames: [] };
    }

    const deadline = Date.now() + timeoutMs;
    let proxyNames = new Set();
    let missingNames = expectedNames;
    let lastError = null;

    while (Date.now() <= deadline) {
      try {
        proxyNames = await this.getProxyNames();
        missingNames = expectedNames.filter((name) => !proxyNames.has(name));
        lastError = null;
        if (missingNames.length === 0) {
          return { ready: true, proxyNames, proxyCount: proxyNames.size, missingNames: [] };
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return { ready: false, proxyNames, proxyCount: proxyNames.size, missingNames, error: lastError?.message || null };
  }

  async testNodes(names, knownProxyNames = null) {
    const uniqueNames = [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
    const proxyNames = knownProxyNames instanceof Set ? knownProxyNames : await this.getProxyNames();
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
