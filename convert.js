/*
powerfullz 的 Substore 订阅转换脚本
https://github.com/powerfullz/override-rules

支持的传入参数：
- loadbalance: 启用负载均衡（url-test/load-balance，默认 false）
- landing: 启用落地节点功能（如机场家宽/星链/落地分组，默认 false）
- ipv6: 启用 IPv6 支持（默认 false）
- full: 输出完整配置（适合纯内核启动，默认 false）
- keepalive: 启用 tcp-keep-alive（默认 false）
- fakeip: DNS 使用 FakeIP 模式（默认 true，false 为 RedirHost）
- quic: 允许 QUIC 流量（UDP 443，默认 false）
- threshold: 国家节点数量小于该值时不显示分组 (默认 0)
*/

const NODE_SUFFIX = "节点";

function parseBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value === "1";
  }
  return false;
}

function parseNumber(value, defaultValue = 0) {
  if (value === null || typeof value === "undefined") {
    return defaultValue;
  }
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

/**
 * 解析传入的脚本参数，并将其转换为内部使用的功能开关（feature flags）。
 * @param {object} args - 传入的原始参数对象，如 $arguments。
 * @returns {object} - 包含所有功能开关状态的对象。
 *
 * 该函数通过一个 `spec` 对象定义了外部参数名（如 `loadbalance`）到内部变量名（如 `loadBalance`）的映射关系。
 * 它会遍历 `spec` 中的每一项，对 `args` 对象中对应的参数值调用 `parseBool` 函数进行布尔化处理，
 * 并将结果存入返回的对象中。
 */
function buildFeatureFlags(args) {
  // 定义 dns 配置参数默认值
  const defaults = {
    fakeip: true,
    ipv6: false,
    quic: false,
    loadbalance: false,
    landing: false,
    keepalive: false,
    full: false,
  };
  const spec = {
    loadbalance: "loadBalance",
    landing: "landing",
    ipv6: "ipv6Enabled",
    full: "fullConfig",
    keepalive: "keepAliveEnabled",
    fakeip: "fakeIPEnabled",
    quic: "quicEnabled",
  };

  const flags = {};
  for (const [src, dst] of Object.entries(spec)) {
    flags[dst] = src in args ? parseBool(args[src]) : defaults[src];
  }

  // 单独处理数字参数
  flags.countryThreshold = parseNumber(args.threshold, 0);

  return flags;
}

const rawArgs = typeof $arguments !== "undefined" ? $arguments : {};
const {
  loadBalance,
  landing,
  ipv6Enabled,
  fullConfig,
  keepAliveEnabled,
  fakeIPEnabled,
  quicEnabled,
  countryThreshold,
} = buildFeatureFlags(rawArgs);

function getCountryGroupNames(countryInfo, minCount) {
  return countryInfo
    .filter((item) => item.count >= minCount)
    .map((item) => item.country + NODE_SUFFIX);
}

function stripNodeSuffix(groupNames) {
  const suffixPattern = new RegExp(`${NODE_SUFFIX}$`);
  return groupNames.map((name) => name.replace(suffixPattern, ""));
}

const PROXY_GROUPS = {
  SELECT: "选择代理",
  MANUAL: "手动选择",
  FALLBACK: "故障转移",
  DIRECT: "直连",
  LANDING: "落地节点",
  LOW_COST: "低倍率节点",
};

// 辅助函数，用于根据条件构建数组，自动过滤掉无效值（如 false, null）
const buildList = (...elements) => elements.flat().filter(Boolean);

function buildBaseLists({ landing, lowCost, countryGroupNames }) {
  // 使用辅助函数和常量，以声明方式构建各个代理列表

  // “选择节点”组的候选列表
  const defaultSelector = buildList(
    PROXY_GROUPS.FALLBACK,
    landing && PROXY_GROUPS.LANDING,
    countryGroupNames,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.MANUAL,
    "DIRECT"
  );

  // 默认的代理列表，用于大多数策略组
  const defaultProxies = buildList(
    PROXY_GROUPS.SELECT,
    countryGroupNames,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.MANUAL,
    PROXY_GROUPS.DIRECT
  );

  // “直连”优先的代理列表
  const defaultProxiesDirect = buildList(
    PROXY_GROUPS.DIRECT,
    countryGroupNames,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.SELECT,
    PROXY_GROUPS.MANUAL
  );

  // “故障转移”组的代理列表
  const defaultFallback = buildList(
    landing && PROXY_GROUPS.LANDING,
    countryGroupNames,
    lowCost && PROXY_GROUPS.LOW_COST,
    PROXY_GROUPS.MANUAL,
    "DIRECT"
  );

  return {
    defaultProxies,
    defaultProxiesDirect,
    defaultSelector,
    defaultFallback,
  };
}

const ruleProviders = {
  ADBlock: {
    type: "http",
    behavior: "domain",
    format: "mrs",
    interval: 86400,
    url: "https://adrules.top/adrules-mihomo.mrs",
    path: "./ruleset/ADBlock.mrs",
  },
  StaticResources: {
    type: "http",
    behavior: "domain",
    format: "text",
    interval: 86400,
    url: "https://ruleset.skk.moe/Clash/domainset/cdn.txt",
    path: "./ruleset/StaticResources.txt",
  },
  CDNResources: {
    type: "http",
    behavior: "classical",
    format: "text",
    interval: 86400,
    url: "https://ruleset.skk.moe/Clash/non_ip/cdn.txt",
    path: "./ruleset/CDNResources.txt",
  },
  TikTok: {
    type: "http",
    behavior: "classical",
    format: "text",
    interval: 86400,
    url: "https://gcore.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/TikTok.list",
    path: "./ruleset/TikTok.list",
  },
  SteamFix: {
    type: "http",
    behavior: "classical",
    format: "text",
    interval: 86400,
    url: "https://gcore.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/SteamFix.list",
    path: "./ruleset/SteamFix.list",
  },
  GoogleFCM: {
    type: "http",
    behavior: "classical",
    format: "text",
    interval: 86400,
    url: "https://gcore.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/FirebaseCloudMessaging.list",
    path: "./ruleset/FirebaseCloudMessaging.list",
  },
  AdditionalFilter: {
    type: "http",
    behavior: "classical",
    format: "text",
    interval: 86400,
    url: "https://gcore.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/AdditionalFilter.list",
    path: "./ruleset/AdditionalFilter.list",
  },
  AdditionalCDNResources: {
    type: "http",
    behavior: "classical",
    format: "text",
    interval: 86400,
    url: "https://gcore.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/AdditionalCDNResources.list",
    path: "./ruleset/AdditionalCDNResources.list",
  },
  Crypto: {
    type: "http",
    behavior: "classical",
    format: "text",
    interval: 86400,
    url: "https://gcore.jsdelivr.net/gh/powerfullz/override-rules@master/ruleset/Crypto.list",
    path: "./ruleset/Crypto.list",
  },
  BanProgramAD: {
    url: "https://testingcf.jsdelivr.net/gh/ACL4SSR/ACL4SSR@master/Clash/BanProgramAD.list",
    path: "./ruleset/BanProgramAD.list",
    behavior: "classical",
    interval: 86400,
    format: "text",
    type: "http",
  },
};

const baseRules = [
  `RULE-SET,ADBlock,广告拦截`,
  "RULE-SET,BanProgramAD,应用净化",
  `RULE-SET,AdditionalFilter,广告拦截`,
  `DOMAIN-SUFFIX,truthsocial.com,Truth Social`,
  `RULE-SET,StaticResources,静态资源`,
  `RULE-SET,CDNResources,静态资源`,
  `RULE-SET,AdditionalCDNResources,静态资源`,
  `RULE-SET,Crypto,Crypto`,
  `RULE-SET,TikTok,TikTok`,
  `RULE-SET,SteamFix,${PROXY_GROUPS.DIRECT}`,
  `RULE-SET,GoogleFCM,${PROXY_GROUPS.DIRECT}`,
  `DOMAIN,services.googleapis.cn,${PROXY_GROUPS.SELECT}`,
  "GEOSITE,STEAM,Game",
  "GEOSITE,EPICGAMES,Game",
  "GEOSITE,NINTENDO,Game",
  `GEOSITE,GOOGLE-PLAY@CN,${PROXY_GROUPS.DIRECT}`,
  "GEOSITE,ONEDRIVE,OneDrive",
  "GEOSITE,BING,Bing",
  "GEOSITE,MICROSOFT,Microsoft",
  "GEOSITE,CATEGORY-AI-!CN,AI",
  "GEOSITE,TELEGRAM,Telegram",
  "GEOSITE,YOUTUBE,YouTube",
  "GEOSITE,GOOGLE,Google",
  "GEOSITE,APPLE,Apple",
  "GEOSITE,NETFLIX,Netflix",
  "GEOSITE,SPOTIFY,Spotify",
  "GEOSITE,BILIBILI,Bilibili",
  `GEOSITE,MICROSOFT@CN,${PROXY_GROUPS.DIRECT}`,
  `GEOSITE,GFW,${PROXY_GROUPS.SELECT}`,
  `GEOSITE,CN,${PROXY_GROUPS.DIRECT}`,
  `GEOSITE,PRIVATE,${PROXY_GROUPS.DIRECT}`,
  "GEOIP,NETFLIX,Netflix,no-resolve",
  "GEOIP,TELEGRAM,Telegram,no-resolve",
  `GEOIP,CN,${PROXY_GROUPS.DIRECT}`,
  `GEOIP,PRIVATE,${PROXY_GROUPS.DIRECT}`,
  "DST-PORT,22,SSH(22端口)",
  `MATCH,${PROXY_GROUPS.SELECT}`,
];

function buildRules({ quicEnabled }) {
  const ruleList = [...baseRules];
  if (!quicEnabled) {
    // 屏蔽 QUIC 流量，避免网络环境 UDP 速度不佳时影响体验
    ruleList.unshift("AND,((DST-PORT,443),(NETWORK,UDP)),REJECT");
  }
  return ruleList;
}

const snifferConfig = {
  sniff: {
    TLS: {
      ports: [443, 8443],
    },
    HTTP: {
      ports: [80, 8080, 8880],
    },
    QUIC: {
      ports: [443, 8443],
    },
  },
  "override-destination": false,
  enable: true,
  "force-dns-mapping": true,
  "skip-domain": ["Mijia Cloud", "dlg.io.mi.com", "+.push.apple.com"],
};

function buildDnsConfig({ mode, fakeIpFilter }) {
  const config = {
    enable: true,
    listen: ":53",
    "enhanced-mode": mode,
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter-mode": "blacklist",
    "prefer-h3": true,
    "respect-rules": true,
    ipv6: ipv6Enabled,
    "default-nameserver": ["223.6.6.6", "223.5.5.5"],
    nameserver: ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"],
    "proxy-server-nameserver": [
      "https://1.1.1.1/dns-query",
      "https://8.8.8.8/dns-query",
    ],
    "direct-nameserver-follow-policy": true,
    "direct-nameserver": [
      "https://223.5.5.5/dns-query",
      "https://223.6.6.6/dns-query",
    ],
  };

  if (fakeIpFilter) {
    config["fake-ip-filter"] = fakeIpFilter;
  }

  return config;
}

const dnsConfig = buildDnsConfig({ mode: "redir-host" });
const dnsConfigFakeIp = buildDnsConfig({
  mode: "fake-ip",
  fakeIpFilter: [
    "geosite:private",
    "geosite:connectivity-check",
    "geosite:category-ntp",
  ],
});

const geoxURL = {
  geoip:
    "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat",
  geosite:
    "https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geosite.dat",
  mmdb: "https://gcore.jsdelivr.net/gh/Loyalsoldier/geoip@release/Country.mmdb",
  asn: "https://gcore.jsdelivr.net/gh/Loyalsoldier/geoip@release/GeoLite2-ASN.mmdb",
};

// 地区元数据
const countriesMeta = {
  香港: {
    pattern: "香港|港|HK|hk|Hong Kong|HongKong|hongkong|🇭🇰",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Hong_Kong.png",
  },
  澳门: {
    pattern: "澳门|MO|Macau|🇲🇴",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Macao.png",
  },
  台湾: {
    pattern: "台|新北|彰化|TW|Taiwan|🇹🇼",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Taiwan.png",
  },
  新加坡: {
    pattern: "新加坡|坡|狮城|SG|Singapore|🇸🇬",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Singapore.png",
  },
  日本: {
    pattern: "日本|川日|东京|大阪|泉日|埼玉|沪日|深日|JP|Japan|🇯🇵",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Japan.png",
  },
  韩国: {
    pattern: "KR|Korea|KOR|首尔|韩|韓|🇰🇷",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Korea.png",
  },
  美国: {
    pattern: "美国|美|US|United States|🇺🇸",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/United_States.png",
  },
  加拿大: {
    pattern: "加拿大|Canada|CA|🇨🇦",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Canada.png",
  },
  英国: {
    pattern: "英国|United Kingdom|UK|伦敦|London|🇬🇧",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/United_Kingdom.png",
  },
  澳大利亚: {
    pattern: "澳洲|澳大利亚|AU|Australia|🇦🇺",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Australia.png",
  },
  德国: {
    pattern: "德国|德|DE|Germany|🇩🇪",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Germany.png",
  },
  法国: {
    pattern: "法国|法|FR|France|🇫🇷",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/France.png",
  },
  俄罗斯: {
    pattern: "俄罗斯|俄|RU|Russia|🇷🇺",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Russia.png",
  },
  泰国: {
    pattern: "泰国|泰|TH|Thailand|🇹🇭",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Thailand.png",
  },
  印度: {
    pattern: "印度|IN|India|🇮🇳",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/India.png",
  },
  马来西亚: {
    pattern: "马来西亚|马来|MY|Malaysia|🇲🇾",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Malaysia.png",
  },
};

function hasLowCost(config) {
  const lowCostRegex = /0\.[0-5]|低倍率|省流|大流量|实验性/i;
  return (config.proxies || []).some((proxy) => lowCostRegex.test(proxy.name));
}

function parseCountries(config) {
  const proxies = config.proxies || [];
  const ispRegex = /家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地/i; // 需要排除的关键字

  // 用来累计各国节点数
  const countryCounts = Object.create(null);

  // 构建地区正则表达式：区分大小写（避免 node 里的 "de" 误匹配到 "DE" -> 德国）
  const compiledRegex = {};
  for (const [country, meta] of Object.entries(countriesMeta)) {
    // 兼容旧配置：如果 pattern 仍以 (?i) 开头，这里会剥离掉以避免 JS RegExp 报错
    compiledRegex[country] = new RegExp(meta.pattern.replace(/^\(\?i\)/, ""));
  }

  // 逐个节点进行匹配与统计
  for (const proxy of proxies) {
    const name = proxy.name || "";

    // 过滤掉不想统计的 ISP 节点
    if (ispRegex.test(name)) continue;

    // 找到第一个匹配到的地区就计数并终止本轮
    for (const [country, regex] of Object.entries(compiledRegex)) {
      if (regex.test(name)) {
        countryCounts[country] = (countryCounts[country] || 0) + 1;
        break; // 避免一个节点同时累计到多个地区
      }
    }
  }

  // 将结果对象转成数组形式
  const result = [];
  for (const [country, count] of Object.entries(countryCounts)) {
    result.push({ country, count });
  }

  return result; // [{ country: 'Japan', count: 12 }, ...]
}

function buildCountryProxyGroups({ countries, landing, loadBalance }) {
  const groups = [];
  const baseExcludeFilter = "0\\.[0-5]|低倍率|省流|大流量|实验性";
  const landingExcludeFilter =
    "(?i)家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地";
  const groupType = loadBalance ? "load-balance" : "url-test";

  for (const country of countries) {
    const meta = countriesMeta[country];
    if (!meta) continue;

    const groupConfig = {
      name: `${country}${NODE_SUFFIX}`,
      icon: meta.icon,
      "include-all": true,
      filter: meta.pattern,
      "exclude-filter": landing
        ? `${landingExcludeFilter}|${baseExcludeFilter}`
        : baseExcludeFilter,
      type: groupType,
    };

    if (!loadBalance) {
      Object.assign(groupConfig, {
        url: "https://cp.cloudflare.com/generate_204",
        interval: 60,
        tolerance: 20,
        lazy: false,
      });
    }

    groups.push(groupConfig);
  }
  return groups;
}

function buildProxyGroups({
  landing,
  countries,
  countryProxyGroups,
  lowCost,
  defaultProxies,
  defaultProxiesDirect,
  defaultSelector,
  defaultFallback,
}) {
  // 查看是否有特定地区的节点
  const hasTW = countries.includes("台湾");
  const hasHK = countries.includes("香港");
  const hasUS = countries.includes("美国");
  const hasSG = countries.includes("新加坡");
  const hasJP = countries.includes("日本");
  // 排除落地节点、选择节点和故障转移以避免死循环
  const frontProxySelector = landing
    ? defaultSelector.filter(
        (name) =>
          name !== PROXY_GROUPS.LANDING && name !== PROXY_GROUPS.FALLBACK
      )
    : [];

  return [
    {
      name: PROXY_GROUPS.SELECT,
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Proxy.png",
      type: "select",
      proxies: defaultSelector,
    },
    {
      name: PROXY_GROUPS.MANUAL,
      icon: "https://gcore.jsdelivr.net/gh/shindgewongxj/WHATSINStash@master/icon/select.png",
      "include-all": true,
      type: "select",
    },
    landing
      ? {
          name: "前置代理",
          icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Area.png",
          type: "select",
          "include-all": true,
          "exclude-filter":
            "(?i)家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地",
          proxies: frontProxySelector,
        }
      : null,
    landing
      ? {
          name: PROXY_GROUPS.LANDING,
          icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Airport.png",
          type: "select",
          "include-all": true,
          filter: "(?i)家宽|家庭|家庭宽带|商宽|商业宽带|星链|Starlink|落地",
        }
      : null,
    ...countryProxyGroups,
    {
      name: "Telegram",
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Telegram.png",
      type: "url-test",
      interval: 60,
      tolerance: 50,
      proxies:
        hasHK && hasJP && hasSG
          ? ["香港节点", "新加坡节点", "日本节点"]
          : defaultProxiesDirect,
    },
    {
      name: "AI",
      icon: "https://gcore.jsdelivr.net/gh/powerfullz/override-rules@master/icons/chatgpt.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "OneDrive",
      icon: "https://gcore.jsdelivr.net/gh/powerfullz/override-rules@master/icons/Onedrive.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "Bing",
      icon: "https://testingcf.jsdelivr.net/gh/shindgewongxj/WHATSINStash@master/icon/bing.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "Microsoft",
      icon: "https://gcore.jsdelivr.net/gh/powerfullz/override-rules@master/icons/Microsoft_Copilot.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "YouTube",
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/YouTube.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "Google",
      icon: "https://gcore.jsdelivr.net/gh/powerfullz/override-rules@master/icons/Google.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "Apple",
      icon: "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Apple.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "Bilibili",
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/bilibili.png",
      type: "select",
      proxies:
        hasTW && hasHK
          ? [PROXY_GROUPS.DIRECT, "台湾节点", "香港节点"]
          : defaultProxiesDirect,
    },
    {
      name: "Netflix",
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Netflix.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "TikTok",
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/TikTok.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "Spotify",
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Spotify.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "Game",
      icon: "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Game.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "Truth Social",
      icon: "https://gcore.jsdelivr.net/gh/powerfullz/override-rules@master/icons/TruthSocial.png",
      type: "select",
      proxies: hasUS
        ? ["美国节点", PROXY_GROUPS.SELECT, PROXY_GROUPS.MANUAL]
        : defaultProxies,
    },
    {
      name: "Crypto",
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Cryptocurrency_3.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "静态资源",
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Cloudflare.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: "SSH(22端口)",
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Server.png",
      type: "select",
      proxies: defaultProxies,
    },
    {
      name: PROXY_GROUPS.FALLBACK,
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Bypass.png",
      type: "fallback",
      url: "https://cp.cloudflare.com/generate_204",
      proxies: defaultFallback,
      interval: 180,
      tolerance: 20,
      lazy: false,
    },
    {
      name: PROXY_GROUPS.DIRECT,
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Direct.png",
      type: "select",
      proxies: ["DIRECT", PROXY_GROUPS.SELECT],
    },
    {
      name: "广告拦截",
      icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/AdBlack.png",
      type: "select",
      proxies: ["REJECT", "REJECT-DROP", PROXY_GROUPS.DIRECT],
    },
    {
      name: "应用净化",
      icon: "https://testingcf.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Hijacking.png",
      type: "select",
      proxies: ["REJECT", "REJECT-DROP", PROXY_GROUPS.DIRECT],
    },
    lowCost
      ? {
          name: PROXY_GROUPS.LOW_COST,
          icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Lab.png",
          type: "url-test",
          url: "https://cp.cloudflare.com/generate_204",
          "include-all": true,
          filter: "(?i)0.[0-5]|低倍率|省流|大流量|实验性",
        }
      : null,
  ].filter(Boolean); // 过滤掉 null 值
}

const myProxyProviders = {
  赔钱机场: {
    type: "http",
    path: "./proxy_provider/赔钱机场.yaml",
    url: "https://xn--cp3a08l.com/api/v1/client/subscribe?token=3fc972e32b774cb670fb326c35719073",
    filter: "MatchesNothing^",
    interval: 43200,
    health_check: {
      enable: true,
      url: "https://cp.cloudflare.com/generate_204",
      interval: 43200,
    },
  },
  iKuuu: {
    type: "http",
    path: "./proxy_provider/iKuuu.yaml",
    url: "https://1yrif.no-mad-world.club/link/qZx9WWdqTKBw8rH9?clash=3&extend=1",
    filter: "MatchesNothing^",
    interval: 43200,
    health_check: {
      enable: true,
      url: "https://cp.cloudflare.com/generate_204",
      interval: 43200,
    },
  },
};

function main(config) {
  const resultConfig = { proxies: config.proxies };
  // 解析地区与低倍率信息
  const countryInfo = parseCountries(resultConfig); // [{ country, count }]
  const lowCost = hasLowCost(resultConfig);
  const countryGroupNames = getCountryGroupNames(countryInfo, countryThreshold);
  const countries = stripNodeSuffix(countryGroupNames);

  // 构建基础数组
  const {
    defaultProxies,
    defaultProxiesDirect,
    defaultSelector,
    defaultFallback,
  } = buildBaseLists({ landing, lowCost, countryGroupNames });

  // 为地区构建对应的 url-test / load-balance 组
  const countryProxyGroups = buildCountryProxyGroups({
    countries,
    landing,
    loadBalance,
  });

  // 生成代理组
  const proxyGroups = buildProxyGroups({
    landing,
    countries,
    countryProxyGroups,
    lowCost,
    defaultProxies,
    defaultProxiesDirect,
    defaultSelector,
    defaultFallback,
  });

  // 完整书写 Global 代理组以确保兼容性
  const globalProxies = proxyGroups.map((item) => item.name);
  proxyGroups.push({
    name: "GLOBAL",
    icon: "https://gcore.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Global.png",
    "include-all": true,
    type: "select",
    proxies: globalProxies,
  });

  const finalRules = buildRules({ quicEnabled });

  if (fullConfig)
    Object.assign(resultConfig, {
      "mixed-port": 7890,
      "redir-port": 7892,
      "tproxy-port": 7893,
      "routing-mark": 7894,
      "allow-lan": true,
      ipv6: ipv6Enabled,
      mode: "rule",
      "unified-delay": true,
      "tcp-concurrent": true,
      "find-process-mode": "off",
      "log-level": "info",
      "geodata-loader": "standard",
      "external-controller": ":9999",
      "disable-keep-alive": !keepAliveEnabled,
      profile: {
        "store-selected": true,
      },
    });

  if (!fullConfig)
    Object.assign(resultConfig, {
      "mixed-port": 7890,
      "redir-port": 7892,
      "tproxy-port": 7893,
      "routing-mark": 7894,
    });

  Object.assign(resultConfig, {
    "proxy-groups": proxyGroups,
    "rule-providers": ruleProviders,
    rules: finalRules,
    sniffer: snifferConfig,
    dns: fakeIPEnabled ? dnsConfigFakeIp : dnsConfig,
    "geodata-mode": true,
    "geox-url": geoxURL,
    "proxy-providers": myProxyProviders, // 注入 proxy-provider
  });
  return resultConfig;
}
