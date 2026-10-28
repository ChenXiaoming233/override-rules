import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSortedCountryNames } from "../../src/analysis/active-countries";
import type { ProxyNode } from "../../src/types/proxy";

function nodes(count: number): ProxyNode[] {
    return Array.from({ length: count }, (_, i) => ({ name: `n${i}` }));
}

describe("getSortedCountryNames", () => {
    it("保留所有已识别地区", () => {
        const result = getSortedCountryNames({ 香港: nodes(2), 美国: nodes(1), 日本: nodes(3) });
        assert.deepEqual(result, ["香港", "日本", "美国"]);
    });

    it("按 weight 排序，未配置 weight 的排末尾", () => {
        const result = getSortedCountryNames({
            澳大利亚: nodes(2),
            香港: nodes(2),
            美国: nodes(2),
        });
        assert.deepEqual(result, ["香港", "美国", "澳大利亚"]);
    });
});
