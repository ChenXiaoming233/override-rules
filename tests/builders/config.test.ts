import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFeatureFlags } from "../../src/args/parse";
import { analyzeNodes } from "../../src/analysis/classify";
import { buildBaseLists } from "../../src/builders/selectors";
import { assembleConfig } from "../../src/builders/config";
import { buildProxyGroups } from "../../src/builders/proxy-groups";
import { PROXY_GROUPS } from "../../src/catalog/group-names";
import { ruleSets } from "../../src/catalog/rule-sets";
import type { ClashConfig } from "../../src/types/clash";
import type { ProxyGroup } from "../../src/types/proxy";
import type { ScriptArgs } from "../../src/types/args";

function run(args: ScriptArgs, config: ClashConfig): ClashConfig {
    const flags = buildFeatureFlags(args);
    const proxies = config.proxies ?? [];
    const nodes = analyzeNodes(proxies, flags.countryThreshold, flags.liteCombine);
    const lists = buildBaseLists({
        landing: nodes.landing,
        landingNodes: nodes.landingNodes,
        lowCostNodes: nodes.lowCostNodes,
        highCostNodes: nodes.highCostNodes,
        nonLandingNodes: nodes.nonLandingNodes,
        smallCountryNodes: nodes.smallCountryNodes,
        regexFilter: flags.regexFilter,
        regions: nodes.regionLayout,
    });
    const proxyGroups = buildProxyGroups({ flags, nodes, lists });
    return assembleConfig(config, { flags, nodes, proxyGroups });
}

function group(config: ClashConfig, name: string): ProxyGroup | undefined {
    return config["proxy-groups"]?.find((item) => item.name === name);
}

const CONFIG: ClashConfig = {
    proxies: [{ name: "香港01" }, { name: "香港02" }, { name: "美国01" }, { name: "美国02" }],
    hosts: { "example.com": ["1.2.3.4"] },
};

