const yaml = require('js-yaml');
const BaseParser = require('./base');

/**
 * YAML 格式解析器
 * 用于解析 Clash 风格的 YAML 订阅配置
 * 支持从 YAML 配置中提取代理节点信息
 */
class YAMLParser extends BaseParser {
    parseConfig(content) {
        try {
            const config = yaml.load(content);
            return config && typeof config === 'object' ? config : null;
        } catch (error) {
            console.error('解析 YAML 配置失败:', error.message);
            return null;
        }
    }

    /**
     * 解析 YAML 格式的订阅内容
     * @param {string} content - YAML 格式的文本内容
     * @returns {Array} 标准化节点对象数组
     */
    parse(content) {
        try {
            const config = this.parseConfig(content);

            if (!config) {
                console.error('YAML 解析失败：无效的配置格式');
                return [];
            }

            // 提取代理节点列表。支持完整 proxies 配置、代理数组，或单个 Mihomo 代理对象。
            const proxies = Array.isArray(config)
                ? config
                : Array.isArray(config.proxies || config.Proxy)
                    ? (config.proxies || config.Proxy)
                    : config.type
                        ? [config]
                        : [];

            if (!Array.isArray(proxies) || proxies.length === 0) {
                console.error('YAML 配置中没有找到有效的代理列表');
                return [];
            }

            // 解析每个代理节点
            const nodes = [];
            for (const proxy of proxies) {
                const node = this.parseProxyNode(proxy);
                if (node && this.validate(node)) {
                    nodes.push(node);
                }
            }

            return nodes;
        } catch (error) {
            console.error('解析 YAML 配置失败:', error.message);
            return [];
        }
    }

    /**
     * 解析单个代理节点
     * @param {object} proxy - YAML 中的代理配置对象
     * @returns {object|null} 标准化节点对象
     */
    parseProxyNode(proxy) {
        if (!proxy || typeof proxy !== 'object') {
            return null;
        }

        // 获取节点类型（统一转换为小写）
        const type = (proxy.type || '').toLowerCase();

        // 根据不同类型解析节点
        let node = null;
        switch (type) {
            case 'ss':
            case 'shadowsocks':
                node = this.parseShadowsocks(proxy);
                break;
            case 'ssr':
                node = this.parseSSR(proxy);
                break;
            case 'vmess':
                node = this.parseVMess(proxy);
                break;
            case 'trojan':
                node = this.parseTrojan(proxy);
                break;
            case 'vless':
                node = this.parseVLESS(proxy);
                break;
            case 'hysteria2':
            case 'hy2':
                node = this.parseHysteria2(proxy);
                break;
            case 'anytls':
                node = this.parseAnyTLS(proxy);
                break;
            default:
                console.warn(`不支持的代理类型: ${type}`);
                return null;
        }

        return this.applyCommonProxyOptions(proxy, node);
    }

    applyCommonProxyOptions(proxy, node) {
        if (!node) return null;
        if (Object.prototype.hasOwnProperty.call(proxy, 'tfo')) {
            node.tfo = this.parseBoolean(proxy.tfo);
        }
        return node;
    }

    /**
     * 解析 Shadowsocks 节点
     * @param {object} proxy - 代理配置
     * @returns {object} 标准化节点对象
     */
    parseShadowsocks(proxy) {
        const node = this.createNode();
        node.type = 'ss';
        node.name = proxy.name || 'SS节点';
        node.server = proxy.server;
        node.port = parseInt(proxy.port, 10);
        node.password = proxy.password;
        node.method = proxy.cipher || proxy.method || 'aes-256-gcm';
        node.udp = proxy.udp !== false;
        if (Object.prototype.hasOwnProperty.call(proxy, 'udp-over-tcp')) {
            node.udp_over_tcp = proxy['udp-over-tcp'] === true || proxy['udp-over-tcp'] === 'true';
        }
        if (Object.prototype.hasOwnProperty.call(proxy, 'udp-over-tcp-version')) {
            node.udp_over_tcp_version = parseInt(proxy['udp-over-tcp-version'], 10);
        }
        node.ip_version = proxy['ip-version'] || '';
        if (Object.prototype.hasOwnProperty.call(proxy, 'smux')) {
            node.smux = proxy.smux;
        }

        // 插件配置
        if (proxy.plugin) {
            node.plugin = proxy.plugin;
            node.plugin_opts = proxy['plugin-opts'] || {};
        }
        node.fingerprint = proxy['client-fingerprint'] || proxy.fingerprint || '';

        return node;
    }

