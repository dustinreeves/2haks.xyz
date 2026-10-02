// Field catalog for Jinja Orchestrator 7.4 ("Dynamic BGP on Loopback"), derived from the upstream
// wiki and cross-checked against the variables the 7.4 templates actually read.
// type: bool | str | int | enum | cidr | ip | list(csv) | text
// `def` is the orchestrator's built-in default: when a field is left unset it is not emitted.

export const ROLES = [
  ['wan', 'WAN (underlay link)'], ['lan', 'LAN'], ['backbone', 'Backbone (hub-to-hub, hubs only)'],
  ['sd_branch', 'FortiLink member'], ['bridge', 'Virtual-switch member'], ['trunk', '802.1Q trunk port'],
  ['lag_member', 'LAG / redundant member'], ['undefined', 'Undefined (parent only, e.g. LAG with VLANs)'],
];

const F = (key, label, type, def, desc, extra = {}) => ({ key, label, type, def, desc, ...extra });

// ---------------------------------------------------------------- project-level options
export const PROJECT_GROUPS = [
  { id: 'core', title: 'Routing design', blurb: 'The fundamentals of the overlay and BGP design.', fields: [
    F('lo_summary', 'Loopback summary', 'cidr', undefined, 'Summary covering every loopback in the project (Hubs and Edges). Required.', { required: true, ph: '10.200.0.0/14' }),
    F('lan_summary', 'LAN summary', 'cidr', undefined, 'Summary covering all LAN subnets. Can also be set per region / per VRF.', { ph: '10.0.0.0/8' }),
    F('dynamic_bgp', 'Dynamic BGP (RR-less)', 'bool', false, 'Spokes peer with Hubs without route reflection. Can be overridden per profile or per hub peering (mixed deployments).'),
    F('advpn2', 'ADVPN 2.0', 'bool', true, 'Generate config ready for ADVPN 2.0 (overridable per profile, e.g. for legacy spokes).'),
    F('multireg', 'Multi-regional', 'bool', true, 'Enable multi-regional configuration (Hub-to-Hub tunnels between regions).'),
    F('multireg_advpn', 'ADVPN between regions', 'bool', true, 'Allow ADVPN shortcuts between regions.'),
    F('intrareg_advpn', 'ADVPN within regions', 'bool', true, 'Allow ADVPN shortcuts between Spokes of the same region.'),
    F('spoke2hub_advpn', 'ADVPN Spoke-to-Hub', 'bool', false, 'ADVPN shortcuts from Spokes to other regions’ Hubs.'),
    F('intrareg_hub2hub', 'Hub-to-Hub within regions', 'bool', false, 'Build Hub-to-Hub tunnels between Hubs of the same region.'),
    F('regex_as', 'ASN regex for inter-region ADVPN', 'str', undefined, 'Regex covering the ASNs of other regions (Dynamic BGP only).'),
    F('short_community_as', 'Short ASN for BGP communities', 'str', undefined, 'Substitute ASN used in communities for regions with 4-byte ASNs.', { ph: '65000' }),
    F('hub_hc_server', 'Hub health-check server', 'ip', undefined, 'Health-check target address advertised by the Hubs.', { ph: '10.200.99.1' }),
    F('overlay_stickiness', 'Overlay stickiness (legacy)', 'bool', false, 'Legacy in 7.4+.'),
  ]},
  { id: 'auth', title: 'IPsec authentication', blurb: 'Certificates (recommended) or a pre-shared key.', fields: [
    F('cert_auth', 'Certificate authentication', 'bool', true, 'Use certificates for IPsec. Turn off to use the PSK below.'),
    F('psk', 'Pre-shared key', 'str', 'S3cr3t!', 'Used when certificate authentication is off. Treat as a secret.', { secret: true, showIf: m => m.options.cert_auth === false }),
    F('hub_cert_template', 'Hub certificate template', 'str', 'Hub', 'FortiManager certificate template name for Hubs.', { showIf: m => m.options.cert_auth !== false }),
    F('edge_cert_template', 'Edge certificate template', 'str', 'Edge', 'Certificate template name for Spokes.', { showIf: m => m.options.cert_auth !== false }),
    F('cert_auth_filter', 'Certificate filtering', 'bool', false, 'Restrict IPsec peers by PKI user (peer) names.', { since: '7.4', showIf: m => m.options.cert_auth !== false }),
    F('edge_cert_filter', 'Edge PKI user (peer)', 'str', 'TheCA', 'PKI user name used on Spokes.', { showIf: m => m.options.cert_auth_filter === true }),
    F('hub_cert_filter', 'Hub PKI user (Spoke-facing)', 'str', 'TheCA', 'PKI user name on Hubs for the Spoke dial-up tunnels.', { showIf: m => m.options.cert_auth_filter === true }),
    F('hub_cert_filter_hub2hub', 'Hub PKI user (Hub-to-Hub)', 'str', 'TheCA', 'PKI user name on Hubs for Hub-to-Hub tunnels.', { showIf: m => m.options.cert_auth_filter === true }),
    F('hub_crl_check', 'CRL validation on Hubs', 'bool', false, 'Check certificate revocation on the Hubs.', { since: '7.4', showIf: m => m.options.cert_auth !== false }),
    F('crl_scep_url', 'CRL SCEP URL', 'str', undefined, '', { showIf: m => m.options.hub_crl_check === true }),
    F('crl_http_url', 'CRL HTTP URL', 'str', undefined, '', { showIf: m => m.options.hub_crl_check === true }),
  ]},
  { id: 'vrf', title: 'Multi-VRF', blurb: 'Segmentation over a single overlay. Add VRFs to a region to enable.', fields: [
    F('pe_vrf', 'PE VRF', 'int', 1, 'VRF holding the underlays and the overlay in a multi-VRF design.'),
    F('vrf_rt_as', 'Base ASN for RD/RT', 'str', '65000', 'Used to build route-distinguisher / route-target values.'),
    F('vrf_leak_summary', 'Inter-VRF link subnet', 'cidr', '10.200.255.0/24', 'Internal range for inter-VRF links.'),
  ]},
  { id: 'lan', title: 'LAN services', blurb: 'DHCP server defaults for LAN interfaces.', fields: [
    F('create_lan_dhcp_server', 'DHCP server on LAN interfaces', 'bool', true, 'Global switch; individual interfaces can opt out.'),
    F('dhcp_server_startip', 'DHCP range start (index)', 'int', 4, 'Index within the LAN subnet (4 = 4th address).'),
    F('dhcp_server_endip', 'DHCP range end (index)', 'int', -5, 'Negative counts from the end of the subnet (-5 = 5th from last).'),
  ]},
  { id: 'zones', title: 'Zones', blurb: 'Automatically created firewall zones.', fields: [
    F('create_lan_zone', 'Create LAN zone', 'bool', true, ''),
    F('lan_zone', 'LAN zone name', 'str', 'lan_zone', ''),
    F('create_hub2hub_zone', 'Create Hub-to-Hub zone', 'bool', true, ''),
    F('hub2hub_zone', 'Hub-to-Hub zone name', 'str', 'hub2hub_overlay', ''),
    F('create_vrf_leak_zone', 'Create VRF-link zones', 'bool', true, ''),
    F('vrf_leak_zone', 'VRF-link zone (CE side)', 'str', 'vrfs_leak_zone', ''),
    F('pevrf_leak_zone', 'VRF-link zone (PE side)', 'str', 'pevrf_leak_zone', ''),
  ]},
  { id: 'safety', title: 'Stateful enforcement & platform', blurb: 'What the config is allowed to purge, plus VDOM naming.', fields: [
    F('strict_peering', 'Allow purging BGP neighbors', 'bool', true, ''),
    F('strict_pbr', 'Allow purging policy routes', 'bool', true, ''),
    F('strict_firewall', 'Allow purging firewall policies', 'bool', true, 'Offline rendering.'),
    F('force_cleanup', 'Force cleanup', 'bool', false, 'Also delete static routes, BGP networks and more that are no longer part of the design.'),
    F('hub_strict_syn', 'Strict SYN check on Hubs', 'bool', false, 'Spoke-to-Spoke traffic through Hubs.'),
    F('vdom', 'SD-WAN VDOM', 'str', 'root', 'Non-root VDOM name.', { since: '7.4' }),
  ]},
];

