const BaseParser = require('./base');

/**
 * ShadowsocksR 协议解析器
 * 支持常见格式: ssr://base64(server:port:protocol:method:obfs:base64(password)/?params)
 */
class SSRParser extends BaseParser {
    parse(uri) {
        try {
            this.resetLastError();
            if (!uri || !/^ssr:\/\//i.test(uri)) {
                return null;
            }

            const encoded = uri.slice(6).trim();
            const decoded = this.base64Decode(encoded);
            if (!decoded) {
                this.setLastError('SSR 主体 Base64 解码失败');
                return null;
            }

            const match = decoded.match(/^(.+):(\d+):([^:]*):([^:]*):([^:]*):([^/]*)(?:\/\?(.*))?$/);
            if (!match) {
                this.setLastError('SSR 主体格式无效');
                return null;
            }

            const [, server, port, protocol, method, obfs, passwordEncoded, query = ''] = match;
            const params = this.parseQuery(query);
            const node = this.createNode();
            node.type = 'ssr';
            node.server = server;
            node.port = parseInt(port, 10);
            node.method = method;
            node.password = this.decodeSsrParam(passwordEncoded);
            node.ssr_protocol = protocol || 'origin';
            node.ssr_protocol_param = this.decodeSsrParam(params.protoparam || '');
            node.ssr_obfs = obfs || 'plain';
            node.ssr_obfs_param = this.decodeSsrParam(params.obfsparam || '');
            node.name = this.decodeSsrParam(params.remarks || '') || `${server}:${port}`;
            node.group = this.decodeSsrParam(params.group || '');
            node.udp = false;
            node.raw = uri;

            if (!this.validate(node)) {
                this.setLastError('SSR 节点缺少必要字段');
                return null;
            }

            return node;
        } catch (error) {
            this.setLastError(error.message);
            return null;
        }
    }

    decodeSsrParam(value) {
        if (!value) return '';
        return this.base64Decode(String(value).replace(/\s/g, '')) || this.urlDecode(value);
    }

    validate(node) {
        if (!super.validate(node)) return false;
        if (!node.method || !node.password) return false;
        if (!node.ssr_protocol || !node.ssr_obfs) return false;
        if (node.port < 1 || node.port > 65535) return false;
        return true;
    }
}

module.exports = SSRParser;
