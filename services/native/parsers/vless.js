const BaseParser = require('./base');

/**
 * VLESS 协议解析器
 * 支持格式: vless://uuid@server:port?params#name
 */
class VLESSParser extends BaseParser {
    /**
     * 解析 VLESS URI
     * @param {string} uri - VLESS URI
     * @returns {object|null} 标准化节点对象
     */
    parse(uri) {
        try {
            if (!uri.startsWith('vless://')) {
                return null;
            }

            // 移除 vless:// 前缀
            let content = uri.slice(8);

            // 提取节点名称 (fragment)
            let name = '';
            const hashIndex = content.indexOf('#');
            if (hashIndex !== -1) {
                name = this.urlDecode(content.slice(hashIndex + 1));
                content = content.slice(0, hashIndex);
            }

            const node = this.createNode();
            node.type = 'vless';
            node.name = name || 'VLESS节点';

            // 解析查询参数
            let params = {};
            const queryIndex = content.indexOf('?');
            if (queryIndex !== -1) {
                params = this.parseQuery(content.slice(queryIndex));
                content = content.slice(0, queryIndex);
            }

            // 解析 uuid@server:port
            const atIndex = content.indexOf('@');
            if (atIndex === -1) {
                console.error('无效的 VLESS 格式');
                return null;
            }

            node.uuid = content.slice(0, atIndex);
            const serverPart = content.slice(atIndex + 1);

            // 解析 server:port
            const portIndex = serverPart.lastIndexOf(':');
            if (portIndex === -1) {
                console.error('无效的 VLESS server:port 格式');
                return null;
            }

            node.server = serverPart.slice(0, portIndex);
            node.port = parseInt(serverPart.slice(portIndex + 1), 10);

            // 解析查询参数
            if (params.encryption) {
                node.cipher = params.encryption;
            }
            if (params.flow) {
                node.flow = params.flow;
            }
            if (params.security) {
                node.security = params.security;
                node.tls = params.security === 'tls' || params.security === 'reality';
            }
            if (params.sni) {
                node.sni = params.sni;
            }
            if (params.fp) {
                node.fingerprint = params.fp;
            }
            if (params.pbk) {
                node.reality_opts.public_key = params.pbk;
            }
            if (params.sid) {
                node.reality_opts.short_id = params.sid;
            }
            if (params.spx) {
                node.reality_opts.spider_x = params.spx;
            }
            if (params.alpn) {
                node.alpn = params.alpn.split(',');
            }
            if (params.allowInsecure === '1' || params.allowInsecure === 'true') {
                node.skip_cert_verify = true;
            }
            if (params.type) {
                node.network = params.type;
            }
            if (Object.prototype.hasOwnProperty.call(params, 'tfo')) {
                node.tfo = this.parseBoolean(params.tfo);
            }

            // WebSocket 配置
            if (node.network === 'ws') {
                if (params.path) {
                    node.ws_opts.path = params.path;
                    this.extractWSEarlyData(node.ws_opts);
                }
                if (params.ed && !node.ws_opts['max-early-data']) {
                    node.ws_opts['max-early-data'] = parseInt(params.ed, 10);
                    node.ws_opts['early-data-header-name'] = 'Sec-WebSocket-Protocol';
                }
                if (params.host) {
                    node.ws_opts.headers = { Host: params.host };
                }
            }

            // gRPC 配置
            if (node.network === 'grpc') {
                if (params.serviceName) {
                    node.grpc_opts.service_name = params.serviceName;
                }
            }

            // HTTP/2 配置
            if (node.network === 'h2' || node.network === 'http') {
                if (params.path) {
                    node.h2_opts.path = params.path;
                }
                if (params.host) {
                    node.h2_opts.host = params.host.split(',');
                }
            }

            // XHTTP 配置
            if (node.network === 'xhttp') {
                node.xhttp_opts = this.parseXHTTPOpts(params);
            }

            return this.validate(node) ? node : null;
        } catch (error) {
            console.error('解析 VLESS 节点失败:', error.message);
            return null;
        }
    }

