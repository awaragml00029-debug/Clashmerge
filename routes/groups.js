const express = require("express");
const yaml = require("js-yaml");
const NativeConverter = require("../services/native");
const { ClashGenerator } = require("../services/native/generators");
const MihomoHealthService = require("../services/mihomo-health");
const { applyExtensionScriptToContent, getExtensionScript } = require("../services/extension-script");
const router = express.Router();

function expandSubscriptionUrls(subscriptions) {
  const urls = [];
  for (const sub of subscriptions) {
    if (!sub || !sub.url) continue;
    if (sub.type === "list" || sub.type === "node") {
      urls.push(
        ...sub.url
          .split(/[\r\n,;]+/)
          .map((value) => value.trim())
          .filter(Boolean),
      );
    } else {
      urls.push(sub.url);
    }
  }
  return urls;
}

function normalizeFixedInbounds(config) {
  return Array.isArray(config?.fixedInbounds)
    ? config.fixedInbounds.filter((inbound) => inbound && inbound.enabled !== false)
    : [];
}

function summarizeMihomoConfigObject(config) {
  const listeners = Array.isArray(config?.listeners) ? config.listeners : [];
  const listenerDetails = listeners
    .map((listener) => ({
      name: String(listener?.name || ""),
      type: String(listener?.type || ""),
      listen: String(listener?.listen || ""),
      port: Number(listener?.port),
      proxy: String(listener?.proxy || ""),
      users: Array.isArray(listener?.users)
        ? listener.users.map((user) => ({
            username: String(user?.username || ""),
            password: String(user?.password || ""),
          }))
        : [],
    }))
    .filter((listener) => Number.isInteger(listener.port) && listener.port > 0);
  return {
    listenerCount: listenerDetails.length,
    listenerPorts: listenerDetails.map((listener) => listener.port),
    listeners: listenerDetails,
    proxyCount: Array.isArray(config?.proxies) ? config.proxies.length : 0,
  };
}

function summarizeMihomoConfig(content) {
  return summarizeMihomoConfigObject(yaml.load(content) || {});
}

function getMissingListeners(expectedListeners, actualListeners) {
  const actualByPort = new Map(actualListeners.map((listener) => [listener.port, listener]));
  return expectedListeners.filter((expected) => {
    const actual = actualByPort.get(expected.port);
    return !actual || actual.proxy !== expected.proxy;
  });
}

function summarizeFixedInbounds(fixedInbounds) {
  return fixedInbounds.map((inbound) => ({
    name: String(inbound.name || `fixed-${inbound.port}`),
    type: String(inbound.type || "mixed"),
    listen: String(inbound.listen || "0.0.0.0"),
    port: Number(inbound.port),
    proxy: String(inbound.proxy || inbound.proxyName || "").trim(),
  }));
}

function sanitizeListeners(listeners) {
  return listeners.map((listener) => ({
    name: listener.name,
    type: listener.type,
    listen: listener.listen,
    port: listener.port,
    proxy: listener.proxy,
  }));
}

async function getGroupNodeOptions(db, groupId, config = null) {
  const effectiveConfig = config || await db.getConfig();
  const subscriptions = await db.getActiveSubscriptionsByGroup(groupId);
  const urls = expandSubscriptionUrls(subscriptions);

  if (urls.length === 0) {
    return { nodes: [], failures: [], stats: { total: 0, byType: {} } };
  }

  const converter = new NativeConverter();
  const result = await converter.listNodes(urls);
  const generator = new ClashGenerator();
  const nodes = generator.generateProxies(result.nodes).map((proxy) => ({
    name: proxy.name || "",
    type: proxy.type || "",
    server: proxy.server || "",
    port: proxy.port || "",
  }));

  return { nodes, failures: result.failures, stats: result.stats };
}

async function generateGroupMihomoConfig(db, groupId, config) {
  const effectiveConfig = config || await db.getConfig();
  const subscriptions = await db.getActiveSubscriptionsByGroup(groupId);
  const urls = expandSubscriptionUrls(subscriptions);
  if (urls.length === 0) {
    throw new Error("当前分组没有启用的订阅或节点列表");
  }

  const fixedInbounds = normalizeFixedInbounds(effectiveConfig);
  const converter = new NativeConverter();
  const result = await converter.listNodes(urls);
  const generator = new ClashGenerator({ fixedInbounds });
  const proxies = generator.generateProxies(result.nodes);
  const content = generator.generateFromProxies(proxies);

  return applyExtensionScriptToContent(
    getExtensionScript(),
    content,
    "clash",
    effectiveConfig.fileName || "ClashMerge",
  );
}

/**
 * 创建分组管理路由
 * @param {object} db - 数据库实例
 * @returns {Router} Express 路由器
 */
