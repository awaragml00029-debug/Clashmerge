const ACL4SSR_RULE_SOURCES = [
  {
    id: "acl4ssr-lan",
    policy: "DIRECT",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list",
  },
  {
    id: "acl4ssr-unban",
    policy: "DIRECT",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/UnBan.list",
  },
  {
    id: "acl4ssr-ban-ad",
    policy: "REJECT",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list",
  },
  {
    id: "acl4ssr-ban-program-ad",
    policy: "REJECT",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list",
  },
  {
    id: "acl4ssr-google-cn",
    policy: "DIRECT",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/GoogleCN.list",
  },
  {
    id: "acl4ssr-steam-cn",
    policy: "DIRECT",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/SteamCN.list",
  },
  {
    id: "acl4ssr-ai",
    policy: "🚀 节点选择",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/AI.list",
  },
  {
    id: "acl4ssr-proxy-gfw",
    policy: "🚀 节点选择",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ProxyGFWlist.list",
  },
  {
    id: "acl4ssr-china-domain",
    policy: "DIRECT",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list",
  },
  {
    id: "acl4ssr-china-company-ip",
    policy: "DIRECT",
    url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list",
  },
];

const RULE_PRESETS = [
  {
    id: "default",
    name: "默认规则",
    description: "不添加额外规则集，只使用 ClashMerge 默认规则。",
  },
  {
    id: "acl4ssr",
    name: "ACL4SSR 默认规则",
    description: "使用 ACL4SSR rule-providers，客户端按需下载规则集。",
  },
];

const ACL4SSR_DEFAULT_RULES = buildAcl4ssrRuleProviders();

function normalizeRulePreset(value) {
  const preset = String(value || "default").trim();
  return RULE_PRESETS.some((item) => item.id === preset) ? preset : "default";
}

function getRulePresetContent(value) {
  return normalizeRulePreset(value) === "acl4ssr" ? ACL4SSR_DEFAULT_RULES : "";
}

function buildAcl4ssrRuleProviders() {
  const providerLines = ACL4SSR_RULE_SOURCES.flatMap((source) => [
    `  ${source.id}:`,
    "    type: http",
    "    behavior: classical",
    `    url: ${source.url}`,
    `    path: ./ruleset/${source.id}.list`,
    "    interval: 86400",
  ]);
  const ruleLines = ACL4SSR_RULE_SOURCES.map((source) => `  - RULE-SET,${source.id},${source.policy}`);

  return [
    "rule-providers:",
    ...providerLines,
    "rules:",
    ...ruleLines,
    "  - GEOIP,CN,DIRECT",
    "  - MATCH,🚀 节点选择",
  ].join("\n");
}

function listRulePresets() {
  return RULE_PRESETS.map((item) => ({ ...item }));
}

module.exports = {
  getRulePresetContent,
  listRulePresets,
  normalizeRulePreset,
};
