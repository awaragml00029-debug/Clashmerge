const yaml = require("js-yaml");

const ACL4SSR_CONFIG_URL = "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full.ini";
const RULE_PRESET_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CLASH_RULE_TYPES = new Set([
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "IP-CIDR",
  "SRC-IP-CIDR",
  "GEOIP",
  "MATCH",
  "FINAL",
  "IP-CIDR6",
  "SRC-PORT",
  "DST-PORT",
  "PROCESS-NAME",
  "DOMAIN-REGEX",
  "GEOSITE",
  "IP-SUFFIX",
  "IP-ASN",
  "SRC-GEOIP",
  "SRC-IP-ASN",
  "SRC-IP-SUFFIX",
  "IN-PORT",
  "IN-TYPE",
  "IN-USER",
  "IN-NAME",
  "PROCESS-PATH-REGEX",
  "PROCESS-PATH",
  "PROCESS-NAME-REGEX",
  "UID",
  "NETWORK",
  "DSCP",
  "SUB-RULE",
  "RULE-SET",
  "AND",
  "OR",
  "NOT",
]);
const CLASH_COMMA_PAYLOAD_RULE_TYPES = new Set([
  "AND",
  "OR",
  "NOT",
  "SUB-RULE",
  "DOMAIN-REGEX",
  "PROCESS-NAME-REGEX",
  "PROCESS-PATH-REGEX",
]);

const RULE_PRESETS = [
  {
    id: "default",
    name: "默认规则",
    description: "不添加额外规则集，只使用 ClashMerge 默认规则。",
  },
  {
    id: "acl4ssr",
    name: "ACL4SSR 默认规则",
    description: "服务端解析 ACL4SSR 规则和分组，客户端不需要下载 rule-providers。",
  },
];

const rulePresetCache = new Map();

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

  try {
    const config = await fetchText(ACL4SSR_CONFIG_URL, "acl4ssr-config");
    const parsed = parseAcl4ssrConfig(config);
    const rules = await buildAcl4ssrRules(parsed.rulesets);
    const content = yaml.dump(
      {
        "proxy-groups": parsed.proxyGroups,
        rules,
      },
      { lineWidth: -1, noRefs: true },
    );
    rulePresetCache.set("acl4ssr", { content, createdAt: Date.now() });
    return content;
  } catch (error) {
    if (cached?.content) {
      console.warn(`ACL4SSR 规则刷新失败，使用缓存: ${error.message}`);
      return cached.content;
    }
    throw error;
  }
}

function parseAcl4ssrConfig(content) {
  const rulesets = [];
  const proxyGroups = [];

  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#") || line.startsWith("[")) continue;

    if (line.startsWith("ruleset=")) {
      const ruleset = parseAcl4ssrRuleset(line.slice("ruleset=".length));
      if (ruleset) rulesets.push(ruleset);
      continue;
    }

    if (line.startsWith("custom_proxy_group=")) {
      const group = parseAcl4ssrProxyGroup(line.slice("custom_proxy_group=".length));
      if (group) proxyGroups.push(group);
    }
  }

  return { rulesets, proxyGroups };
}

function parseAcl4ssrRuleset(value) {
  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) return null;
  const policy = value.slice(0, commaIndex).trim();
  const source = value.slice(commaIndex + 1).trim();
  if (!policy || !source) return null;
  if (source.startsWith("[]")) {
    return { policy, inline: source.slice(2).trim() };
  }
  return { policy, url: source };
}

