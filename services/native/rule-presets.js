const yaml = require("js-yaml");

const ACL4SSR_CONFIG_URL = "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full.ini";
const RULE_PRESET_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

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
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) return "";
  if (/^(payload:|---|\.\.\.)$/i.test(trimmed)) return "";
  const withoutListPrefix = trimmed.replace(/^[-*]\s+/, "").trim();
  if (!withoutListPrefix || withoutListPrefix.startsWith("#") || withoutListPrefix.startsWith(";")) return "";

  if (/^(final|match)$/i.test(withoutListPrefix)) {
    return `MATCH,${policy}`;
  }

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
