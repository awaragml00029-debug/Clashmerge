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
    description: "服务端展开 ACL4SSR 常用规则，客户端不需要再下载 rule-providers。",
  },
];

const rulePresetCache = new Map();
const RULE_PRESET_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function normalizeRulePreset(value) {
  const preset = String(value || "default").trim();
  return RULE_PRESETS.some((item) => item.id === preset) ? preset : "default";
}

async function getRulePresetContent(value) {
  return normalizeRulePreset(value) === "acl4ssr" ? getAcl4ssrRules() : "";
}

async function getAcl4ssrRules() {
  const cached = rulePresetCache.get("acl4ssr");
  if (cached && Date.now() - cached.createdAt < RULE_PRESET_CACHE_TTL_MS) {
    return cached.content;
  }

  const rules = [];
  const seen = new Set();
  for (const source of ACL4SSR_RULE_SOURCES) {
    const content = await fetchRuleSource(source);
    for (const line of parseRuleSource(content, source.policy)) {
      if (seen.has(line)) continue;
      seen.add(line);
      rules.push(line);
    }
  }

  rules.push("GEOIP,CN,DIRECT");
  rules.push("MATCH,🚀 节点选择");

  const content = rules.join("\n");
  rulePresetCache.set("acl4ssr", { content, createdAt: Date.now() });
  return content;
}

async function fetchRuleSource(source) {
  const response = await fetch(source.url, {
    headers: {
      "User-Agent": "ClashMerge/1.0",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`规则源下载失败: ${source.id} HTTP ${response.status}`);
  }
  return response.text();
}

function parseRuleSource(content, policy) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => normalizeRuleLine(line, policy))
    .filter(Boolean);
}

function normalizeRuleLine(line, policy) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return "";
  if (/^(payload:|---|\.\.\.)$/i.test(trimmed)) return "";
  const withoutListPrefix = trimmed.replace(/^[-*]\s+/, "").trim();
  if (!withoutListPrefix || withoutListPrefix.startsWith("#")) return "";

  const parts = withoutListPrefix.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return "";

  const last = parts[parts.length - 1].toLowerCase();
  if (last === "no-resolve") {
    return [...parts.slice(0, -1), policy, "no-resolve"].join(",");
  }

  return [...parts, policy].join(",");
}

function listRulePresets() {
  return RULE_PRESETS.map((item) => ({ ...item }));
}

module.exports = {
  getRulePresetContent,
  listRulePresets,
  normalizeRulePreset,
};