describe("assembleConfig", () => {
    it("追加 GLOBAL 组并以其前置组为候选", () => {
        const result = run({}, CONFIG);
        const groups = result["proxy-groups"] ?? [];
        const global = groups.at(-1);

        assert.equal(global?.name, PROXY_GROUPS.GLOBAL);
        assert.equal(global?.["include-all"], true);
        assert.deepEqual(
            global?.proxies,
            groups.slice(0, -1).map((item) => String(item.name))
        );
    });

    it("保留上游 proxies 与 hosts", () => {
        const result = run({}, CONFIG);
        assert.deepEqual(result.proxies, CONFIG.proxies);
        assert.deepEqual(result.hosts, CONFIG.hosts);
    });

    it("无上游 hosts 时不输出 hosts 字段", () => {
        const result = run({}, { proxies: [{ name: "香港01" }] });
        assert.ok(!("hosts" in result));
    });

    it("苹果、微软与游戏平台相关组将 DIRECT 放在首位", () => {
        const result = run({}, CONFIG);
        const defaultOptions = group(result, PROXY_GROUPS.GOOGLE)?.proxies ?? [];
        const expected = ["DIRECT", ...defaultOptions.filter((name) => name !== "DIRECT")];

        for (const name of [
            PROXY_GROUPS.APPLE,
            PROXY_GROUPS.MICROSOFT,
            PROXY_GROUPS.ONEDRIVE,
            PROXY_GROUPS.XBOX,
            PROXY_GROUPS.GAMING,
        ]) {
            assert.deepEqual(group(result, name)?.proxies, expected);
        }
    });

    it("地区主组在 auto-split=true 时默认选中自动子组", () => {
        for (const regex of ["false", "true"]) {
            const result = run(
                { threshold: "1", "auto-split": "true", regex },
                {
                    proxies: [
                        { name: "香港01" },
                        { name: "香港02" },
                        { name: "美国01" },
                        { name: "美国02" },
                    ],
                }
            );
            const hongKong = group(result, "香港节点");

            assert.equal(hongKong?.type, "select");
            assert.equal(hongKong?.type === "select" && hongKong["default-selected"], "香港 自动");
            assert.ok(hongKong?.proxies?.includes("香港 自动"));
            if (regex === "true") assert.equal(hongKong?.["include-all"], true);
        }
    });

    it("full=true 时追加完整内核参数", () => {
        const result = run({ full: "true" }, CONFIG);
        assert.equal(result["mixed-port"], 7890);
        assert.equal(result["external-controller"], ":9999");
        assert.equal(result.mode, "rule");
    });

    it("full 默认关闭", () => {
        const result = run({}, CONFIG);
        assert.equal(result["mixed-port"], undefined);
    });

    it("无地区组时三大主组直接使用节点（回归 #64）", () => {
        const result = run({}, { proxies: [{ name: "NodeA" }, { name: "NodeB" }] });

        // defaultSelector 展平后没有 AUTO / FALLBACK 的相互嵌套。
        assert.deepEqual(group(result, PROXY_GROUPS.SELECT)?.proxies, [
            "NodeA",
            "NodeB",
            PROXY_GROUPS.MANUAL,
            "DIRECT",
        ]);
        assert.deepEqual(group(result, PROXY_GROUPS.AUTO)?.proxies, ["NodeA", "NodeB"]);
        assert.deepEqual(group(result, PROXY_GROUPS.FALLBACK)?.proxies, ["NodeA", "NodeB"]);
    });

    it("空 proxies 时所有代理组都不为空", () => {
        const result = run({}, { proxies: [] });
        const groups = result["proxy-groups"] ?? [];

        assert.deepEqual(group(result, PROXY_GROUPS.SELECT)?.proxies, [
            PROXY_GROUPS.MANUAL,
            "DIRECT",
        ]);
        assert.deepEqual(group(result, PROXY_GROUPS.MANUAL)?.proxies, ["DIRECT"]);
        assert.deepEqual(group(result, PROXY_GROUPS.AUTO)?.proxies, ["DIRECT"]);
        assert.deepEqual(group(result, PROXY_GROUPS.FALLBACK)?.proxies, ["DIRECT"]);

        for (const item of groups) {
            if (item.proxies) {
                assert.ok(item.proxies.length > 0, `${item.name} 不应包含空 proxies`);
            }
        }
    });

    it("全落地时保留落地节点组，前置代理仅包含 DIRECT", () => {
        const result = run({}, { proxies: [{ name: "落地A", "dialer-proxy": "前置代理" }] });

        assert.deepEqual(group(result, PROXY_GROUPS.LANDING)?.proxies, ["落地A"]);
        assert.deepEqual(group(result, PROXY_GROUPS.FRONT_PROXY)?.proxies, ["DIRECT"]);
        assert.deepEqual(group(result, PROXY_GROUPS.SELECT)?.proxies, [
            PROXY_GROUPS.LANDING,
            PROXY_GROUPS.MANUAL,
            "DIRECT",
        ]);
        assert.deepEqual(group(result, PROXY_GROUPS.FALLBACK)?.proxies, [PROXY_GROUPS.LANDING]);
    });

    it("展平 + regex 时前置代理仍显式排除落地节点", () => {
        const result = run(
            { regex: "true" },
            {
                proxies: [
                    { name: "香港01" },
                    { name: "香港02" },
                    { name: "落地A", "dialer-proxy": "前置代理" },
                ],
            }
        );

        assert.deepEqual(group(result, PROXY_GROUPS.FRONT_PROXY)?.proxies, [
            "DIRECT",
            "香港01",
            "香港02",
        ]);
        assert.equal(group(result, PROXY_GROUPS.SELECT)?.["exclude-filter"], "^(?:落地A)$");
        assert.equal(group(result, PROXY_GROUPS.SELECT)?.["include-all"], true);
    });

    it("只有台湾时服务组不引用未生成的地区组", () => {
        const result = run(
            { threshold: "2" },
            { proxies: [{ name: "台湾01" }, { name: "台湾02" }] }
        );
        const allGroupNames = (result["proxy-groups"] ?? []).map((item) => item.name);

        assert.ok(!allGroupNames.includes("台湾节点"));
        assert.deepEqual(group(result, PROXY_GROUPS.BAHAMUT)?.proxies, [
            PROXY_GROUPS.SELECT,
            PROXY_GROUPS.MANUAL,
            "DIRECT",
        ]);
        assert.deepEqual(group(result, PROXY_GROUPS.BILIBILI)?.proxies, [
            "DIRECT",
            PROXY_GROUPS.SELECT,
            PROXY_GROUPS.MANUAL,
        ]);
        assert.ok(!group(result, PROXY_GROUPS.BAHAMUT)?.proxies?.includes("台湾节点"));
        assert.ok(!group(result, PROXY_GROUPS.BILIBILI)?.proxies?.includes("台湾节点"));
    });

    it("只有美国时 Truth Social 不引用未生成的地区组", () => {
        const result = run(
            { threshold: "2" },
            { proxies: [{ name: "美国01" }, { name: "美国02" }] }
        );

        assert.ok(!(result["proxy-groups"] ?? []).some((item) => item.name === "美国节点"));
        assert.deepEqual(group(result, PROXY_GROUPS.TRUTH_SOCIAL)?.proxies, [
            PROXY_GROUPS.SELECT,
            PROXY_GROUPS.MANUAL,
            "DIRECT",
        ]);
        assert.ok(!group(result, PROXY_GROUPS.TRUTH_SOCIAL)?.proxies?.includes("美国节点"));
    });

    it("regex=true 时手动选择组使用 include-all，不枚举节点名称", () => {
        const result = run({ regex: "true" }, CONFIG);
        const manual = (result["proxy-groups"] ?? []).find(
            (group) => group.name === PROXY_GROUPS.MANUAL
        );

        assert.equal(manual?.["include-all"], true);
        assert.equal(manual?.proxies, undefined);
    });

    it("regex=false 时手动选择组仍按上游顺序枚举节点名称", () => {
        const result = run({}, CONFIG);
        const manual = (result["proxy-groups"] ?? []).find(
            (group) => group.name === PROXY_GROUPS.MANUAL
        );

        assert.equal(manual?.["include-all"], undefined);
        assert.deepEqual(
            manual?.proxies,
            CONFIG.proxies?.map((node) => node.name)
        );
    });

    it("引用同一份规则集与 Geo 数据源", () => {
        const result = run({}, CONFIG);
        assert.equal(result["rule-providers"], ruleSets);
        assert.equal(result["geodata-mode"], true);
        assert.ok(result["geox-url"]?.geoip);
    });

    it("按地区、服务、倍率和自动子组的顺序组装代理组", () => {
        const result = run(
            { threshold: "1", "highcost-split": "true" },
            {
                proxies: [
                    { name: "香港01" },
                    { name: "香港 0.2x" },
                    { name: "美国01" },
                    { name: "美国 0.2x" },
                    { name: "美国 3.0x" },
                ],
            }
        );
        const groupNames = (result["proxy-groups"] ?? []).map((item) => item.name);
        const selectIndex = groupNames.indexOf(PROXY_GROUPS.SELECT);
        const manualIndex = groupNames.indexOf(PROXY_GROUPS.MANUAL);
        const countryIndex = groupNames.indexOf("香港节点");
        const serviceIndex = groupNames.indexOf(PROXY_GROUPS.AI_SERVICE);
        const lowCostIndex = groupNames.indexOf(PROXY_GROUPS.LOW_COST);
        const highCostIndex = groupNames.indexOf(PROXY_GROUPS.HIGH_COST);
        const countryLowCostIndex = groupNames.indexOf("香港 低倍率");
        const autoIndex = groupNames.indexOf("香港 自动");
        const tailIndex = groupNames.indexOf(PROXY_GROUPS.AD_BLOCK);
        const globalIndex = groupNames.indexOf(PROXY_GROUPS.GLOBAL);

        assert.ok(selectIndex >= 0);
        assert.ok(manualIndex >= 0);
        assert.ok(countryIndex >= 0);
        assert.ok(serviceIndex >= 0);
        assert.ok(lowCostIndex >= 0);
        assert.ok(highCostIndex >= 0);
        assert.ok(countryLowCostIndex >= 0);
        assert.ok(autoIndex >= 0);
        assert.ok(tailIndex >= 0);
        assert.ok(globalIndex >= 0);

        assert.ok(selectIndex < manualIndex);
        assert.ok(manualIndex < countryIndex);
        assert.ok(countryIndex < serviceIndex);
        assert.ok(serviceIndex < lowCostIndex);
        assert.ok(lowCostIndex < highCostIndex);
        assert.ok(highCostIndex < countryLowCostIndex);
        assert.ok(countryLowCostIndex < autoIndex);
        assert.ok(autoIndex < tailIndex);
        assert.ok(tailIndex < globalIndex);
    });

    it("默认拆分地区低倍率与自动子组", () => {
        const result = run(
            { threshold: "1" },
            {
                proxies: [
                    { name: "香港01" },
                    { name: "香港 0.2x" },
                    { name: "美国01" },
                    { name: "美国02" },
                ],
            }
        );

        assert.deepEqual(group(result, "香港 低倍率")?.proxies, ["香港 0.2x"]);
        assert.equal(group(result, "香港 自动")?.type, "url-test");
        assert.deepEqual(group(result, "香港 自动")?.proxies, ["香港01"]);
        assert.deepEqual(group(result, "香港节点")?.proxies, [
            "香港 低倍率",
            "香港 自动",
            "香港01",
        ]);
        const hongKong = group(result, "香港节点");
        assert.equal(hongKong?.type === "select" && hongKong["default-selected"], "香港 自动");
    });

    it("auto-split=false 时地区组不设置默认自动子组", () => {
        const result = run(
            { threshold: "1", "auto-split": "false" },
            {
                proxies: [
                    { name: "香港01" },
                    { name: "香港02" },
                    { name: "美国01" },
                    { name: "美国02" },
                ],
            }
        );
        const hongKong = group(result, "香港节点");

        assert.equal(hongKong?.type, "select");
        assert.ok(!("default-selected" in (hongKong ?? {})));
        assert.equal(group(result, "香港 自动"), undefined);
    });

    it("lite-combine 把单节点地区合并进其他节点", () => {
        const result = run(
            { threshold: "1", "lite-combine": "1" },
            {
                proxies: [
                    { name: "香港01" },
                    { name: "香港02" },
                    { name: "美国01" },
                    { name: "日本01" },
                ],
            }
        );

        assert.deepEqual(group(result, PROXY_GROUPS.OTHER)?.proxies, ["日本01", "美国01"]);
        assert.equal(group(result, "美国节点"), undefined);
        assert.ok(group(result, "香港节点"));
    });

    it("regex 模式只排除实际拆分的倍率子组节点", () => {
        const result = run(
            {
                threshold: "1",
                regex: "true",
                "lowcost-split": "false",
                "highcost-split": "true",
            },
            {
                proxies: [
                    { name: "香港01" },
                    { name: "香港 0.2x" },
                    { name: "香港 3.0x" },
                    { name: "美国01" },
                ],
            }
        );

        assert.equal(group(result, "香港 低倍率"), undefined);
        assert.equal(group(result, "香港节点")?.["exclude-filter"], "^(?:香港 3\\.0x)$");
    });

    it("regex 模式倍率子组使用动态筛选，不枚举节点名", () => {
        const result = run(
            { threshold: "1", regex: "true" },
            {
                proxies: [
                    { name: "香港01" },
                    { name: "香港 0.2x" },
                    { name: "美国01" },
                    { name: "美国02" },
                ],
            }
        );

        const lowCost = group(result, "香港 低倍率");
        assert.equal(lowCost?.["include-all"], true);
        assert.ok(lowCost?.filter?.includes("香港"));
        assert.ok(lowCost?.filter?.includes("省流"));
        assert.equal(lowCost?.proxies, undefined);

        const hongKong = group(result, "香港节点");
        assert.equal(hongKong?.type === "select" && hongKong["default-selected"], "香港 自动");
        assert.equal(hongKong?.["include-all"], true);
        assert.ok(hongKong?.proxies?.includes("香港 自动"));
    });
});
