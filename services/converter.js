/**
 * 解析订阅地址
 * @param {string} envAdd - 订阅地址字符串
 * @returns {Promise<Array<string>>} 订阅地址数组
 */
async function ADD(envAdd) {
    let addText = envAdd.replace(/[\t"'|\r\n]+/g, "\n").replace(/\n+/g, "\n");
    if (addText.charAt(0) === "\n") addText = addText.slice(1);
    if (addText.charAt(addText.length - 1) === "\n")
        addText = addText.slice(0, addText.length - 1);
    const add = addText.split("\n");
    console.log("节点列表:", add);
    return add;
}

/**
 * 根据 User-Agent 检测订阅格式
 * @param {string} userAgentHeader - User-Agent 请求头
 * @param {object} query - 查询参数
 * @returns {string} 订阅格式
 */
function detectSubscriptionFormat(userAgentHeader, query) {
    userAgentHeader = userAgentHeader.toLowerCase();

    const explicitTarget = String(query.target || query.format || "").toLowerCase();
    if (["clash", "clash.yaml", "yaml", "meta", "mihomo"].includes(explicitTarget)) {
        return "clash";
    }
    if (["ss", "shadowsocks"].includes(explicitTarget)) {
        return "ss";
    }
    if (["v2ray", "v2ray.json"].includes(explicitTarget)) {
        return "v2ray";
    }
    if (["singbox", "sing-box"].includes(explicitTarget)) {
        return "singbox";
    }

    if (
        userAgentHeader.includes("null") ||
        userAgentHeader.includes("subconverter") ||
        userAgentHeader.includes("nekobox") ||
        userAgentHeader.includes("cf-workers-sub")
    ) {
        return "ss";
    } else if (
        userAgentHeader.includes("clash") ||
        ("clash" in query && !userAgentHeader.includes("subconverter"))
    ) {
        return "clash";
    } else if (
        userAgentHeader.includes("sing-box") ||
        userAgentHeader.includes("singbox") ||
        (("sb" in query || "singbox" in query) &&
            !userAgentHeader.includes("subconverter"))
    ) {
        return "singbox";
    } else if (
        userAgentHeader.includes("surge") ||
        ("surge" in query && !userAgentHeader.includes("subconverter"))
    ) {
        return "surge";
    } else if (
        userAgentHeader.includes("quantumult%20x") ||
        ("quanx" in query && !userAgentHeader.includes("subconverter"))
    ) {
        return "quanx";
    } else if (
        userAgentHeader.includes("loon") ||
        ("loon" in query && !userAgentHeader.includes("subconverter"))
    ) {
        return "loon";
    }

    return "ss";
}

module.exports = {
    ADD,
    detectSubscriptionFormat,
};
