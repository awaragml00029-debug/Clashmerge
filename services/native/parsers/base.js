/**
 * 基础协议解析器类
 * 定义标准化节点格式和通用验证方法
 */
class BaseParser {
    constructor() {
        this.lastError = '';
    }

    /**
     * 解析节点URI
     * @param {string} uri - 节点URI
     * @returns {object|null} 标准化节点对象
     */
    parse(uri) {
        throw new Error('parse() 方法必须在子类中实现');
    }

    setLastError(message) {
        this.lastError = message || '';
    }

    getLastError() {
        return this.lastError || '';
    }

    resetLastError() {
        this.lastError = '';
    }

    /**
     * 验证节点数据
     * @param {object} node - 节点对象
     * @returns {boolean} 是否有效
     */
    validate(node) {
        if (!node) return false;
        if (!node.type || !node.server || !node.port) return false;
        if (!node.name) return false;
        return true;
    }

    /**
     * 创建标准化节点对象
     * @returns {object} 标准节点结构
     */
    createNode() {
        return {
            type: '',           // vmess/vless/trojan/ss
            name: '',           // 节点名称
            server: '',         // 服务器地址
            port: 0,            // 端口
            uuid: '',           // UUID (vless/vmess)
            password: '',       // 密码 (trojan/ss)
            method: '',         // 加密方法 (ss)
            plugin: '',         // Shadowsocks 插件
            plugin_opts: {},    // Shadowsocks 插件参数
            udp_over_tcp: undefined,
            udp_over_tcp_version: undefined,
            ip_version: '',
            smux: undefined,
            tfo: false,         // TCP Fast Open
            network: 'tcp',     // 传输协议 (tcp/ws/grpc/h2)
            tls: false,         // 是否启用TLS
            security: '',       // tls/reality/none
            sni: '',            // SNI
            fingerprint: '',    // TLS/Reality client fingerprint
            alpn: [],           // ALPN
            skip_cert_verify: false,  // 跳过证书验证
            reality_opts: {
                public_key: '',
                short_id: '',
                spider_x: ''
            },
            // WebSocket 相关
            ws_opts: {
                path: '',
                headers: {}
            },
            // gRPC 相关
            grpc_opts: {
                service_name: ''
            },
            // HTTP/2 相关
            h2_opts: {
                host: [],
                path: ''
            },
            // XHTTP 相关
            xhttp_opts: {},
            // VMess 特有
            alterId: 0,
            cipher: 'auto',
            // VLESS 特有
            flow: '',
            // Hysteria2 特有
            hysteria2_opts: {
                obfs: '',
                obfs_password: '',
                pinSHA256: ''
            },
            // SSR 特有
            ssr_protocol: '',
            ssr_protocol_param: '',
            ssr_obfs: '',
            ssr_obfs_param: '',
            group: '',
            // 其他
            udp: false
        };
    }

    /**
     * Base64 解码
     * @param {string} str - Base64 字符串
     * @returns {string} 解码后的字符串
     */
    base64Decode(str) {
        try {
            // 处理 URL-safe Base64
            str = str.replace(/-/g, '+').replace(/_/g, '/');
            // 添加填充
            while (str.length % 4) {
                str += '=';
            }
            return Buffer.from(str, 'base64').toString('utf8');
        } catch (error) {
            console.error('Base64解码失败:', error.message);
            return '';
        }
    }

    /**
     * URL 解码
     * @param {string} str - URL编码的字符串
     * @returns {string} 解码后的字符串
     */
    urlDecode(str) {
        try {
            return decodeURIComponent(str);
        } catch (error) {
            return str;
        }
    }

    /**
     * 解析 URL 查询参数
     * @param {string} search - 查询字符串 (?key=value&...)
     * @returns {object} 参数对象
     */
    parseQuery(search) {
        const params = {};
        if (!search || search === '?') return params;

        const query = search.startsWith('?') ? search.slice(1) : search;
        const pairs = query.split('&');

        for (const pair of pairs) {
            const separatorIndex = pair.indexOf('=');
            const key = separatorIndex === -1 ? pair : pair.slice(0, separatorIndex);
            const value = separatorIndex === -1 ? '' : pair.slice(separatorIndex + 1);
            if (key) {
                params[this.urlDecode(key)] = value ? this.urlDecode(value) : '';
            }
        }

        return params;
    }

    parseBoolean(value) {
        if (value === undefined || value === null || value === '') return undefined;
        if (value === true || value === 1) return true;
        if (value === false || value === 0) return false;
        const normalized = String(value).trim().toLowerCase();
        if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
        return false;
    }
}

module.exports = BaseParser;