function createGroupRoutes(db) {
  // 获取所有分组
  router.get("/api/groups", async (req, res) => {
    try {
      const groups = await db.getGroups();
      res.json(groups);
    } catch (error) {
      console.error("获取分组列表失败:", error);
      res.status(500).json({ error: "获取分组列表失败" });
    }
  });

  // 添加分组
  router.post("/api/groups", async (req, res) => {
    try {
      const { name, token } = req.body;

      if (!name || !token) {
        return res.status(400).json({ error: "分组名称和 Token 不能为空" });
      }

      const group = await db.addGroup(name, token);
      res.json({ message: "分组创建成功", data: group });
    } catch (error) {
      console.error("创建分组失败:", error);
      if (error.message.includes("Token")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "创建分组失败" });
      }
    }
  });

  // 更新分组
  router.put("/api/groups/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, token } = req.body;

      if (!name || !token) {
        return res.status(400).json({ error: "分组名称和 Token 不能为空" });
      }

      const result = await db.updateGroup(id, name, token);
      if (result.changes === 0) {
        return res.status(404).json({ error: "分组不存在" });
      }

      res.json({ message: "分组更新成功", data: result.group });
    } catch (error) {
      console.error("更新分组失败:", error);
      if (error.message.includes("Token")) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "更新分组失败" });
      }
    }
  });

  // 删除分组
  router.delete("/api/groups/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await db.deleteGroup(id);

      if (result.changes === 0) {
        return res.status(404).json({ error: "分组不存在" });
      }

      res.json({ message: "分组删除成功" });
    } catch (error) {
      console.error("删除分组失败:", error);
      res.status(500).json({ error: "删除分组失败" });
    }
  });

  // 获取分组下的订阅列表
  router.get("/api/groups/:id/subscriptions", async (req, res) => {
    try {
      const { id } = req.params;
      const subscriptions = await db.getSubscriptionsByGroup(id);
      res.json(subscriptions);
    } catch (error) {
      console.error("获取分组订阅失败:", error);
      res.status(500).json({ error: "获取分组订阅失败" });
    }
  });

  // 获取分组下可用于固定入口绑定的节点候选
  router.get("/api/groups/:id/nodes", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await getGroupNodeOptions(db, id);
      const config = await db.getConfig();
      const health = new MihomoHealthService({
        apiUrl: config.mihomoApiUrl,
        secret: config.mihomoSecret,
        testUrl: config.mihomoTestUrl,
      });
      res.json({
        ...result,
        nodes: health.attachCachedHealth(result.nodes),
      });
    } catch (error) {
      console.error("获取固定入口节点候选失败:", error);
      res.status(500).json({ error: "获取固定入口节点候选失败" });
    }
  });

  // 使用本机 Mihomo 测速当前分组节点
  router.post("/api/groups/:id/nodes/health", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await getGroupNodeOptions(db, id);
      const requestedNames = Array.isArray(req.body?.names)
        ? new Set(req.body.names.map((name) => String(name || "").trim()).filter(Boolean))
        : null;
      const nodesToTest = requestedNames
        ? result.nodes.filter((node) => requestedNames.has(node.name))
        : result.nodes;
      const config = await db.getConfig();
      const requestedTimeout = Number(req.body?.timeout);
      const requestedConcurrency = Number(req.body?.concurrency);
      const healthTimeout = Number.isInteger(requestedTimeout) && requestedTimeout >= 500 && requestedTimeout <= 60000
        ? requestedTimeout
        : undefined;
      const healthConcurrency = Number.isInteger(requestedConcurrency) && requestedConcurrency >= 1 && requestedConcurrency <= 50
        ? requestedConcurrency
        : undefined;
      const health = new MihomoHealthService({
        apiUrl: config.mihomoApiUrl,
        secret: config.mihomoSecret,
        testUrl: config.mihomoTestUrl,
        timeout: healthTimeout,
        concurrency: healthConcurrency,
      });
      const nodeNamesToTest = nodesToTest.map((node) => node.name);
      await health.pushConfig(await generateGroupMihomoConfig(db, id, config), { force: true });
      const proxyReadiness = await health.waitForProxyNames(nodeNamesToTest);
      if (!proxyReadiness.ready) {
        return res.status(502).json({
          error: "测试 Mihomo 已接收完整配置，但 /proxies 尚未加载全部当前分组节点。",
          parsedNodeCount: result.nodes.length,
          requestedNodeCount: nodeNamesToTest.length,
          targetProxyCount: proxyReadiness.proxyCount,
          missingCount: proxyReadiness.missingNames.length,
          missingNames: proxyReadiness.missingNames.slice(0, 20),
          readinessError: proxyReadiness.error || null,
        });
      }
      const healthResults = await health.testNodes(nodeNamesToTest, proxyReadiness.proxyNames);
      res.json({
        ...result,
        nodes: health.attachCachedHealth(result.nodes),
        health: healthResults,
        targetProxyCount: proxyReadiness.proxyCount,
      });
    } catch (error) {
      console.error("Mihomo 节点测速失败:", error);
      res.status(500).json({ error: error.message || "Mihomo 节点测速失败" });
    }
  });

  // 推送当前分组生成的 Mihomo 配置到已配置的测试 Mihomo
  router.post("/api/groups/:id/mihomo/push", async (req, res) => {
    try {
      const { id } = req.params;
      const config = await db.getConfig();
      if (!String(config.mihomoApiUrl || "").trim()) {
        return res.status(400).json({ error: "请先在系统配置中填写 Mihomo API 地址" });
      }

      const fixedInbounds = normalizeFixedInbounds(config);
      if (fixedInbounds.length === 0) {
        return res.status(400).json({ error: "当前系统配置没有已启用的固定入口，请先保存固定入口配置后再推送" });
      }

      const expectedListeners = summarizeFixedInbounds(fixedInbounds);
      const content = await generateGroupMihomoConfig(db, id, config);
      const summary = summarizeMihomoConfig(content);
      const skippedListeners = getMissingListeners(expectedListeners, summary.listeners);
      if (summary.listenerCount === 0) {
        return res.status(400).json({
          error: "生成的 Mihomo 配置没有任何固定入口 listeners。请确认固定入口绑定的节点名仍存在于当前分组解析结果中。",
          fixedInboundCount: fixedInbounds.length,
          expectedListeners,
          skippedListeners,
          proxyCount: summary.proxyCount,
        });
      }

      const mihomo = new MihomoHealthService({
        apiUrl: config.mihomoApiUrl,
        secret: config.mihomoSecret,
        testUrl: config.mihomoTestUrl,
      });
      await mihomo.pushConfig(content, { force: true });
      const targetChecks = await mihomo.verifyListeners(summary.listeners);
      const failedChecks = targetChecks.filter((check) => !check.alive);
      if (failedChecks.length > 0) {
        return res.status(502).json({
          error: "Mihomo 已接收配置，但目标固定入口端口校验失败。",
          apiUrl: config.mihomoApiUrl,
          generatedListenerCount: summary.listenerCount,
          generatedListenerPorts: summary.listenerPorts,
          generatedListeners: sanitizeListeners(summary.listeners),
          targetListenerCount: targetChecks.length - failedChecks.length,
          targetListenerPorts: targetChecks.filter((check) => check.alive).map((check) => check.port),
          targetChecks,
          missingListeners: sanitizeListeners(failedChecks),
          skippedListeners,
        });
      }

      res.json({
        message: "已推送到 Mihomo，并确认目标固定入口端口可用",
        apiUrl: config.mihomoApiUrl,
        bytes: Buffer.byteLength(content),
        listenerCount: summary.listenerCount,
        listenerPorts: summary.listenerPorts,
        listeners: sanitizeListeners(summary.listeners),
        skippedListenerCount: skippedListeners.length,
        skippedListeners,
        targetListenerCount: targetChecks.length,
        targetListenerPorts: targetChecks.map((check) => check.port),
        targetChecks,
      });
    } catch (error) {
      console.error("推送 Mihomo 配置失败:", error);
      res.status(500).json({ error: error.message || "推送 Mihomo 配置失败" });
    }
  });

  // 绑定订阅到分组
  router.post("/api/groups/:id/subscriptions", async (req, res) => {
    try {
      const { id } = req.params;
      const { subscriptionId } = req.body;

      if (!subscriptionId) {
        return res.status(400).json({ error: "订阅 ID 不能为空" });
      }

      await db.attachSubscriptionToGroup(id, subscriptionId);
      res.json({ message: "订阅关联成功" });
    } catch (error) {
      console.error("关联订阅失败:", error);
      if (
        error.message.includes("不存在") ||
        error.message.includes("已关联")
      ) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "关联订阅失败" });
      }
    }
  });

  // 从分组中解绑订阅
  router.delete(
    "/api/groups/:id/subscriptions/:subscriptionId",
    async (req, res) => {
      try {
        const { id, subscriptionId } = req.params;
        const result = await db.detachSubscriptionFromGroup(id, subscriptionId);

        if (result.changes === 0) {
          return res.status(404).json({ error: "关联关系不存在" });
        }

        res.json({ message: "订阅解绑成功" });
      } catch (error) {
        console.error("解绑订阅失败:", error);
        res.status(500).json({ error: "解绑订阅失败" });
      }
    }
  );

  return router;
}

module.exports = createGroupRoutes;
