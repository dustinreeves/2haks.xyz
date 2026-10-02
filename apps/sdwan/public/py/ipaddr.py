"""Minimal stand-in for Ansible's `ipaddr` filter (ansible.utils), covering what the
Jinja Orchestrator templates use: 'address', 'netmask', and host/network indexes."""
import ipaddress


def ipaddr(value, query=''):
    if value in (None, False, ''):
        return False
    s = str(value)
    try:
        iface = ipaddress.ip_interface(s if '/' in s else s + ('/128' if ':' in s else '/32'))
    except ValueError:
        return False
    if query == '' or query is None:
        return str(iface) if '/' in s else str(iface.ip)
    if isinstance(query, int) and not isinstance(query, bool):
        net = iface.network
        try:
            return '%s/%d' % (net[query], net.prefixlen)
        except IndexError:
            return False
    handlers = {
        'address': lambda: str(iface.ip),
        'netmask': lambda: str(iface.netmask),
        'prefix': lambda: iface.network.prefixlen,
        'network': lambda: str(iface.network.network_address),
        'broadcast': lambda: str(iface.network.broadcast_address),
        'subnet': lambda: str(iface.network),
        'host': lambda: str(iface),
    }
    if query in handlers:
        return handlers[query]()
    raise ValueError('unsupported ipaddr query: %r' % (query,))
