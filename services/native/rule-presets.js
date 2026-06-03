const ACL4SSR_DEFAULT_RULES = `rule-providers:
  acl4ssr-lan:
    type: http
    behavior: classical
    url: https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list
    path: ./ruleset/acl4ssr-lan.list
    interval: 86400
  acl4ssr-unban:
    type: http
    behavior: classical
    url: https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/UnBan.list
    path: ./ruleset/acl4ssr-unban.list
    interval: 86400
  acl4ssr-ban-ad:
    type: http
    behavior: classical
    url: https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list
    path: ./ruleset/acl4ssr-ban-ad.list
    interval: 86400
  acl4ssr-ban-program-ad:
    type: http
    behavior: classical
    url: https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list
    path: ./ruleset/acl4ssr-ban-program-ad.list
    interval: 86400
  acl4ssr-google-cn:
    type: http
    behavior: classical
    url: https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/GoogleCN.list
    path: ./ruleset/acl4ssr-google-cn.list
    interval: 86400
  acl4ssr-steam-cn:
    type: http
    behavior: classical
    url: https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/SteamCN.list
    path: ./ruleset/acl4ssr-steam-cn.list
    interval: 86400
  acl4ssr-ai:
    type: http
    behavior: classical
    url: https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/AI.list
    path: ./ruleset/acl4ssr-ai.list
    interval: 86400
  acl4ssr-proxy-gfw:
    type: http
    behavior: classical
    url: https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ProxyGFWlist.list
    path: ./ruleset/acl4ssr-proxy-gfw.list
    interval: 86400
  acl4ssr-china-domain:
    type: http
    behavior: classical
    url: https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list
    path: ./ruleset/acl4ssr-china-domain.list
    interval: 86400
  acl4ssr-china-company-ip:
    type: http
    behavior: classical
    url: https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list
    path: ./ruleset/acl4ssr-china-company-ip.list
    interval: 86400
rules:
  - RULE-SET,acl4ssr-lan,DIRECT
  - RULE-SET,acl4ssr-unban,DIRECT
  - RULE-SET,acl4ssr-ban-ad,REJECT
  - RULE-SET,acl4ssr-ban-program-ad,REJECT
  - RULE-SET,acl4ssr-google-cn,DIRECT
  - RULE-SET,acl4ssr-steam-cn,DIRECT
  - RULE-SET,acl4ssr-ai,🚀 节点选择
  - RULE-SET,acl4ssr-proxy-gfw,🚀 节点选择
  - RULE-SET,acl4ssr-china-domain,DIRECT
  - RULE-SET,acl4ssr-china-company-ip,DIRECT
  - GEOIP,CN,DIRECT
  - MATCH,🚀 节点选择`;

const RULE_PRESETS = [
  {
    id: "default",
    name: "默认规则",
    description: "不添加额外规则集，只使用 ClashMerge 默认规则。",
  },
  {
    id: "acl4ssr",
    name: "ACL4SSR 默认规则",
    description: "使用 ACL4SSR 常用直连、广告、AI、ProxyGFW 和国内规则集。",
  },
];

function normalizeRulePreset(value) {
  const preset = String(value || "default").trim();
  return RULE_PRESETS.some((item) => item.id === preset) ? preset : "default";
}

function getRulePresetContent(value) {
  return normalizeRulePreset(value) === "acl4ssr" ? ACL4SSR_DEFAULT_RULES : "";
}

function listRulePresets() {
  return RULE_PRESETS.map((item) => ({ ...item }));
}

module.exports = {
  getRulePresetContent,
  listRulePresets,
  normalizeRulePreset,
};
