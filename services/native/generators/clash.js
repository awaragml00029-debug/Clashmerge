const yaml = require("js-yaml");
const BaseGenerator = require("./base");

/**
 * Clash 格式生成器
 * 输出格式: YAML 配置文件
 */
class ClashGenerator extends BaseGenerator {
  constructor(options = {}) {
    super();
    this.fixedInbounds = Array.isArray(options.fixedInbounds) ? options.fixedInbounds : [];
    this.ruleMode = options.ruleMode === "custom" ? "custom" : "default";
    this.customRules = typeof options.customRules === "string" ? options.customRules : "";
    this.customRuleConfig = this.parseCustomRuleConfig(this.customRules);
  }

  /**
   * 生成 Clash 配置
   * @param {Array} nodes - 节点列表
   * @returns {string} YAML 配置内容
   */
  generate(nodes) {
    const validNodes = this.filterValidNodes(nodes);
    const proxies = this.generateProxies(validNodes);

    return this.generateFromProxies(proxies);
  }

  generateFromProxies(proxies) {
    const config = {
      "mixed-port": 7890,
      "allow-lan": false,
      mode: "rule",
      "log-level": "warning",
      "external-controller": "127.0.0.1:9090",
      "clash-for-android": {
        "append-system-dns": false,
      },
      "unified-delay": true,
      "global-client-fingerprint": "chrome",
      "keep-alive-interval": 360,
      "cfw-bypass": ["localhost", "127.*", "10.*", "192.168.*", "<local>"],
      ntp: {
        enable: true,
        "write-to-system": false,
        server: "ntp.tencent.com",
        port: 123,
        interval: 480,
      },
      hosts: {
        "mtalk.google.com": "108.177.125.188",
        "appv2.nloli.xyz": "104.26.2.212",
      },
      dns: {
        enable: true,
        listen: "127.0.0.1:5334",
        "default-nameserver": ["180.184.1.1", "119.29.29.29", "223.5.5.5"],
        "enhanced-mode": "fake-ip",
        "fake-ip-range": "198.18.0.1/16",
        "use-hosts": true,
        "use-system-hosts": true,
        "nameserver-policy": {
          "geosite:cn,apple,category-games@cn,private": ["119.29.29.29", "223.5.5.5", "system"],
        },
        nameserver: ["https://223.6.6.6/dns-query", "https://doh.pub/dns-query"],
        "proxy-server-nameserver": ["https://223.5.5.5/dns-query", "https://doh.pub/dns-query"],
      },
      proxies: proxies,
      "proxy-groups": this.generateProxyGroups(proxies),
    };

    const ruleProviders = this.getCustomRuleProviders();
    if (Object.keys(ruleProviders).length > 0) {
      config["rule-providers"] = ruleProviders;
    }
    config.rules = this.generateRules(proxies);

    const listeners = this.generateFixedListeners(proxies);
    if (listeners.length > 0) {
      config.listeners = listeners;
    }

    return yaml.dump(config, { lineWidth: -1, noRefs: true });
  }

  generateProxies(nodes) {
    const proxies = [];
    const usedNames = new Set();

    for (const node of nodes) {
      const proxy = this.convertToProxy(node);
      if (proxy) {
        proxy.name = this.createUniqueProxyName(proxy.name, usedNames);
        proxies.push(proxy);
      }
    }

    return proxies;
  }

  createUniqueProxyName(name, usedNames) {
    const baseName = String(name || "未命名节点").trim() || "未命名节点";
    let uniqueName = baseName;
    let index = 2;

    while (usedNames.has(uniqueName)) {
      uniqueName = `${baseName} #${index}`;
      index += 1;
    }

    usedNames.add(uniqueName);
    return uniqueName;
  }

