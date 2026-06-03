const express = require("express");
const router = express.Router();
const { getExtensionScript, saveExtensionScript } = require("../services/extension-script");

function normalizeFixedInbounds(value) {
    if (!Array.isArray(value)) return [];

    const usedPorts = new Set();
    return value
        .map((item) => {
            const port = Number(item?.port);
            const proxy = String(item?.proxy || item?.proxyName || "").trim();
            const type = ["http", "socks", "mixed"].includes(item?.type) ? item.type : "mixed";
            const listen = String(item?.listen || "0.0.0.0").trim() || "0.0.0.0";
            const name = String(item?.name || `fixed-${port}`).trim();
            const enabled = item?.enabled !== false;
            const username = String(item?.username || "").trim();
            const password = String(item?.password || "").trim();

            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                throw new Error("固定入口端口必须是 1-65535 的整数");
            }
            if (usedPorts.has(port)) {
                throw new Error(`固定入口端口重复: ${port}`);
            }
            if (!proxy) {
                throw new Error("固定入口绑定节点不能为空");
            }
            if (proxy.length > 200) {
                throw new Error("固定入口绑定节点名称过长");
            }
            if ((username && !password) || (!username && password)) {
                throw new Error("固定入口用户名和密码必须同时填写");
            }
            if (username.length > 100 || password.length > 100) {
                throw new Error("固定入口用户名或密码过长");
            }

            usedPorts.add(port);
            return { enabled, name, type, listen, port, proxy, username, password };
        });
}

function normalizeConfigPayload(config) {
    if (!config || typeof config !== "object") return config;

    const normalized = {
        ...config,
        conversionMode: "native",
        fallbackEnabled: false,
        nativeConverterEnabled: true,
        remoteConverterUrl: "",
    };

    normalized.exportMergeMode = config.exportMergeMode === "none" ? "none" : "dedupe";
    delete normalized.ruleMode;
    delete normalized.customRules;
    normalized.mihomoApiUrl = String(config.mihomoApiUrl || "").trim();
    normalized.mihomoSecret = String(config.mihomoSecret || "").trim();
    normalized.mihomoTestUrl = String(config.mihomoTestUrl || "").trim();

    if (Object.prototype.hasOwnProperty.call(config, "fixedInbounds")) {
        normalized.fixedInbounds = normalizeFixedInbounds(config.fixedInbounds);
    }

    return normalized;
}

/**
 * 创建配置管理相关路由
 * @param {object} db - 数据库实例
 * @returns {Router} Express 路由器
 */
function createConfigRoutes(db) {
    // 获取所有配置
    router.get("/api/config", async (req, res) => {
        try {
            const config = await db.getConfig();
            res.json(config);
        } catch (error) {
            console.error("获取配置失败:", error);
            res.status(500).json({ error: "获取配置失败" });
        }
    });

    // 更新配置
    router.put("/api/config", async (req, res) => {
        try {
            const newConfig = normalizeConfigPayload(req.body);
            const result = await db.updateConfig(newConfig);
            res.json({ message: "配置更新成功", config: result.config });
        } catch (error) {
            console.error("更新配置失败:", error);
            res.status(400).json({ error: error.message || "更新配置失败" });
        }
    });

    // 获取特定配置项
    router.get("/api/config/:key", async (req, res) => {
        try {
            const { key } = req.params;
            const value = await db.getConfigValue(key);
            res.json({ key, value });
        } catch (error) {
            console.error("获取配置项失败:", error);
            res.status(500).json({ error: "获取配置项失败" });
        }
    });

    // 设置特定配置项
    router.put("/api/config/:key", async (req, res) => {
        try {
            const { key } = req.params;
            const { value } = req.body;
            const localOnlyOverrides = {
                conversionMode: "native",
                fallbackEnabled: false,
                nativeConverterEnabled: true,
                remoteConverterUrl: "",
            };
            const nextValue = Object.prototype.hasOwnProperty.call(localOnlyOverrides, key)
                ? localOnlyOverrides[key]
                : key === "exportMergeMode"
                    ? (value === "none" ? "none" : "dedupe")
                    : value;
            await db.setConfigValue(key, nextValue);
            res.json({ message: "配置项更新成功", key, value: nextValue });
        } catch (error) {
            console.error("设置配置项失败:", error);
            res.status(500).json({ error: "设置配置项失败" });
        }
    });

    // 重置配置为默认值
    router.post("/api/config/reset", async (req, res) => {
        try {
            const result = await db.resetConfig();
            res.json({ message: "配置重置成功", config: result.config });
        } catch (error) {
            console.error("重置配置失败:", error);
            res.status(500).json({ error: "重置配置失败" });
        }
    });

    // 获取扩展脚本（单独文件持久化）
    router.get("/api/extension-script", async (req, res) => {
        try {
            const script = getExtensionScript();
            res.json({ script });
        } catch (error) {
            console.error("获取扩展脚本失败:", error);
            res.status(500).json({ error: "获取扩展脚本失败" });
        }
    });

    // 更新扩展脚本（单独文件持久化）
    router.put("/api/extension-script", async (req, res) => {
        try {
            const { script } = req.body;
            const savedScript = saveExtensionScript(script);
            res.json({ message: "扩展脚本更新成功", script: savedScript });
        } catch (error) {
            console.error("更新扩展脚本失败:", error);
            res.status(500).json({ error: "更新扩展脚本失败" });
        }
    });

    return router;
}

module.exports = createConfigRoutes;