// ---------------------------------------------------------------- profile-level options
export const PROFILE_OPTIONS = [
  F('advpn2', 'ADVPN 2.0', 'bool', true, 'Override the project setting for devices using this profile.'),
  F('dynamic_bgp', 'Dynamic BGP', 'bool', false, 'Override the project setting (e.g. legacy spokes that must use route reflection).'),
  F('spoke2hub_advpn', 'ADVPN Spoke-to-Hub', 'bool', false, ''),
  F('vdom', 'SD-WAN VDOM', 'str', 'root', ''),
  F('sdwan_mode', 'SD-WAN rule mode', 'enum', 'sla', 'Rule mode for corporate traffic (offline rendering).', { options: ['sla', 'priority'] }),
  F('leak_npu_link', 'NPU inter-VRF link', 'str', undefined, 'Name of the hardware inter-VRF interface (default: software vdom-link).', { ph: 'npu_link' }),
  F('strict_peering', 'Allow purging BGP neighbors', 'bool', true, ''),
  F('strict_pbr', 'Allow purging policy routes', 'bool', true, ''),
  F('strict_firewall', 'Allow purging firewall policies', 'bool', true, ''),
  F('force_cleanup', 'Force cleanup', 'bool', false, ''),
];

// ---------------------------------------------------------------- region / hub / overlay
export const REGION_FIELDS = [
  F('as', 'AS number', 'str', undefined, 'BGP AS of the region.', { required: true, ph: '65001' }),
  F('lo_summary', 'Loopback summary', 'cidr', undefined, 'Required in multi-regional designs.', { ph: '10.200.1.0/24' }),
  F('lan_summary', 'LAN summary', 'cidr', undefined, 'Required in multi-regional designs (per VRF when multi-VRF).', { ph: '10.0.0.0/14' }),
];
export const HUB_FIELDS = [
  F('lo_bgp', 'BGP loopback', 'ip', undefined, 'Loopback IP used for BGP termination on this Hub.', { required: true, ph: '10.200.1.253' }),
  F('hub_name', 'Tunnel label', 'str', undefined, 'Hub label in tunnel names (default: H<index>).', { since: '7.4', ph: 'H1' }),
];
export const OVERLAY_FIELDS = [
  F('wan_ip', 'Endpoint IP', 'ip', undefined, 'IPsec endpoint IP of the Hub on this overlay. Usually a per-device variable.', { required: true, varDefault: true }),
  F('network_id', 'Network ID', 'int', undefined, 'IKEv2 network ID, unique per Hub overlay.', { required: true }),
  F('hub2hub', 'Hub-to-Hub tunnels', 'bool', true, 'Allow Hub-to-Hub tunnels over this overlay.', { since: '7.4' }),
];
export const PEERING_FIELDS = [
  F('dynamic_bgp', 'Dynamic BGP', 'bool', false, 'Dynamic BGP (RR-less) for this peering.'),
  F('lo_summary', 'Loopback range', 'cidr', undefined, 'Spoke loopback range accepted by this peering.', { required: true, ph: '10.200.1.128/25' }),
];