    extractWSEarlyData(wsOpts) {
        const path = String(wsOpts.path || '');
        if (!path.includes('ed=')) return;
        try {
            const parsed = new URL(path, 'http://ws.local');
            const earlyData = parsed.searchParams.get('ed');
            if (!/^\d+$/.test(String(earlyData || ''))) return;
            parsed.searchParams.delete('ed');
            wsOpts.path = `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
            wsOpts['max-early-data'] = parseInt(earlyData, 10);
            wsOpts['early-data-header-name'] = 'Sec-WebSocket-Protocol';
        } catch {
            // 保留原始 path，避免误改非标准路径。
        }
    }

    parseXHTTPOpts(params) {
        const result = {};
        const directKeys = [
            'path',
            'host',
            'mode',
            'no-grpc-header',
            'x-padding-bytes',
            'x-padding-obfs-mode',
            'x-padding-key',
            'x-padding-header',
            'x-padding-placement',
            'x-padding-method',
            'uplink-http-method',
            'session-placement',
            'session-key',
            'session-table',
            'session-length',
            'seq-placement',
            'seq-key',
            'uplink-data-placement',
            'uplink-data-key',
            'uplink-chunk-size',
            'sc-max-each-post-bytes',
            'sc-min-posts-interval-ms',
        ];

        for (const key of directKeys) {
            if (params[key] !== undefined && params[key] !== '') {
                result[key] = params[key];
            }
        }

        if (params.extra) {
            const extra = this.parseXHTTPExtra(params.extra);
            if (extra.headers && typeof extra.headers === 'object') result.headers = extra.headers;
            if (extra['no-grpc-header'] !== undefined) result['no-grpc-header'] = extra['no-grpc-header'];
            if (extra.noGRPCHeader !== undefined) result['no-grpc-header'] = extra.noGRPCHeader;
            if (extra.xPaddingBytes !== undefined) result['x-padding-bytes'] = extra.xPaddingBytes;
            if (extra.xPaddingObfsMode !== undefined) result['x-padding-obfs-mode'] = extra.xPaddingObfsMode;
            if (extra.xPaddingKey !== undefined) result['x-padding-key'] = extra.xPaddingKey;
            if (extra.xPaddingHeader !== undefined) result['x-padding-header'] = extra.xPaddingHeader;
            if (extra.xPaddingPlacement !== undefined) result['x-padding-placement'] = extra.xPaddingPlacement;
            if (extra.xPaddingMethod !== undefined) result['x-padding-method'] = extra.xPaddingMethod;
            if (extra.uplinkHTTPMethod !== undefined) result['uplink-http-method'] = extra.uplinkHTTPMethod;
            if (extra.sessionPlacement !== undefined) result['session-placement'] = extra.sessionPlacement;
            if (extra.sessionKey !== undefined) result['session-key'] = extra.sessionKey;
            if (extra.sessionTable !== undefined) result['session-table'] = extra.sessionTable;
            if (extra.sessionLength !== undefined) result['session-length'] = extra.sessionLength;
            if (extra.seqPlacement !== undefined) result['seq-placement'] = extra.seqPlacement;
            if (extra.seqKey !== undefined) result['seq-key'] = extra.seqKey;
            if (extra.uplinkDataPlacement !== undefined) result['uplink-data-placement'] = extra.uplinkDataPlacement;
            if (extra.uplinkDataKey !== undefined) result['uplink-data-key'] = extra.uplinkDataKey;
            if (extra.uplinkChunkSize !== undefined) result['uplink-chunk-size'] = extra.uplinkChunkSize;
            if (extra.scMaxEachPostBytes !== undefined) result['sc-max-each-post-bytes'] = extra.scMaxEachPostBytes;
            if (extra.scMinPostsIntervalMs !== undefined) result['sc-min-posts-interval-ms'] = extra.scMinPostsIntervalMs;
            if (extra.reuseSettings !== undefined) result['reuse-settings'] = extra.reuseSettings;
            if (extra.downloadSettings !== undefined) result['download-settings'] = extra.downloadSettings;
            if (extra.xmux !== undefined && result['reuse-settings'] === undefined) result['reuse-settings'] = extra.xmux;
        }

        return result;
    }

    parseXHTTPExtra(value) {
        if (!value) return {};
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    /**
     * 验证 VLESS 节点
     * @param {object} node - 节点对象
     * @returns {boolean} 是否有效
     */
    validate(node) {
        if (!super.validate(node)) return false;
        if (!node.uuid) return false;
        if (node.port < 1 || node.port > 65535) return false;
        return true;
    }
}

module.exports = VLESSParser;
