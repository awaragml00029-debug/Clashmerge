const BaseGenerator = require('./base');

class ShareLinkGenerator extends BaseGenerator {
  generate(nodes) {
    return this.generateWithStats(nodes).links.join('\n');
  }

  generateWithStats(nodes) {
    const validNodes = this.filterValidNodes(nodes);
    const links = [];
    const unsupported = [];

    for (const node of validNodes) {
      const link = this.convertToUri(node);
      if (link) {
        links.push(link);
      } else {
        unsupported.push({ name: node.name || '', type: node.type || '' });
      }
    }

    return {
      links,
      unsupported,
      total: validNodes.length,
    };
  }

  convertToUri(node) {
    if (!node || !node.type) return '';
    switch (node.type) {
      case 'ss':
      case 'shadowsocks':
        return this.convertShadowsocks(node);
      case 'trojan':
        return this.convertTrojan(node);
      case 'vmess':
        return this.convertVMess(node);
      case 'vless':
        return this.convertVLESS(node);
      case 'anytls':
        return this.convertAnyTLS(node);
      case 'ssr':
        return this.convertSSR(node);
      default:
        return node.raw && /^(ss|ssr|vmess|vless|trojan|hysteria2|anytls):\/\//i.test(node.raw)
          ? node.raw.trim()
          : '';
    }
  }

  convertShadowsocks(node) {
    if (!node.method || !node.password || !node.server || !node.port) return '';
    const userInfo = this.base64UrlEncode(`${node.method}:${node.password}`);
    const params = new URLSearchParams();
    const plugin = this.serializePlugin(node);
    if (plugin) params.set('plugin', plugin);
    this.appendCommonParams(params, node);
    const query = params.toString();
    return `ss://${userInfo}@${this.formatHostPort(node.server, node.port)}${query ? `/?${query}` : ''}#${this.urlEncode(node.name || 'SS Node')}`;
  }

  serializePlugin(node) {
    if (!node.plugin) return '';
    const plugin = this.normalizePluginName(node.plugin);
    const pluginOpts = this.normalizePluginOpts(plugin, node.plugin_opts || {});
    const parts = [plugin];
    for (const key of Object.keys(pluginOpts)) {
      const value = pluginOpts[key];
      if (value === undefined || value === null || value === '') continue;
      parts.push(value === true ? key : `${key}=${value}`);
    }
    return parts.join(';');
  }

  normalizePluginName(plugin) {
    const normalized = String(plugin || '').trim().toLowerCase().replace(/_/g, '-');
    if (normalized === 'shadowtls') return 'shadow-tls';
    if (normalized === 'v2ray-plugin') return 'v2ray-plugin';
    return String(plugin || '').trim();
  }

  normalizePluginOpts(plugin, pluginOpts) {
    const normalized = String(plugin || '').toLowerCase().replace(/_/g, '-');
    if (normalized === 'v2ray-plugin') {
      const result = {};
      const mode = this.normalizeV2RayPluginMode(pluginOpts.mode || pluginOpts.obfs || pluginOpts.transport);
      const tls = this.parsePluginBoolean(pluginOpts.tls);
      const mux = this.parsePluginBoolean(pluginOpts.mux);
      const host = String(pluginOpts.host || pluginOpts['obfs-host'] || pluginOpts.obfsHost || '').trim();
      const path = String(pluginOpts.path || '').trim();
      result.mode = mode || 'websocket';
      if (host) result.host = host;
      if (path) result.path = path;
      if (tls) result.tls = true;
      if (mux !== undefined) result.mux = mux;
      return result;
    }
    return pluginOpts;
  }

