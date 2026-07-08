/**
 * 配置生成器导出模块
 */
const SSGenerator = require('./ss');
const ClashGenerator = require('./clash');
const V2RayGenerator = require('./v2ray');
const ShareLinkGenerator = require('./share-links');

module.exports = {
    SSGenerator,
    ClashGenerator,
    V2RayGenerator,
    ShareLinkGenerator,
    // 格式映射
    ss: SSGenerator,
    clash: ClashGenerator,
    v2ray: V2RayGenerator,
    links: ShareLinkGenerator
};