    parseSSR(proxy) {
        const node = this.createNode();
        node.type = 'ssr';
        node.name = proxy.name || 'SSR节点';
        node.server = proxy.server;
        node.port = parseInt(proxy.port, 10);
        node.password = proxy.password;
        node.method = proxy.cipher || proxy.method || 'aes-256-cfb';
        node.ssr_protocol = proxy.protocol || 'origin';
        node.ssr_protocol_param = proxy['protocol-param'] || proxy.protocol_param || '';
        node.ssr_obfs = proxy.obfs || 'plain';
        node.ssr_obfs_param = proxy['obfs-param'] || proxy.obfs_param || '';
        node.udp = proxy.udp !== false;
        return node;
    }

    /**
     * 解析 VMess 节点
     * @param {object} proxy - 代理配置
     * @returns {object} 标准化节点对象
     */
    parseVMess(proxy) {
        const node = this.createNode();
        node.type = 'vmess';
        node.name = proxy.name || 'VMess节点';
        node.server = proxy.server;
        node.port = parseInt(proxy.port, 10);
        node.uuid = proxy.uuid;
        node.alterId = parseInt(proxy.alterId || proxy['alter-id'] || 0, 10);
        node.cipher = proxy.cipher || 'auto';
        node.network = proxy.network || 'tcp';
        node.udp = proxy.udp !== false;

        // TLS 配置
        node.tls = proxy.tls === true || proxy.tls === 'true';
        if (node.tls) {
            node.sni = proxy.sni || proxy.servername || '';
            node.skip_cert_verify = proxy['skip-cert-verify'] === true;
            if (proxy.alpn) {
                node.alpn = Array.isArray(proxy.alpn) ? proxy.alpn : [proxy.alpn];
            }
        }

        // 传输层配置
        if (node.network === 'ws') {
            node.ws_opts.path = proxy['ws-opts']?.path || proxy['ws-path'] || '/';
            const headers = proxy['ws-opts']?.headers || {};
            if (proxy['ws-headers'] || headers.Host) {
                node.ws_opts.headers = proxy['ws-headers'] || headers;
            }
        } else if (node.network === 'h2' || node.network === 'http') {
            const h2Opts = proxy['h2-opts'] || {};
            node.h2_opts.path = h2Opts.path || '/';
            node.h2_opts.host = h2Opts.host || [];
        } else if (node.network === 'grpc') {
            const grpcOpts = proxy['grpc-opts'] || {};
            node.grpc_opts.service_name = grpcOpts['grpc-service-name'] || '';
        }

        return node;
    }

    /**
     * 解析 Trojan 节点
     * @param {object} proxy - 代理配置
     * @returns {object} 标准化节点对象
     */
    parseTrojan(proxy) {
        const node = this.createNode();
        node.type = 'trojan';
        node.name = proxy.name || 'Trojan节点';
        node.server = proxy.server;
        node.port = parseInt(proxy.port, 10);
        node.password = proxy.password;
        node.network = proxy.network || 'tcp';
        node.udp = proxy.udp !== false;

        // TLS 配置（Trojan 默认使用 TLS）
        node.tls = true;
        node.sni = proxy.sni || proxy.server;
        node.skip_cert_verify = proxy['skip-cert-verify'] === true;
        if (proxy.alpn) {
            node.alpn = Array.isArray(proxy.alpn) ? proxy.alpn : [proxy.alpn];
        }

        // WebSocket 配置
        if (node.network === 'ws') {
            const wsOpts = proxy['ws-opts'] || {};
            node.ws_opts.path = wsOpts.path || '/';
            if (wsOpts.headers) {
                node.ws_opts.headers = wsOpts.headers;
            }
        } else if (node.network === 'grpc') {
            const grpcOpts = proxy['grpc-opts'] || {};
            node.grpc_opts.service_name = grpcOpts['grpc-service-name'] || '';
        }

        return node;
    }