  normalizeV2RayPluginMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    if (!mode) return '';
    if (mode === 'ws') return 'websocket';
    return mode;
  }

  parsePluginBoolean(value) {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return true;
  }

  convertTrojan(node) {
    if (!node.password || !node.server || !node.port) return '';
    const params = new URLSearchParams();
    if (node.sni && node.sni !== node.server) params.set('sni', node.sni);
    if (node.skip_cert_verify) params.set('allowInsecure', '1');
    this.appendCommonParams(params, node);
    this.appendTransportParams(params, node);
    const query = params.toString();
    return `trojan://${this.urlEncode(node.password)}@${this.formatHostPort(node.server, node.port)}${query ? `?${query}` : ''}#${this.urlEncode(node.name || 'Trojan Node')}`;
  }

  convertVMess(node) {
    if (!node.uuid || !node.server || !node.port) return '';
    const config = {
      v: '2',
      ps: node.name || 'VMess Node',
      add: node.server,
      port: String(node.port),
      id: node.uuid,
      aid: String(node.alterId || 0),
      scy: node.cipher || 'auto',
      net: node.network || 'tcp',
      type: 'none',
      host: this.getTransportHost(node),
      path: this.getTransportPath(node),
      tls: node.tls ? 'tls' : '',
      sni: node.sni || '',
    };
    if (node.tfo !== undefined && node.tfo !== null) config.tfo = node.tfo;
    return `vmess://${this.base64Encode(JSON.stringify(config))}`;
  }

  convertVLESS(node) {
    if (!node.uuid || !node.server || !node.port) return '';
    const params = new URLSearchParams();
    params.set('encryption', node.cipher && node.cipher !== 'auto' ? node.cipher : 'none');
    if (node.flow) params.set('flow', node.flow);
    if (node.security || node.tls) params.set('security', node.security || 'tls');
    if (node.sni) params.set('sni', node.sni);
    if (node.fingerprint) params.set('fp', node.fingerprint);
    if (node.reality_opts?.public_key) params.set('pbk', node.reality_opts.public_key);
    if (node.reality_opts?.short_id) params.set('sid', node.reality_opts.short_id);
    if (node.reality_opts?.spider_x) params.set('spx', node.reality_opts.spider_x);
    if (node.skip_cert_verify) params.set('allowInsecure', '1');
    this.appendCommonParams(params, node);
    this.appendTransportParams(params, node);
    return `vless://${this.urlEncode(node.uuid)}@${this.formatHostPort(node.server, node.port)}?${params.toString()}#${this.urlEncode(node.name || 'VLESS Node')}`;
  }

  convertAnyTLS(node) {
    if (!node.password || !node.server || !node.port) return '';
    const params = new URLSearchParams();
    if (node.sni && node.sni !== node.server) params.set('sni', node.sni);
    if (node.fingerprint) params.set('client-fingerprint', node.fingerprint);
    if (node.skip_cert_verify) params.set('insecure', '1');
    if (Array.isArray(node.alpn) && node.alpn.length > 0) params.set('alpn', node.alpn.join(','));
    if (node.udp) params.set('udp', '1');
    this.appendCommonParams(params, node);
    const query = params.toString();
    return `anytls://${this.urlEncode(node.password)}@${this.formatHostPort(node.server, node.port)}${query ? `?${query}` : ''}#${this.urlEncode(node.name || 'AnyTLS Node')}`;
  }

  convertSSR(node) {
    if (!node.server || !node.port || !node.method || !node.password) return '';
    const protocol = node.ssr_protocol || 'origin';
    const obfs = node.ssr_obfs || 'plain';
    const password = this.base64UrlEncode(node.password);
    const params = new URLSearchParams();
    params.set('remarks', this.base64UrlEncode(node.name || 'SSR Node'));
    if (node.ssr_protocol_param) params.set('protoparam', this.base64UrlEncode(node.ssr_protocol_param));
    if (node.ssr_obfs_param) params.set('obfsparam', this.base64UrlEncode(node.ssr_obfs_param));
    return `ssr://${this.base64UrlEncode(`${node.server}:${node.port}:${protocol}:${node.method}:${obfs}:${password}/?${params.toString()}`)}`;
  }

  appendCommonParams(params, node) {
    if (node.tfo !== undefined && node.tfo !== null) {
      params.set('tfo', node.tfo ? '1' : '0');
    }
  }

  appendTransportParams(params, node) {
    const network = node.network || 'tcp';
    if (network && network !== 'tcp') params.set('type', network);
    if (network === 'ws') {
      const path = this.buildWSPath(node.ws_opts || {});
      const host = this.getHeaderHost(node.ws_opts?.headers) || node.sni || node.server;
      if (path) params.set('path', path);
      if (host) params.set('host', host);
    } else if (network === 'grpc') {
      const serviceName = node.grpc_opts?.service_name || '';
      if (serviceName) params.set('serviceName', serviceName);
    } else if (network === 'h2' || network === 'http') {
      const path = node.h2_opts?.path || '';
      const host = Array.isArray(node.h2_opts?.host) ? node.h2_opts.host.join(',') : node.h2_opts?.host || '';
      if (path) params.set('path', path);
      if (host) params.set('host', host);
    } else if (network === 'xhttp') {
      const opts = node.xhttp_opts || {};
      if (opts.path) params.set('path', opts.path);
      if (opts.host) params.set('host', opts.host);
      if (opts.mode) params.set('mode', opts.mode);
      const extra = this.buildXHTTPExtra(opts);
      if (Object.keys(extra).length > 0) params.set('extra', JSON.stringify(extra));
    }
  }

  buildWSPath(wsOpts) {
    const path = wsOpts.path || '';
    const earlyData = wsOpts['max-early-data'];
    if (earlyData === undefined || earlyData === null || earlyData === '') return path;

    try {
      const parsed = new URL(path || '/', 'http://ws.local');
      parsed.searchParams.set('ed', String(earlyData));
      return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
    } catch {
      const separator = path.includes('?') ? '&' : '?';
      return `${path || '/'}${separator}ed=${this.urlEncode(earlyData)}`;
    }
  }

  buildXHTTPExtra(opts) {
    const extra = {};
    const mappings = {
      headers: 'headers',
      'no-grpc-header': 'noGRPCHeader',
      'x-padding-bytes': 'xPaddingBytes',
      'x-padding-obfs-mode': 'xPaddingObfsMode',
      'x-padding-key': 'xPaddingKey',
      'x-padding-header': 'xPaddingHeader',
      'x-padding-placement': 'xPaddingPlacement',
      'x-padding-method': 'xPaddingMethod',
      'uplink-http-method': 'uplinkHTTPMethod',
      'session-placement': 'sessionPlacement',
      'session-key': 'sessionKey',
      'session-table': 'sessionTable',
      'session-length': 'sessionLength',
      'seq-placement': 'seqPlacement',
      'seq-key': 'seqKey',
      'uplink-data-placement': 'uplinkDataPlacement',
      'uplink-data-key': 'uplinkDataKey',
      'uplink-chunk-size': 'uplinkChunkSize',
      'sc-max-each-post-bytes': 'scMaxEachPostBytes',
      'sc-min-posts-interval-ms': 'scMinPostsIntervalMs',
      'reuse-settings': 'xmux',
      'download-settings': 'downloadSettings',
    };

    for (const [sourceKey, targetKey] of Object.entries(mappings)) {
      const value = opts[sourceKey];
      if (value === undefined || value === null || value === '') continue;
      extra[targetKey] = value;
    }
    return extra;
  }

  getTransportHost(node) {
    if (node.network === 'ws') return this.getHeaderHost(node.ws_opts?.headers) || node.sni || node.server;
    if (node.network === 'h2' || node.network === 'http') {
      return Array.isArray(node.h2_opts?.host) ? node.h2_opts.host.join(',') : node.h2_opts?.host || '';
    }
    return '';
  }

  getTransportPath(node) {
    if (node.network === 'ws') return node.ws_opts?.path || '';
    if (node.network === 'h2' || node.network === 'http') return node.h2_opts?.path || '';
    if (node.network === 'grpc') return node.grpc_opts?.service_name || '';
    return '';
  }

  getHeaderHost(headers) {
    if (!headers || typeof headers !== 'object') return '';
    return headers.Host || headers.host || '';
  }

  formatHostPort(host, port) {
    const value = String(host || '').trim();
    const wrappedHost = value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;
    return `${wrappedHost}:${port}`;
  }

  urlEncode(value) {
    return encodeURIComponent(String(value || ''));
  }

  base64Encode(value) {
    return Buffer.from(String(value || ''), 'utf8').toString('base64');
  }

  base64UrlEncode(value) {
    return this.base64Encode(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
}

module.exports = ShareLinkGenerator;
