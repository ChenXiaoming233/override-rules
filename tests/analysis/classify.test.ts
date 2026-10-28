import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeNodes } from "../../src/analysis/classify";
import type { ProxyNode } from "../../src/types/proxy";

const PROXIES: ProxyNode[] = [
    { name: "香港01" },
    { name: "香港02" },
    { name: "台湾01" },
    { name: "香港 0.2x 大流量" },
    { name: "落地A", "dialer-proxy": "前置代理" },
    { name: "Tailscale出口", type: "tailscale" },
];

describe("analyzeNodes", () => {
    const result = analyzeNodes(PROXIES, 1);

    it("按 dialer-proxy 区分落地/非落地", () => {
        assert.equal(result.landing, true);
        assert.deepEqual(
            result.landingNodes.map((n) => n.name),
            ["落地A"]
        );
        assert.equal(result.nonLandingNodes.length, 5);
    });

    it("链式代理激活时地区分类只扫描非落地节点", () => {
        assert.deepEqual(Object.keys(result.countryNodes).sort(), ["台湾", "香港"]);
        assert.equal(result.countryNodes["香港"].length, 3);
    });

    it("按权重排序并保留全部已识别地区", () => {
        assert.deepEqual(result.countryNames, ["香港", "台湾"]);
    });

    it("把小地区合并到其他节点并保留常规地区组", () => {
        assert.deepEqual(result.smallCountries, ["台湾"]);
        assert.deepEqual(
            result.smallCountryNodes.map((n) => n.name),
            ["台湾01"]
        );
        assert.equal(result.regionLayout.mode, "grouped");
        assert.deepEqual(result.regionLayout.groupedCountries, ["香港"]);
        assert.deepEqual(result.regionLayout.flattenedNodes, []);
    });

    it("lite-combine=0 时保留全部地区并采用上游分组布局", () => {
        const grouped = analyzeNodes(PROXIES, 0);
        assert.deepEqual(grouped.smallCountries, []);
        assert.equal(grouped.regionLayout.mode, "grouped");
        assert.deepEqual(grouped.regionLayout.groupedCountries, ["香港", "台湾"]);
        assert.deepEqual(grouped.regionLayout.flattenedNodes, []);
    });

    it("所有地区都是小地区时只保留其他节点", () => {
        const allSmall = analyzeNodes(
            [{ name: "香港01" }, { name: "美国01" }, { name: "日本01" }],
            1
        );
        assert.deepEqual(allSmall.smallCountries, ["香港", "日本", "美国"]);
        assert.deepEqual(allSmall.regularCountryNames, []);
        assert.equal(allSmall.regionLayout.mode, "grouped");
        assert.deepEqual(allSmall.regionLayout.groupedCountries, []);
        assert.deepEqual(
            allSmall.smallCountryNodes.map((n) => n.name),
            ["香港01", "日本01", "美国01"]
        );
    });

    it("只有一个常规地区且没有小地区时展平", () => {
        const flattened = analyzeNodes([{ name: "香港01" }, { name: "香港02" }], 1);
        assert.deepEqual(flattened.countryNames, ["香港"]);
        assert.deepEqual(flattened.smallCountries, []);
        assert.equal(flattened.regionLayout.mode, "flattened");
        assert.deepEqual(
            flattened.regionLayout.flattenedNodes.map((n) => n.name),
            ["香港01", "香港02"]
        );
    });

    it("没有任何识别地区时仍为展平模式", () => {
        const flattened = analyzeNodes([{ name: "NodeA" }, { name: "NodeB" }], 1);
        assert.equal(flattened.regionLayout.mode, "flattened");
        assert.deepEqual(flattened.regionLayout.groupedCountries, []);
        assert.deepEqual(
            flattened.regionLayout.flattenedNodes.map((n) => n.name),
            ["NodeA", "NodeB"]
        );
    });

    it("识别低倍率节点", () => {
        assert.deepEqual(
            result.lowCostNodes.map((n) => n.name),
            ["香港 0.2x 大流量"]
        );
    });

    it("识别 Tailscale 节点", () => {
        assert.equal(result.hasTailscale, true);
        assert.deepEqual(
            result.tailscaleNodes.map((n) => n.name),
            ["Tailscale出口"]
        );
    });

    it("无落地节点时不启用 landing", () => {
        const plain = analyzeNodes([{ name: "香港01" }, { name: "美国01" }], 1);
        assert.equal(plain.landing, false);
        assert.equal(plain.nonLandingNodes.length, 2);
    });

    it("只有落地节点时仍启用 landing，并进入展平模式", () => {
        const allLanding = analyzeNodes(
            [
                { name: "落地A", "dialer-proxy": "前置代理" },
                { name: "落地B", "dialer-proxy": "前置代理" },
            ],
            1
        );

        assert.equal(allLanding.landing, true);
        assert.equal(allLanding.nonLandingNodes.length, 0);
        assert.deepEqual(allLanding.countryNames, []);
        assert.equal(allLanding.regionLayout.mode, "flattened");
        assert.deepEqual(allLanding.regionLayout.flattenedNodes, []);
    });
});