function parseAcl4ssrProxyGroup(value) {
  const parts = String(value || "")
    .split("`")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const [name, type, ...items] = parts;
  if (!name || !type) return null;

  const group = { name, type };
  const proxies = [];
  const include = [];

  for (const item of items) {
    if (item.startsWith("[]")) {
      const proxy = item.slice(2).trim();
      if (proxy) proxies.push(proxy);
      continue;
    }

    if (/^https?:\/\//i.test(item)) {
      group.url = item;
      continue;
    }

    const timing = item.match(/^(\d+)(?:,,(\d+))?$/);
    if (timing) {
      group.interval = Number(timing[1]);
      if (timing[2]) group.tolerance = Number(timing[2]);
      continue;
    }

    include.push(item);
  }

  if (proxies.length > 0) group.proxies = proxies;
  if (include.length > 0) group.include = include;
  return group;
}

async function buildAcl4ssrRules(rulesets) {
  const rules = [];
  const seen = new Set();
  const contents = await Promise.all(
    rulesets.map(async (ruleset) => {
      if (ruleset.inline) return ruleset.inline;
      return fetchText(ruleset.url, ruleset.policy);
    }),
  );

  rulesets.forEach((ruleset, index) => {
    for (const line of parseRuleSource(contents[index], ruleset.policy)) {
      if (seen.has(line)) continue;
      seen.add(line);
      rules.push(line);
    }
  });

  return rules;
}

async function fetchText(url, id) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ClashMerge/1.0",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`规则源下载失败: ${id} HTTP ${response.status}`);
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
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";") || trimmed.startsWith("//")) return "";
  if (/^(payload:|---|\.\.\.)$/i.test(trimmed)) return "";

  const rule = stripRuleQuotes(trimmed.replace(/^[-*]\s+/, "").trim());
  if (!rule || rule.startsWith("#") || rule.startsWith(";") || rule.startsWith("//")) return "";
  if (/^(final|match)$/i.test(rule)) return `MATCH,${policy}`;

  const commaIndex = rule.indexOf(",");
  if (commaIndex === -1) {
    return normalizePayloadRuleLine(rule, policy);
  }

  const ruleType = rule.slice(0, commaIndex).trim().toUpperCase();
  if (ruleType === "FINAL" || ruleType === "MATCH") return `MATCH,${policy}`;
  if (!CLASH_RULE_TYPES.has(ruleType)) return "";

  const withoutComment = stripInlineComment(rule);
  if (!withoutComment) return "";
  if (CLASH_COMMA_PAYLOAD_RULE_TYPES.has(ruleType)) {
    return `${withoutComment},${policy}`;
  }

  return appendClashRulePolicy(withoutComment, policy);
}

function stripRuleQuotes(value) {
  const text = String(value || "").trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return text.slice(1, -1).trim();
    }
  }
  return text;
}

function stripInlineComment(value) {
  const text = String(value || "").trim();
  const commentIndex = text.indexOf("//");
  if (commentIndex === -1) return text;
  return text.slice(0, commentIndex).trim();
}

function normalizePayloadRuleLine(rule, policy) {
  const value = stripInlineComment(rule);
  if (!value || /\s/.test(value)) return "";

  if (/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(value)) {
    return `IP-CIDR,${value},${policy}`;
  }
  if (/^[0-9a-f:.]+\/\d{1,3}$/i.test(value) && value.includes(":")) {
    return `IP-CIDR6,${value},${policy}`;
  }

  if (value.startsWith("+.") || value.startsWith(".")) {
    return `DOMAIN-SUFFIX,${value.replace(/^\+?\./, "")},${policy}`;
  }

  if (/^[a-z0-9.-]+$/i.test(value)) {
    return `DOMAIN,${value},${policy}`;
  }

  return "";
}

function appendClashRulePolicy(rule, policy) {
  const parts = String(rule || "").split(",").map((part) => part.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) return "";

  const normalized = [parts[0].toUpperCase(), parts[1], policy];
  const option = parts[2];
  if (option && /^no-resolve$/i.test(option)) {
    normalized.push("no-resolve");
  }
  return normalized.join(",");
}

function listRulePresets() {
  return RULE_PRESETS.map((item) => ({ ...item }));
}

module.exports = {
  getRulePresetContent,
  listRulePresets,
  normalizeRulePreset,
};
