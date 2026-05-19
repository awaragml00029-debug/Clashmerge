const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const {
    detectSubscriptionFormat,
    ADD,
} = require("../services/converter");
const { applyExtensionScriptToContent, getExtensionScript, normalizeScript } = require("../services/extension-script");
const cache = require("../services/cache");

/**
 * 创建订阅转换路由
 * @param {object} db - 数据库实例
 * @returns {Router} Express 路由器
 */
function createConversionRoutes(db) {
    // 默认订阅数据（为空，将从数据库动态获取）
    let MainData = "";

    function normalizeFixedInbounds(config) {
        return Array.isArray(config?.fixedInbounds)
            ? config.fixedInbounds.filter((inbound) => inbound && inbound.enabled !== false)
            : [];
    }

    function hasEnabledFixedInbounds(config) {
        return normalizeFixedInbounds(config).length > 0;
    }

    function normalizeNativeOutputFormat(format) {
        return ["clash", "ss", "v2ray"].includes(format) ? format : "clash";
    }

    function createConfigHash(config) {
        return crypto
            .createHash("sha1")
            .update(JSON.stringify({
                conversionMode: config?.conversionMode || "native",
                mergeMode: config?.mergeMode || "dedupe",
                fixedInbounds: config?.fixedInbounds || [],
                fileName: config?.fileName || "ClashMerge",
            }))
            .digest("hex")
            .slice(0, 12);
    }

    function createSubscriptionsHash(subscriptions) {
        return crypto
            .createHash("sha1")
            .update(JSON.stringify((subscriptions || []).map((sub) => ({
                id: sub.id,
                type: sub.type,
                url: sub.url,
                active: sub.active,
                updated_at: sub.updated_at,
            }))))
            .digest("hex")
            .slice(0, 12);
    }

    function createLogId(value) {
        return crypto
            .createHash("sha1")
            .update(String(value || ""))
            .digest("hex")
            .slice(0, 8);
    }

    function getResponseHeaders(format, config, cacheState, cacheAge) {
        const isYaml = format === "clash";
        const fileName = String(config?.fileName || "ClashMerge").replace(/[\\/\r\n"]/g, "_");
        const headers = {
            "content-type": isYaml ? "text/yaml; charset=utf-8" : "text/plain; charset=utf-8",
            "Profile-Update-Interval": String(config?.subUpdateTime || 6),
            "X-Cache": cacheState,
            "X-Cache-Age": String(cacheAge),
        };

        if (isYaml) {
            headers["Content-Disposition"] = `inline; filename="${fileName}.yaml"`;
            headers["Profile-Title"] = fileName;
        }

        return headers;
    }

    /**
     * 后台异步刷新缓存
     * @param {string} cacheKey - 缓存key
     * @param {object} group - 分组对象
     * @param {string} format - 订阅格式
     * @param {string} mode - 转换模式
     * @param {number} ttl - 缓存有效期（小时）
     */
    async function refreshInBackground(cacheKey, group, format, mode, ttl) {
        const cacheLogId = createLogId(cacheKey);
        try {
            console.log(`后台刷新缓存: ${cacheLogId}`);
            cache.markRefreshing(cacheKey, true);

            // 执行订阅转换
            const content = await fetchSubscriptionContent(group, format, mode);

            // 更新缓存
            cache.set(cacheKey, content, format, ttl);
            console.log(`后台刷新完成: ${cacheLogId}`);
        } catch (error) {
            console.error(`后台刷新失败: ${cacheLogId}`, error);
        } finally {
            cache.markRefreshing(cacheKey, false);
        }
    }

    /**
     * 获取订阅内容（按分组）
     * @param {object} group - 分组对象
     * @param {string} format - 订阅格式
     * @param {string} mode - 转换模式
     * @returns {Promise<string>} 订阅内容
     */
    async function fetchSubscriptionContent(group, format, mode) {
        const conversionStart = Date.now();
        const groupLogId = createLogId(group.token);
        console.log(
            `[conversion-start] group=${group.name}, groupId=${groupLogId}, format=${format}, mode=${mode || "auto"}`
        );

        // 从数据库获取该分组下活跃的订阅和全局配置
        let activeUrls;
        let activeSubscriptions;
        let config;

        try {
            activeSubscriptions = await db.getActiveSubscriptionsByGroup(group.id);
            config = await db.getConfig();

            if (activeSubscriptions.length === 0) {
                console.log("数据库中没有活跃订阅，使用默认数据");
                activeUrls = await ADD(MainData);
            } else {
                activeUrls = expandSubscriptionUrls(activeSubscriptions);
                console.log("从数据库获取到", activeSubscriptions.length, "个活跃订阅，展开为", activeUrls.length, "条链接");
            }
        } catch (dbError) {
            console.error("数据库查询失败，使用默认数据:", dbError);
            activeUrls = await ADD(MainData);
            config = {
                conversionMode: 'native',
                fallbackEnabled: false,
                nativeConverterEnabled: true,
                fileName: "ClashMerge",
                mergeMode: "dedupe",
                fixedInbounds: [],
            };
        }

        const fixedInbounds = normalizeFixedInbounds(config);
        const mergeMode = config.mergeMode === "none" ? "none" : "dedupe";
        const conversionMode = "native";

        console.log(`转换模式: ${conversionMode}, 节点处理: ${mergeMode}`);
        const extensionScript = getExtensionScript();

        let subContent;

        try {
            console.log('使用原生转换器');
            const NativeConverter = require('../services/native');
            const converter = new NativeConverter();
            subContent = await converter.convert(activeUrls, format, { fixedInbounds, mergeMode });
        } catch (error) {
            console.error('原生转换失败:', error);
            throw error;
        }

        subContent = applyExtensionScriptToContent(
            extensionScript,
            subContent,
            format,
            config.fileName || "ClashMerge",
        );

        const durationMs = Date.now() - conversionStart;
        console.log(
            `[conversion-end] format=${format}, mode=${conversionMode}, durationMs=${durationMs}`
        );
        return subContent;
    }

    function expandSubscriptionUrls(subscriptions) {
        const urls = [];
        for (const sub of subscriptions) {
            if (!sub || !sub.url) continue;
            if (sub.type === "list" || sub.type === "node") {
                const parts = sub.url
                    .split(/[\r\n,;]+/)
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0);
                urls.push(...parts);
            } else {
                urls.push(sub.url);
            }
        }
        return urls;
    }

    router.get("/:path", async (req, res) => {
        const requestStart = Date.now();
        const requestId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;

        try {
            const rawPath = String(req.params.path || "");
            const pathRequestsYaml = /\.ya?ml$/i.test(rawPath);
            const pathToken = rawPath.replace(/\.ya?ml$/i, "");
            const forceRefresh = req.query.refresh === "true" || req.query.refresh === "1";
            const mode = req.query.mode; // 获取转换模式参数

            console.log(
                `[request-start][${requestId}] pathId=${createLogId(req.params.path)}, refresh=${forceRefresh}, mode=${mode || "auto"}`
            );

            // 从数据库动态获取配置
            const config = await db.getConfig();
            const currentSUBUpdateTime = config.subUpdateTime;

            // 按分组 token 查找分组，兼容旧的 config.token
            let group = await db.getGroupByToken(pathToken);

            // 兼容旧逻辑：query 参数中的 token
            if (!group) {
                const queryToken = req.query.token || "";
                if (queryToken) {
                    group = await db.getGroupByToken(queryToken);
                }
            }

            if (!group) {
                res
                    .status(403)
                    .type("text/plain; charset=utf-8")
                    .set("Profile-Update-Interval", currentSUBUpdateTime.toString());
                return res.send("oh no!");
            }

            const userAgentHeader = (req.headers["user-agent"] || "").toLowerCase();
            const formatQuery = pathRequestsYaml ? { ...req.query, target: "clash" } : req.query;
            const detectedFormat = detectSubscriptionFormat(userAgentHeader, formatQuery);
            const 订阅格式 = normalizeNativeOutputFormat(detectedFormat);
            if (detectedFormat !== 订阅格式) {
                console.warn(`本地转换暂不支持 ${detectedFormat}，已回退到 ${订阅格式}`);
            }
            const extensionScript = getExtensionScript();
            const extensionScriptHash = crypto
                .createHash("sha1")
                .update(normalizeScript(extensionScript))
                .digest("hex")
                .slice(0, 12);
            const configHash = createConfigHash(config);
            const activeSubscriptions = await db.getActiveSubscriptionsByGroup(group.id);
            const subscriptionsHash = createSubscriptionsHash(activeSubscriptions);
            const effectiveMode = "native";

            // 生成缓存key（包含分组 id、模式、脚本、导出配置和当前活跃订阅指纹）
            const cacheKey = cache.generateKey(group.token, 订阅格式, effectiveMode, `${extensionScriptHash}-${configHash}-${subscriptionsHash}`);
            const cacheLogId = createLogId(cacheKey);
            const groupLogId = createLogId(group.token);
            console.log(`生成缓存Key: ${cacheLogId} (group=${group.name}, groupId=${groupLogId}, format=${订阅格式}, mode=${effectiveMode}, script=${extensionScriptHash}, config=${configHash}, subscriptions=${subscriptionsHash})`);

            // 打印缓存统计
            const stats = cache.getStats();
            console.log(`当前缓存状态: 总数=${stats.size}`);

            // 如果不是强制刷新，尝试从缓存获取
            if (!forceRefresh) {
                const cached = cache.get(cacheKey);
                console.log(`缓存查询结果: ${cached ? '命中' : '未命中'}`);
                if (cached) {
                    const isValid = cache.isValid(cached);
                    const cacheAge = cache.getCacheAge(cached);

                    console.log(`缓存命中: ${cacheLogId}, isValid=${isValid}, age=${cacheAge}`);

                    // 立即返回缓存（即使过期）
                    res.set(getResponseHeaders(订阅格式, config, isValid ? "HIT" : "STALE", cacheAge));
                    res.send(cached.content);
                    console.log(
                        `[request-end][${requestId}] source=cache, cache=${isValid ? "HIT" : "STALE"}, durationMs=${Date.now() - requestStart}`
                    );

                    // 如果缓存过期且未在刷新中，后台异步刷新
                    if (!isValid && !cached.refreshing) {
                        // 异步刷新，不阻塞响应
                        refreshInBackground(cacheKey, group, 订阅格式, effectiveMode, currentSUBUpdateTime);
                    }

                    return;
                }
            }

            // 强制刷新或无缓存：同步获取
            if (forceRefresh) {
                console.log(`强制刷新: 删除当前缓存, cacheKey=${cacheLogId}`);
                cache.delete(cacheKey);
            } else {
                console.log(`缓存未命中: ${cacheLogId}`);
            }

            const subContent = await fetchSubscriptionContent(group, 订阅格式, effectiveMode);

            // 更新缓存
            cache.set(cacheKey, subContent, 订阅格式, currentSUBUpdateTime);

            console.log(`准备发送响应: forceRefresh=${forceRefresh}, cacheKey=${cacheLogId}`);
            res.set(getResponseHeaders(订阅格式, config, forceRefresh ? "REFRESH" : "MISS", 0));
            console.log("Headers set:", res.getHeaders());

            res.send(subContent);
            console.log(
                `[request-end][${requestId}] source=upstream, cache=${forceRefresh ? "REFRESH" : "MISS"}, durationMs=${Date.now() - requestStart}`
            );
        } catch (error) {
            console.error(`[request-failed][${requestId}]`, error);
            res.status(500).send("服务器内部错误");
        }
    });

    return router;
}

module.exports = createConversionRoutes;
