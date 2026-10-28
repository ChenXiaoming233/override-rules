/**
 * TUN 模式配置构建。
 */

import { isNotNull } from "../utils/primitives";
import type { TunConfig } from "../types/clash";

const LOCAL_NETWORK_EXCLUDE_ADDRESSES = [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    "224.0.0.0/4",
    "255.255.255.255/32",
    "fe80::/10",
    "ff00::/8",
] as const;

/**
 * 构建 Clash 内核的 TUN 模式配置。
 *
 * 使用 gvisor 网络栈，并排除 Tailscale 与本地网络地址段，避免局域网发现
 * 和多播/广播流量被 TUN 接管。
 * @param tunEnabled - 是否启用 TUN 模式
 * @param hasTailscale - 是否存在 Tailscale 节点
 * @returns TUN 配置对象。`100.64.0.0/10` 与 `fd7a:115c:a1e0::/48` 为 Tailscale
 *   CGNAT/IPv6 地址段（仅在无 Tailscale 节点时排除）；无 Tailscale 节点时还会
 *   排除 IPv6 ULA `fc00::/7`，其余本地网络地址段始终排除。
 */
export function buildTunConfig(tunEnabled: boolean, hasTailscale: boolean): TunConfig {
    return {
        enable: tunEnabled,
        stack: "gvisor",
        device: "mihomo",
        "route-exclude-address": [
            !hasTailscale ? "100.64.0.0/10" : null,
            !hasTailscale ? "fd7a:115c:a1e0::/48" : null,
            !hasTailscale ? "fc00::/7" : null,
            ...LOCAL_NETWORK_EXCLUDE_ADDRESSES,
        ].filter(isNotNull),
        "dns-hijack": ["any:53"],
        mtu: 1500,
    };
}
