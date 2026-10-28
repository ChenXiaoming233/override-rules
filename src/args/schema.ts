/**
 * 参数默认值的唯一来源。
 *
 * 若需修改脚本的默认行为（例如默认开启 IPv6），只需调整此处的取值。
 */
export const ARG_DEFAULTS = {
    /** 地区代理组类型：0=select，1=url-test，2=load-balance。 */
    groupType: 0,
    /** 地区节点数量小于该值时不生成地区组。 */
    countryThreshold: 0,
    /** 默认使用 fake-ip 增强模式。 */
    fakeIPEnabled: true,
    /** 默认把各地区低倍率节点拆分为独立子组。 */
    splitLowCost: true,
    /** 默认不拆分高倍率节点。 */
    splitHighCost: false,
    /** 默认为 select 地区组创建自动测速子组，并将其设为地区主组的默认选中项。 */
    autoSplit: true,
    /** 节点数不超过该值的地区合并为「其他节点」；0 表示禁用。 */
    liteCombine: 1,
} as const;
