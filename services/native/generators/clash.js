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
      rules: this.generateRules(),
    };

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
        udp: node.udp !== false,
      };

      if (node.type === "ss") {
        proxy.type = "ss";
        proxy.cipher = node.method;
        proxy.password = node.password;
        const isShadowTLS = this.isShadowTLSPlugin(node.plugin);
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
          proxy.plugin = isShadowTLS ? "shadow-tls" : node.plugin;
          proxy["plugin-opts"] = node.plugin_opts || {};
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
          proxy["ws-opts"] = {
            path: node.ws_opts.path || "/",
            headers: node.ws_opts.headers || {},
          };
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
          proxy["ws-opts"] = {
            path: node.ws_opts.path || "/",
            headers: node.ws_opts.headers || {},
          };
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
          proxy["ws-opts"] = {
            path: node.ws_opts.path || "/",
            headers: node.ws_opts.headers || {},
          };
        } else if (node.network === "grpc") {
          proxy["grpc-opts"] = {
            "grpc-service-name": node.grpc_opts.service_name || "",
          };
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

  generateProxyGroups(proxies) {
    const proxyNames = proxies.map((p) => p.name);

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
  generateRules() {
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