    /**
     * 解析 VLESS 节点
     * @param {object} proxy - 代理配置
     * @returns {object} 标准化节点对象
     */
    parseVLESS(proxy) {
        const node = this.createNode();
        node.type = 'vless';
        node.name = proxy.name || 'VLESS节点';
        node.server = proxy.server;
        node.port = parseInt(proxy.port, 10);
        node.uuid = proxy.uuid;
        node.flow = proxy.flow || '';
        node.network = proxy.network || 'tcp';
        node.udp = proxy.udp !== false;

        // TLS / Reality 配置
        const realityOpts = proxy['reality-opts'] || {};
        node.security = proxy.security || (realityOpts['public-key'] ? 'reality' : '');
        node.tls = proxy.tls === true || proxy.tls === 'true' || node.security === 'reality';
        if (node.tls) {
            node.sni = proxy.sni || proxy.servername || '';
            node.fingerprint = proxy['client-fingerprint'] || proxy.fingerprint || '';
            node.skip_cert_verify = proxy['skip-cert-verify'] === true;
            node.reality_opts.public_key = realityOpts['public-key'] || realityOpts.public_key || '';
            node.reality_opts.short_id = realityOpts['short-id'] || realityOpts.short_id || '';
            node.reality_opts.spider_x = realityOpts['spider-x'] || realityOpts.spider_x || '';
            if (proxy.alpn) {
                node.alpn = Array.isArray(proxy.alpn) ? proxy.alpn : [proxy.alpn];
            }
        }

        // 传输层配置
        if (node.network === 'ws') {
            const wsOpts = proxy['ws-opts'] || {};
            node.ws_opts.path = wsOpts.path || '/';
            if (wsOpts.headers) {
                node.ws_opts.headers = wsOpts.headers;
            }
        } else if (node.network === 'h2' || node.network === 'http') {
            const h2Opts = proxy['h2-opts'] || {};
            node.h2_opts.path = h2Opts.path || '/';
            node.h2_opts.host = h2Opts.host || [];
        } else if (node.network === 'grpc') {
            const grpcOpts = proxy['grpc-opts'] || {};
            node.grpc_opts.service_name = grpcOpts['grpc-service-name'] || '';
        }

        return node;
    }

    /**
     * 解析 Hysteria2 节点
     * @param {object} proxy - 代理配置
     * @returns {object} 标准化节点对象
     */
    parseHysteria2(proxy) {
        const node = this.createNode();
        node.type = 'hysteria2';
        node.name = proxy.name || 'Hysteria2节点';
        node.server = proxy.server;
        node.port = parseInt(proxy.port, 10);
        node.password = proxy.password || '';
        node.udp = proxy.udp !== false;

        // TLS 配置
        node.tls = true;
        node.sni = proxy.sni || proxy.server;
        node.skip_cert_verify = proxy['skip-cert-verify'] === true;
        if (proxy.alpn) {
            node.alpn = Array.isArray(proxy.alpn) ? proxy.alpn : [proxy.alpn];
        }

        // 混淆配置
        if (proxy.obfs) {
            node.hysteria2_opts.obfs = proxy.obfs;
            if (proxy['obfs-password']) {
                node.hysteria2_opts.obfs_password = proxy['obfs-password'];
            }
        }

        return node;
    }

    /**
     * 解析 AnyTLS 节点
     * @param {object} proxy - 代理配置
     * @returns {object} 标准化节点对象
     */
    parseAnyTLS(proxy) {
        const node = this.createNode();
        node.type = 'anytls';
        node.name = proxy.name || 'AnyTLS节点';
        node.server = proxy.server;
        node.port = parseInt(proxy.port, 10);
        node.password = proxy.password || '';
        node.sni = proxy.sni || proxy.servername || proxy.server;
        node.fingerprint = proxy['client-fingerprint'] || proxy.fingerprint || '';
        node.skip_cert_verify = proxy['skip-cert-verify'] === true;
        node.udp = proxy.udp !== false;
        if (proxy.alpn) {
            node.alpn = Array.isArray(proxy.alpn) ? proxy.alpn : [proxy.alpn];
        }
        return node;
    }

    /**
     * 验证节点数据
     * @param {object} node - 节点对象
     * @returns {boolean} 是否有效
     */
    validate(node) {
        if (!super.validate(node)) {
            return false;
        }

        // 验证端口范围
        if (node.port < 1 || node.port > 65535) {
            return false;
        }

        // 根据类型验证必要字段
        switch (node.type) {
            case 'ss':
                return !!node.password && !!node.method;
            case 'vmess':
            case 'vless':
                return !!node.uuid;
            case 'trojan':
                return !!node.password;
            case 'hysteria2':
                return true; // password is optional for hysteria2
            case 'anytls':
                return !!node.password;
            default:
                return false;
        }
    }
}

module.exports = YAMLParser;