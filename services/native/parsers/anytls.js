const BaseParser = require('./base');

class AnyTLSParser extends BaseParser {
    parse(uri) {
        try {
            if (!uri.startsWith('anytls://')) {
                return null;
            }

            let content = uri.slice(9);
            let name = '';
            const hashIndex = content.indexOf('#');
            if (hashIndex !== -1) {
                name = this.urlDecode(content.slice(hashIndex + 1));
                content = content.slice(0, hashIndex);
            }

            let params = {};
            const queryIndex = content.indexOf('?');
            if (queryIndex !== -1) {
                params = this.parseQuery(content.slice(queryIndex));
                content = content.slice(0, queryIndex);
            }

            const atIndex = content.indexOf('@');
            if (atIndex === -1) {
                this.setLastError('AnyTLS 缺少 password@server:port');
                return null;
            }

            const node = this.createNode();
            node.type = 'anytls';
            node.name = name || 'AnyTLS节点';
            node.password = this.urlDecode(content.slice(0, atIndex));

            const address = content.slice(atIndex + 1);
            const { server, port } = this.parseAddress(address);
            node.server = server;
            node.port = port || 443;
            node.sni = params.sni || params.servername || node.server;
            node.fingerprint = params['client-fingerprint'] || params.fingerprint || params.fp || '';
            node.skip_cert_verify = params.insecure === '1' || params.insecure === 'true';
            node.udp = this.parseBoolean(params.udp) === true;
            if (Object.prototype.hasOwnProperty.call(params, 'tfo')) {
                node.tfo = this.parseBoolean(params.tfo);
            }
            if (params.alpn) {
                node.alpn = String(params.alpn).split(',').filter(Boolean);
            }

            return this.validate(node) ? node : null;
        } catch (error) {
            this.setLastError(error.message);
            return null;
        }
    }

    parseAddress(address) {
        if (address.startsWith('[')) {
            const bracketEnd = address.indexOf(']');
            if (bracketEnd === -1) {
                throw new Error('AnyTLS IPv6 地址格式无效');
            }
            const server = address.slice(1, bracketEnd);
            const portPart = address.slice(bracketEnd + 1);
            return {
                server,
                port: portPart.startsWith(':') ? parseInt(portPart.slice(1), 10) : 443,
            };
        }

        const portIndex = address.lastIndexOf(':');
        if (portIndex === -1) {
            return { server: address, port: 443 };
        }

        return {
            server: address.slice(0, portIndex),
            port: parseInt(address.slice(portIndex + 1), 10),
        };
    }

    validate(node) {
        if (!super.validate(node)) return false;
        if (node.port < 1 || node.port > 65535) return false;
        return Boolean(node.password);
    }
}

module.exports = AnyTLSParser;