// ---------------------------------------------------------------- interfaces
const WAN = [
  F('ol_type', 'Overlay (ol_type)', 'str', undefined, 'Which Hub overlay to connect to over this link. Must match an overlay name defined on the Hubs.', { required: true, ph: 'ISP1' }),
  F('ul_name', 'Underlay name', 'str', undefined, 'Local underlay name added to the tunnel name.'),
  F('src_ip', 'Source loopback IP', 'cidr', undefined, 'Source IP for local-out traffic (creates Lo-wan<N>).', { ph: '1.2.3.4/32' }),
  F('dia', 'Direct Internet Access', 'bool', false, 'Offline rendering: make this link an SD-WAN member for DIA.'),
  F('transport_group', 'Transport group', 'int', 0, 'ADVPN 2.0 transport group.'),
  F('outbandwidth', 'Outbound kbps', 'int', undefined, 'With a shaping profile: egress shaping.'),
  F('inbandwidth', 'Inbound kbps', 'int', undefined, 'With a shaping profile: ingress shaping.'),
  F('shaping_profile', 'Shaping profile', 'str', undefined, 'Defined externally (e.g. in FortiManager).'),
  F('backup', 'Backup link', 'bool', false, 'Redundant IPsec tunnels ("monitor") backup.'),
  F('backup_group', 'Backup group', 'int', undefined, 'Backup group ID.'),
  F('fex', 'Managed FortiExtender', 'bool', false, 'Logical FEX interface (needs a parent).'),
  F('pppoe_username', 'PPPoE username', 'str', undefined, 'When IP is "pppoe". Edge only.', { showIf: i => i.ip === 'pppoe' }),
  F('pppoe_password', 'PPPoE password', 'str', undefined, 'When IP is "pppoe".', { secret: true, showIf: i => i.ip === 'pppoe' }),
];
const LAN = [
  F('advertise', 'Advertise into BGP', 'bool', true, 'Advertise this prefix into the SD-WAN overlay.'),
  F('dhcp_server', 'DHCP server', 'bool', true, 'Needs the project-level DHCP server switch on.'),
  F('dhcp_relay', 'DHCP relay', 'bool', false, 'Mutually exclusive with the local DHCP server.'),
  F('dhcp_relay_servers', 'DHCP relay servers', 'str', undefined, 'Space-separated, e.g. "10.1.1.1 10.2.2.2".', { showIf: i => i.dhcp_relay === true }),
  F('dhcp_server_startip', 'DHCP range start', 'int', undefined, 'Overrides the project default for this interface.'),
  F('dhcp_server_endip', 'DHCP range end', 'int', undefined, 'Overrides the project default for this interface.'),
  F('allow_dia', 'Internet access (multi-VRF)', 'bool', false, 'Allow Internet access from this CE VRF (inter-VRF link).'),
];
export const IFACE_COMMON = [
  F('name', 'Interface name', 'str', undefined, 'Physical, VLAN, LAG or bridge name. Interfaces without a name are skipped, so a variable here makes the profile reusable.', { required: true, varDefault: true, ph: 'port1' }),
  F('ip', 'IP address', 'str', undefined, 'CIDR (e.g. 10.0.1.1/24), "dhcp", or "pppoe" on WAN links. Usually a per-device variable for LANs.', { ph: 'dhcp' }),
  F('vrf', 'VRF', 'int', undefined, 'Custom VRF ID (default: 0, or the PE VRF in multi-VRF).'),
  F('vlanid', 'VLAN ID', 'int', undefined, 'Creates a VLAN interface on the parent.'),
  F('parent', 'Parent', 'str', undefined, 'Parent interface (VLAN, LAG, FEX, bridge, or "fortilink").'),
  F('aggregate', 'LAG (802.3ad)', 'bool', false, 'This interface is a LAG; members use role lag_member.'),
  F('redundant', 'Redundant interface', 'bool', false, 'Like LAG but active/standby.'),
  F('access', 'Allowed access', 'list', ['ping'], 'Administrative services allowed in, comma-separated (e.g. ping, fgfm, https).'),
];
export const IFACE_BY_ROLE = {
  wan: [...IFACE_COMMON, ...WAN],
  backbone: [...IFACE_COMMON, ...WAN.slice(0, 2)],
  lan: [...IFACE_COMMON, ...LAN],
  sd_branch: [IFACE_COMMON[0]],
  bridge: [IFACE_COMMON[0], IFACE_COMMON[4]],
  trunk: [IFACE_COMMON[0]],
  lag_member: [IFACE_COMMON[0], IFACE_COMMON[4]],
  undefined: [IFACE_COMMON[0], IFACE_COMMON[3], IFACE_COMMON[4], IFACE_COMMON[5], IFACE_COMMON[6]],
};
export const ifaceFields = role => IFACE_BY_ROLE[role] || IFACE_COMMON;
export const KNOWN_IFACE_KEYS = new Set(['role', ...Object.values(IFACE_BY_ROLE).flat().map(f => f.key)]);
export const BRIDGE_FIELDS = [
  F('name', 'Bridge name', 'str', undefined, 'Hardware switch / virtual-switch name. Its L3 interface must use the same name.', { required: true, varDefault: true, ph: 'BR_LAN' }),
  F('vlanid', 'VLAN ID', 'int', undefined, 'Enables virtual-switch-vlan when set.'),
];

// Per-device fields in the inventory
export const DEVICE_CORE = ['hostname', 'loopback', 'profile', 'region'];

