"""Render engine for the SD-WAN/ADVPN Jinja Orchestrator, run in the browser via Pyodide.

Mirrors Fortinet's render_config.py (same template selection, ordering and output framing),
so the output is byte-identical to the offline renderer."""
import json
import traceback

import jinja2
from ipaddr import ipaddr

_templates = {}
_mapping = {}
_render_env = None


def load_release(templates_json):
    global _templates, _mapping, _render_env
    _templates = json.loads(templates_json)
    _mapping = dict(_templates)
    _mapping['Project'] = ''
    # One long-lived environment: Jinja keeps the compiled templates, and DictLoader's
    # up-to-date check recompiles only 'Project' when its source changes.
    _render_env = jinja2.Environment(loader=jinja2.DictLoader(_mapping), undefined=jinja2.StrictUndefined)
    _render_env.filters['ipaddr'] = ipaddr


def _env(project, undefined):
    tpls = dict(_templates)
    tpls['Project'] = project
    env = jinja2.Environment(loader=jinja2.DictLoader(tpls), undefined=undefined)
    env.filters['ipaddr'] = ipaddr
    return env


def _where(exc, names):
    """Find the template + line an exception came from."""
    if isinstance(exc, jinja2.TemplateSyntaxError):
        return exc.name, exc.lineno
    found = (None, None)
    for fs in traceback.extract_tb(exc.__traceback__):
        if fs.filename in names:
            found = (fs.filename, fs.lineno)
    return found


def _error(exc):
    name, line = _where(exc, set(_templates) | {'Project'})
    return {'template': name, 'line': line, 'message': '%s: %s' % (type(exc).__name__, exc)}


def render(project, inventory_json, skip_optional=False):
    """-> JSON {devices: {name: {group, text|error}}, error?}"""
    try:
        _mapping['Project'] = project
        env = _render_env
        devices = json.loads(inventory_json)
        defaults = devices.pop('defaults', {})
    except Exception as e:  # noqa
        return json.dumps({'devices': {}, 'error': _error(e)})
    names = [n for n in _templates if not n.startswith('Project')]
    out = {}
    for group, devlist in devices.items():
        tpls = sorted(n for n in names if group in n and not (skip_optional and n.startswith('optional/')))
        for dev, meta in devlist.items():
            try:
                lines = ['execute batch start']
                for j in tpls:
                    r = env.get_template(j).render(defaults | meta)
                    lines += ['######################################', '# ' + j,
                              '######################################',
                              '\n'.join(l for l in r.split('\n') if l.strip()), '']
                lines.append('execute batch end')
                out[dev] = {'group': group, 'text': '\n'.join(lines) + '\n'}
            except Exception as e:  # noqa
                out[dev] = {'group': group, 'error': _error(e)}
    return json.dumps({'devices': out})


class _Ref(jinja2.Undefined):
    """Records references to per-device variables while the Project Template is evaluated."""
    __slots__ = ()


def _plain(v):
    if isinstance(v, jinja2.Undefined):
        return {'$var': v._undefined_name}
    if isinstance(v, dict):
        return {str(k): _plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    if isinstance(v, (bool, int, float)) or v is None:
        return v
    return str(v)


def parse_project(project):
    """Evaluate a Project Template; returns every top-level variable it sets.
    Variables the template reads but does not define (supplied per device in the inventory)
    come back as {"$var": name}."""
    try:
        mod = _env(project, _Ref).get_template('Project').make_module({})
        res = {k: _plain(v) for k, v in vars(mod).items() if not k.startswith('_')}
        return json.dumps({'vars': res})
    except Exception as e:  # noqa
        return json.dumps({'error': _error(e)})