  /**
   * 将节点转换为 Clash 代理配置
   * @param {object} node - 节点对象
   * @returns {object|null} Clash 代理对象
   */
  convertToProxy(node) {
    try {
      const proxy = {
        name: node.name,
        server: node.server,
        port: node.port,
        udp: node.udp === true,
      };

      if (node.tfo !== undefined && node.tfo !== null) {
        proxy.tfo = node.tfo;
      }

      if (node.type === "ss") {
        proxy.type = "ss";
        proxy.cipher = node.method;
        proxy.password = node.password;
        const isShadowTLS = this.isShadowTLSPlugin(node.plugin);
        const isV2RayPlugin = this.isV2RayPlugin(node.plugin);
        if (node.udp_over_tcp !== undefined && node.udp_over_tcp !== null) {
          proxy["udp-over-tcp"] = node.udp_over_tcp;
        } else if (isShadowTLS) {
          proxy["udp-over-tcp"] = false;
        }
        if (node.udp_over_tcp_version !== undefined && node.udp_over_tcp_version !== null && node.udp_over_tcp_version !== "") {
          proxy["udp-over-tcp-version"] = node.udp_over_tcp_version;
        } else if (isShadowTLS) {
          proxy["udp-over-tcp-version"] = 2;
        }
        if (node.ip_version) {
          proxy["ip-version"] = node.ip_version;
        } else if (isShadowTLS) {
          proxy["ip-version"] = "ipv4";
        }
        if (node.smux !== undefined && node.smux !== null) {
          proxy.smux = node.smux;
        } else if (isShadowTLS) {
          proxy.smux = { enabled: false };
        }
        if (node.plugin) {
          proxy.plugin = isShadowTLS ? "shadow-tls" : isV2RayPlugin ? "v2ray-plugin" : node.plugin;
          proxy["plugin-opts"] = isShadowTLS
            ? this.normalizeShadowTLSPluginOpts(node.plugin_opts || {})
            : isV2RayPlugin
              ? this.normalizeV2RayPluginOpts(node.plugin_opts || {})
              : node.plugin_opts || {};
        }
        if (node.fingerprint) {
          proxy["client-fingerprint"] = node.fingerprint;
        } else if (isShadowTLS) {
          proxy["client-fingerprint"] = "chrome";
        }
      } else if (node.type === "ssr") {
        proxy.type = "ssr";
        proxy.cipher = node.method;
        proxy.password = node.password;
        proxy.protocol = node.ssr_protocol || "origin";
        proxy.obfs = node.ssr_obfs || "plain";
        if (node.ssr_protocol_param) {
          proxy["protocol-param"] = node.ssr_protocol_param;
        }
        if (node.ssr_obfs_param) {
          proxy["obfs-param"] = node.ssr_obfs_param;
        }
      } else if (node.type === "vmess") {
        proxy.type = "vmess";
        proxy.uuid = node.uuid;
        proxy.alterId = node.alterId || 0;
        proxy.cipher = node.cipher || "auto";
        proxy.tls = node.tls;
        proxy.network = node.network || "tcp";

        if (node.network === "ws") {
          proxy["ws-opts"] = this.normalizeWSOpts(node.ws_opts || {}, node.sni || node.server);
        } else if (node.network === "h2") {
          proxy["h2-opts"] = {
            host: node.h2_opts.host || [],
            path: node.h2_opts.path || "/",
          };
        } else if (node.network === "grpc") {
          proxy["grpc-opts"] = {
            "grpc-service-name": node.grpc_opts.service_name || "",
          };
        }

        if (node.tls) {
          proxy.servername = node.sni || node.server;
          if (node.skip_cert_verify) {
            proxy["skip-cert-verify"] = true;
          }
        }
      } else if (node.type === "trojan") {
        proxy.type = "trojan";
        proxy.password = node.password;
        proxy.sni = node.sni || node.server;
        proxy["skip-cert-verify"] = node.skip_cert_verify || false;

        if (node.network === "ws") {
          proxy.network = "ws";
          proxy["ws-opts"] = this.normalizeWSOpts(node.ws_opts || {}, node.sni || node.server);
        } else if (node.network === "grpc") {
          proxy.network = "grpc";
          proxy["grpc-opts"] = {
            "grpc-service-name": node.grpc_opts.service_name || "",
          };
        }
      } else if (node.type === "vless") {
        // Clash Meta 支持 VLESS
        proxy.type = "vless";
        proxy.uuid = node.uuid;
        proxy.tls = node.tls;
        proxy.network = node.network || "tcp";

        if (node.flow) {
          proxy.flow = node.flow;
        }

        if (node.network === "ws") {
          proxy["ws-opts"] = this.normalizeWSOpts(node.ws_opts || {}, node.sni || node.server);
        } else if (node.network === "grpc") {
          proxy["grpc-opts"] = {
            "grpc-service-name": node.grpc_opts.service_name || "",
          };
        } else if (node.network === "h2" || node.network === "http") {
          proxy["h2-opts"] = {
            host: node.h2_opts.host || [],
            path: node.h2_opts.path || "/",
          };
        } else if (node.network === "xhttp") {
          proxy["xhttp-opts"] = this.normalizeXHTTPOpts(node.xhttp_opts || {});
        }

        if (node.tls) {
          proxy.servername = node.sni || node.server;
          if (node.fingerprint) {
            proxy["client-fingerprint"] = node.fingerprint;
          }
          if (node.security === "reality" || node.reality_opts?.public_key) {
            proxy["reality-opts"] = {
              "public-key": node.reality_opts.public_key,
            };
            if (node.reality_opts.short_id) {
              proxy["reality-opts"]["short-id"] = node.reality_opts.short_id;
            }
            if (node.reality_opts.spider_x) {
              proxy["reality-opts"]["spider-x"] = node.reality_opts.spider_x;
            }
          }
          if (node.skip_cert_verify) {
            proxy["skip-cert-verify"] = true;
          }
        }
      } else if (node.type === "hysteria2") {
        // Clash Meta 支持 Hysteria2
        proxy.type = "hysteria2";
        if (node.password) {
          proxy.password = node.password;
        }
        proxy.sni = node.sni || node.server;
        proxy["skip-cert-verify"] = node.skip_cert_verify || false;

        // 混淆配置
        if (node.hysteria2_opts && node.hysteria2_opts.obfs) {
          proxy.obfs = node.hysteria2_opts.obfs;
          if (node.hysteria2_opts.obfs_password) {
            proxy["obfs-password"] = node.hysteria2_opts.obfs_password;
          }
        }
      } else if (node.type === "anytls") {
        proxy.type = "anytls";
        proxy.password = node.password;
        proxy.sni = node.sni || node.server;
        if (node.fingerprint) {
          proxy["client-fingerprint"] = node.fingerprint;
        }
        proxy["skip-cert-verify"] = node.skip_cert_verify || false;
        if (Array.isArray(node.alpn) && node.alpn.length > 0) {
          proxy.alpn = node.alpn;
        }
      } else {
        return null;
      }

      return proxy;
    } catch (error) {
      const nodeInfo = `${node?.type || "unknown"}://${node?.server || "unknown"}:${node?.port || "unknown"} (${node?.name || "no-name"})`;
      console.error(`转换 Clash 代理失败: ${nodeInfo}`, error);
      return null;
    }
  }

