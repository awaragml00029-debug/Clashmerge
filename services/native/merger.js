/**
 * 节点合并器
 * 负责合并多个订阅源的节点，去重和排序
 */
class NodeMerger {
    /**
     * 合并节点列表
     * @param {Array<Array>} nodeLists - 多个节点列表
     * @returns {Array} 合并后的节点列表
     */
    merge(fetchResults) {
        const allNodes = [];
        const seen = new Set();

        for (const result of fetchResults) {
            const nodes = result.nodes || [];
            for (const node of nodes) {
                const key = this.generateNodeKey(node);
                if (!seen.has(key)) {
                    seen.add(key);
                    allNodes.push(node);
                }
            }
        }

        // 排序：按类型分组，同类型按名称排序
        allNodes.sort((a, b) => {
            if (a.type !== b.type) {
                const typeOrder = { vmess: 1, vless: 2, trojan: 3, ss: 4, ssr: 5, hysteria2: 6, anytls: 7 };
                return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
            }
            return (a.name || '').localeCompare(b.name || '');
        });

        return allNodes;
    }

    /**
     * 生成节点唯一标识
     * @param {object} node - 节点对象
     * @returns {string} 唯一标识
     */
    generateNodeKey(node) {
        return this.stableStringify({
            type: node.type,
            server: node.server,
            port: node.port,
            method: node.method,
            password: node.password,
            plugin: node.plugin,
            plugin_opts: node.plugin_opts,
            uuid: node.uuid,
            alterId: node.alterId,
            cipher: node.cipher,
            tls: node.tls,
            security: node.security,
            sni: node.sni || node.servername,
            fingerprint: node.fingerprint,
            reality_opts: node.reality_opts,
            skip_cert_verify: node.skip_cert_verify,
            network: node.network,
            flow: node.flow,
            udp: node.udp,
            ws_opts: node.ws_opts,
            h2_opts: node.h2_opts,
            grpc_opts: node.grpc_opts,
            hysteria2_opts: node.hysteria2_opts,
            ssr_protocol: node.ssr_protocol,
            ssr_protocol_param: node.ssr_protocol_param,
            ssr_obfs: node.ssr_obfs,
            ssr_obfs_param: node.ssr_obfs_param,
            alpn: node.alpn,
        });
    }

    stableStringify(value) {
        if (Array.isArray(value)) {
            return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
        }
        if (value && typeof value === 'object') {
            return `{${Object.keys(value)
                .filter((key) => value[key] !== undefined && value[key] !== null && value[key] !== '')
                .sort()
                .map((key) => `${JSON.stringify(key)}:${this.stableStringify(value[key])}`)
                .join(',')}}`;
        }
        return JSON.stringify(value);
    }

    /**
     * 按类型过滤节点
     * @param {Array} nodes - 节点列表
     * @param {string} type - 节点类型
     * @returns {Array} 过滤后的节点列表
     */
    filterByType(nodes, type) {
        return nodes.filter(node => node.type === type);
    }

    /**
     * 获取节点统计信息
     * @param {Array} nodes - 节点列表
     * @returns {object} 统计信息
     */
    getStats(nodes) {
        const stats = {
            total: nodes.length,
            byType: {}
        };

        for (const node of nodes) {
            stats.byType[node.type] = (stats.byType[node.type] || 0) + 1;
        }

        return stats;
    }
}

module.exports = NodeMerger;
