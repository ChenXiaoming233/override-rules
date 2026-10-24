/**
 * 低倍率节点的匹配规则。
 */

import { createCaseInsensitiveNodeMatcher } from "../utils/regex";

/** 匹配低倍率节点名称的正则（0.0~0.5 倍率、低倍率、省流、实验性）。 */
export const LOW_COST_NODE_MATCHER = createCaseInsensitiveNodeMatcher(
    String.raw`0\.[0-5]|低倍率|省流|实验性`
);

/** 匹配高倍率节点名称的正则（2.0 倍率以上、高倍率、专线等）。 */
export const HIGH_COST_NODE_MATCHER = createCaseInsensitiveNodeMatcher(
    String.raw`[2-9]\.[0-9]|高倍率|Premium|旗舰|专线|VIP`
);