  /**
   * 生成代理组
   * @param {Array} proxies - 代理列表
   * @returns {Array} 代理组配置
   */
  isShadowTLSPlugin(plugin) {
    const normalized = String(plugin || "").toLowerCase().replace(/_/g, "-");
    return normalized === "shadow-tls" || normalized === "shadowtls";
  }

  isV2RayPlugin(plugin) {
    const normalized = String(plugin || "").toLowerCase().replace(/_/g, "-");
    return normalized === "v2ray-plugin";
  }

  normalizeV2RayPluginOpts(pluginOpts) {
    const result = {};
    const mode = this.normalizeV2RayPluginMode(pluginOpts.mode || pluginOpts.obfs || pluginOpts.transport);
    const host = String(pluginOpts.host || pluginOpts["obfs-host"] || pluginOpts.obfsHost || "").trim();
    const wsPluginOpts = this.normalizeWSEarlyData({
      path: String(pluginOpts.path || "").trim(),
      "max-early-data": pluginOpts["max-early-data"] ?? pluginOpts.maxEarlyData ?? pluginOpts.ed,
      "early-data-header-name": pluginOpts["early-data-header-name"] || pluginOpts.earlyDataHeaderName,
    });
    const path = wsPluginOpts.path || "";
    const tls = this.parsePluginBoolean(pluginOpts.tls);
    const mux = this.parsePluginBoolean(pluginOpts.mux);

    result.mode = mode || "websocket";
    if (tls !== undefined) result.tls = tls;
    if (host) result.host = host;
    if (path) result.path = path;
    if (result.mode === "websocket") {
      const maxEarlyData = wsPluginOpts["max-early-data"] !== undefined && wsPluginOpts["max-early-data"] !== null && wsPluginOpts["max-early-data"] !== ""
        ? parseInt(wsPluginOpts["max-early-data"], 10)
        : 2560;
      result["max-early-data"] = Number.isNaN(maxEarlyData) ? 2560 : maxEarlyData;
      result["early-data-header-name"] = wsPluginOpts["early-data-header-name"] || "Sec-WebSocket-Protocol";
    }
    if (mux !== undefined) result.mux = mux;
    return result;
  }

  normalizeV2RayPluginMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    if (!mode) return "";
    if (mode === "ws") return "websocket";
    return mode;
  }

  parsePluginBoolean(value) {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
    return true;
  }

  normalizeWSOpts(wsOpts, fallbackHost = "") {
    const normalizedWSOpts = this.normalizeWSEarlyData(wsOpts || {});
    const result = { path: normalizedWSOpts.path || "/" };
    const sourceHeaders = normalizedWSOpts.headers && typeof normalizedWSOpts.headers === "object" ? normalizedWSOpts.headers : {};
    const headers = { ...sourceHeaders };
    const hasHost = Boolean(headers.Host || headers.host);
    if (!hasHost && fallbackHost) {
      headers.Host = fallbackHost;
    }
    if (Object.keys(headers).length > 0) {
      result.headers = headers;
    }
    const maxEarlyData = normalizedWSOpts["max-early-data"] !== undefined && normalizedWSOpts["max-early-data"] !== null && normalizedWSOpts["max-early-data"] !== ""
      ? parseInt(normalizedWSOpts["max-early-data"], 10)
      : 2560;
    result["max-early-data"] = Number.isNaN(maxEarlyData) ? 2560 : maxEarlyData;
    result["early-data-header-name"] = normalizedWSOpts["early-data-header-name"] || "Sec-WebSocket-Protocol";
    return result;
  }

  normalizeWSEarlyData(wsOpts) {
    const result = { ...wsOpts };
    const path = String(result.path || "");
    if (!path.includes("ed=")) return result;

    try {
      const parsed = new URL(path || "/", "http://ws.local");
      const earlyData = parsed.searchParams.get("ed");
      if (!/^\d+$/.test(String(earlyData || ""))) return result;
      parsed.searchParams.delete("ed");
      result.path = `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
      if (result["max-early-data"] === undefined || result["max-early-data"] === null || result["max-early-data"] === "") {
        result["max-early-data"] = parseInt(earlyData, 10);
      }
      result["early-data-header-name"] = result["early-data-header-name"] || "Sec-WebSocket-Protocol";
    } catch {
      // 保留原始 path，避免误改非标准路径。
    }

    return result;
  }

  normalizeXHTTPOpts(xhttpOpts) {
    if (!xhttpOpts || typeof xhttpOpts !== "object") return {};
    const result = {};
    for (const [key, value] of Object.entries(xhttpOpts)) {
      if (value === undefined || value === null || value === "") continue;
      result[key] = value;
    }
    return result;
  }

  normalizeShadowTLSPluginOpts(pluginOpts) {
    const rawHost = String(pluginOpts.host || "").replace(/\\+$/, "");
    const host = rawHost.split(";")[0].trim();
    const password = pluginOpts.password || pluginOpts.passwd || pluginOpts.pwd || "";
    const version = this.detectShadowTLSVersion(pluginOpts);
    const normalized = {};
    if (host) normalized.host = host;
    if (password) normalized.password = password;
    if (version) normalized.version = version;
    return normalized;
  }

  detectShadowTLSVersion(pluginOpts) {
    const explicitVersion = parseInt(pluginOpts.version || pluginOpts.v || "", 10);
    if ([1, 2, 3].includes(explicitVersion)) return explicitVersion;
    if (this.isTruthyPluginFlag(pluginOpts.v3)) return 3;
    if (this.isTruthyPluginFlag(pluginOpts.v2)) return 2;
    if (this.isTruthyPluginFlag(pluginOpts.v1)) return 1;
    return 2;
  }

  isTruthyPluginFlag(value) {
    return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
  }

  generateProxyGroups(proxies) {
    const proxyNames = proxies.map((p) => p.name);
    const defaultGroups = this.generateDefaultProxyGroups(proxyNames);
    const customGroups = this.generateCustomProxyGroups(proxyNames);
    if (customGroups.length === 0) {
      return defaultGroups;
    }

    const groups = [];
    const usedNames = new Set();
    for (const group of [...customGroups, ...defaultGroups]) {
      if (!group.name || usedNames.has(group.name)) continue;
      usedNames.add(group.name);
      groups.push(group);
    }
    return groups;
  }

  generateDefaultProxyGroups(proxyNames) {
    return [
      {
        name: "🚀 节点选择",
        type: "select",
        proxies: ["♻️ 自动选择", "🔰 故障转移", "DIRECT"].concat(proxyNames),
      },
      {
        name: "♻️ 自动选择",
        type: "url-test",
        proxies: proxyNames,
        url: "http://www.gstatic.com/generate_204",
        interval: 300,
      },
      {
        name: "🔰 故障转移",
        type: "fallback",
        proxies: proxyNames,
        url: "http://www.gstatic.com/generate_204",
        interval: 300,
      },
    ];
  }

  generateCustomProxyGroups(proxyNames) {
    const proxyGroups = Array.isArray(this.customRuleConfig.proxyGroups)
      ? this.customRuleConfig.proxyGroups
      : [];
    if (this.ruleMode !== "custom" || proxyGroups.length === 0) {
      return [];
    }

    const customGroupNames = new Set(
      proxyGroups
        .map((group) => group?.name)
        .filter((name) => name && !this.isManualSelectGroupName(name)),
    );
    const availablePolicies = new Set([
      "DIRECT",
      "REJECT",
      "REJECT-DROP",
      "REJECT-TINYGIF",
      "PASS",
      ...customGroupNames,
      ...proxyNames,
    ]);

    return proxyGroups
      .map((group) => this.normalizeCustomProxyGroup(group, proxyNames, availablePolicies))
      .filter(Boolean);
  }

  normalizeCustomProxyGroup(group, proxyNames, availablePolicies) {
    if (!group || typeof group !== "object" || !group.name) return null;
    if (this.isManualSelectGroupName(group.name)) return null;

    const normalized = { ...group };
    delete normalized.include;

    const proxies = this.isMainSelectGroup(group)
      ? this.generateMainSelectGroupProxies(proxyNames, availablePolicies)
      : this.expandCustomProxyGroupProxies(group, proxyNames, availablePolicies);

    if (proxies.length > 0) {
      normalized.proxies = proxies;
    } else if (["select", "url-test", "fallback", "load-balance"].includes(String(group.type || ""))) {
      normalized.proxies = proxyNames.length > 0 ? proxyNames : ["DIRECT"];
    }

    return normalized;
  }

  isMainSelectGroup(group) {
    return String(group?.type || "") === "select" && String(group?.name || "").trim() === "🚀 节点选择";
  }

  isManualSelectGroupName(name) {
    return String(name || "").trim() === "🚀 手动切换";
  }

  generateMainSelectGroupProxies(proxyNames, availablePolicies) {
    const result = [];
    const addProxy = (name) => {
      if (name && availablePolicies.has(name) && !result.includes(name)) {
        result.push(name);
      }
    };

    addProxy("♻️ 自动选择");
    for (const proxyName of proxyNames) {
      addProxy(proxyName);
    }
    addProxy("DIRECT");

    return result;
  }

  expandCustomProxyGroupProxies(group, proxyNames, availablePolicies) {
    const proxies = [];
    const addProxy = (name) => {
      if (!name || proxies.includes(name)) return;
      if (availablePolicies.has(name)) proxies.push(name);
    };

    for (const name of Array.isArray(group.proxies) ? group.proxies : []) {
      if (this.isManualSelectGroupName(name)) {
        for (const proxyName of proxyNames) {
          addProxy(proxyName);
        }
      } else {
        addProxy(name);
      }
    }

    const includes = Array.isArray(group.include)
      ? group.include
      : group.include
        ? [group.include]
        : [];
    for (const pattern of includes) {
      for (const name of this.filterProxyNames(proxyNames, pattern)) {
        addProxy(name);
      }
    }

    return proxies;
  }

  filterProxyNames(proxyNames, pattern) {
    const value = String(pattern || "").trim();
    if (!value) return [];
    try {
      const regex = new RegExp(value, "i");
      return proxyNames.filter((name) => regex.test(name));
    } catch {
      return proxyNames.filter((name) => name.includes(value));
    }
  }

  generateFixedListeners(proxies) {
    const proxyNames = new Set(proxies.map((proxy) => proxy.name));
    const usedPorts = new Set();
    const listeners = [];

    for (const inbound of this.fixedInbounds) {
      if (!inbound || inbound.enabled === false) continue;

      const port = Number(inbound.port);
      const proxyName = String(inbound.proxy || inbound.proxyName || "").trim();
      if (!Number.isInteger(port) || port < 1 || port > 65535 || usedPorts.has(port)) continue;
      if (!proxyName || !proxyNames.has(proxyName)) {
        console.warn(`固定入口跳过: port=${port}, proxy=${proxyName || "empty"} 不存在`);
        continue;
      }

      const type = ["http", "socks", "mixed"].includes(inbound.type) ? inbound.type : "mixed";
      const listener = {
        name: inbound.name || `fixed-${port}`,
        type,
        listen: inbound.listen || "0.0.0.0",
        port,
        proxy: proxyName,
      };
      const username = String(inbound.username || "").trim();
      const password = String(inbound.password || "").trim();
      if (username && password) {
        listener.users = [{ username, password }];
      }
      listeners.push(listener);
      usedPorts.add(port);
    }

    return listeners;
  }

  /**
   * 生成规则
   * @returns {Array} 规则列表
   */
  generateRules(proxies = []) {
    if (this.ruleMode !== "custom") {
      return this.generateDefaultRules();
    }

    const customRules = Array.isArray(this.customRuleConfig.rules)
      ? this.customRuleConfig.rules
      : [];
    if (customRules.length === 0) {
      return this.generateDefaultRules();
    }

    const rules = [];
    const seen = new Set();
    const availablePolicies = this.getAvailablePolicies(proxies);

    for (const rule of customRules) {
      const normalized = this.normalizeCustomRule(rule, availablePolicies);
      if (!normalized) continue;
      const key = typeof normalized === "string" ? normalized : JSON.stringify(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push(normalized);
    }

    if (!rules.some((rule) => typeof rule === "string" && /^MATCH\s*,/i.test(rule.trim()))) {
      rules.push("MATCH,🚀 节点选择");
    }

    return rules.length > 0 ? rules : this.generateDefaultRules();
  }

  generateDefaultRules() {
    return [
      "DOMAIN-SUFFIX,local,DIRECT",
      "IP-CIDR,127.0.0.0/8,DIRECT",
      "IP-CIDR,172.16.0.0/12,DIRECT",
      "IP-CIDR,192.168.0.0/16,DIRECT",
      "IP-CIDR,10.0.0.0/8,DIRECT",
      "IP-CIDR,224.0.0.0/4,DIRECT",
      "IP-CIDR,240.0.0.0/4,DIRECT",
      "GEOIP,CN,DIRECT",
      "MATCH,🚀 节点选择",
    ];
  }

  getCustomRuleProviders() {
    if (this.ruleMode !== "custom") {
      return {};
    }
    const providers = this.customRuleConfig.ruleProviders;
    return providers && typeof providers === "object" ? providers : {};
  }

  parseCustomRuleConfig(value) {
    const content = String(value || "").trim();
    if (!content) {
      return { rules: [], ruleProviders: {}, proxyGroups: [] };
    }

    try {
      const parsed = yaml.load(content);
      if (Array.isArray(parsed)) {
        return { rules: parsed, ruleProviders: {}, proxyGroups: [] };
      }
      if (parsed && typeof parsed === "object") {
        return {
          rules: Array.isArray(parsed.rules) ? parsed.rules : [],
          ruleProviders: parsed["rule-providers"] && typeof parsed["rule-providers"] === "object"
            ? parsed["rule-providers"]
            : {},
          proxyGroups: Array.isArray(parsed["proxy-groups"]) ? parsed["proxy-groups"] : [],
        };
      }
    } catch {
      // 不是 YAML 结构时，按逐行 Clash 规则解析。
    }

    return {
      rules: content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.replace(/^[-*]\s+/, "")),
      ruleProviders: {},
      proxyGroups: [],
    };
  }

  getAvailablePolicies(proxies) {
    const customGroupNames = Array.isArray(this.customRuleConfig.proxyGroups)
      ? this.customRuleConfig.proxyGroups
        .map((group) => group?.name)
        .filter((name) => name && !this.isManualSelectGroupName(name))
      : [];

    return new Set([
      "🚀 节点选择",
      "♻️ 自动选择",
      "🔰 故障转移",
      "DIRECT",
      "REJECT",
      "REJECT-DROP",
      "REJECT-TINYGIF",
      "PASS",
      ...customGroupNames,
      ...proxies.map((proxy) => proxy.name),
    ]);
  }

  normalizeCustomRule(rule, availablePolicies) {
    if (typeof rule !== "string") {
      return rule;
    }

    const parts = rule.split(",").map((part) => part.trim());
    if (parts.length < 2) {
      return rule.trim();
    }

    const lastIndex = parts.length - 1;
    const policyIndex = /^no-resolve$/i.test(parts[lastIndex]) && parts.length >= 3
      ? lastIndex - 1
      : lastIndex;
    parts[policyIndex] = this.normalizeCustomPolicy(parts[policyIndex], availablePolicies);

    return parts.join(",");
  }

  normalizeCustomPolicy(policy, availablePolicies) {
    if (this.isManualSelectGroupName(policy)) {
      return "🚀 节点选择";
    }

    if (!policy || availablePolicies.has(policy)) {
      return policy;
    }

    const upperPolicy = policy.toUpperCase();
    if (availablePolicies.has(upperPolicy)) {
      return upperPolicy;
    }

    return "🚀 节点选择";
  }

  /**
   * 转换对象为 YAML 格式 (简化版)
   * @param {object} obj - 对象
   * @param {number} indent - 缩进级别
   * @returns {string} YAML 字符串
   */
  toYAML(obj, indent = 0) {
    const spaces = "  ".repeat(indent);
    let yaml = "";

    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        yaml += `${spaces}${key}:\n`;
        for (const item of value) {
          if (typeof item === "object") {
            // 生成对象的 YAML，然后将第一行与 - 合并
            const itemYaml = this.toYAML(item, indent + 2);
            const lines = itemYaml.split("\n").filter((line) => line.trim());

            if (lines.length > 0) {
              // 第一行：- key: value
              yaml += `${spaces}  - ${lines[0].trim()}\n`;
              // 剩余行：保持缩进
              for (let i = 1; i < lines.length; i++) {
                yaml += `${spaces}    ${lines[i].trim()}\n`;
              }
            }
          } else {
            yaml += `${spaces}  - ${this.escapeYAML(item)}\n`;
          }
        }
      } else if (typeof value === "object") {
        yaml += `${spaces}${key}:\n`;
        yaml += this.toYAML(value, indent + 1);
      } else {
        yaml += `${spaces}${key}: ${this.escapeYAML(value)}\n`;
      }
    }

    return yaml;
  }

  /**
   * 转义 YAML 值
   * @param {*} value - 值
   * @returns {string} 转义后的值
   */
  escapeYAML(value) {
    if (typeof value === "string") {
      // 如果包含特殊字符，使用引号
      if (
        value.includes(":") ||
        value.includes("#") ||
        value.includes("[") ||
        value.includes("]") ||
        value.includes("{") ||
        value.includes("}")
      ) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }
    return String(value);
  }
}

module.exports = ClashGenerator;
