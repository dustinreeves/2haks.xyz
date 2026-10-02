(function () {
  'use strict';
  var COLS = ['Timestamp', 'Type', 'Computername', 'Access Point IP', 'Access Point Name',
              'MAC-Address Requester', 'SAM-Account-Name', 'Response Type', 'Reason'];
  var PAGE = 1000;
  var rows = [], view = [], shown = 0, sortCol = -1, sortDir = 1;
  var $ = function (id) { return document.getElementById(id); };

  function txt(ev, name) {
    var el = ev.getElementsByTagName(name)[0];
    return el ? el.textContent : null;
  }

  // Same pairing logic as the C# app: first event for a Class is the request,
  // the next one with the same Class is the response and completes a row.
  function parse(text) {
    text = text.replace(/^﻿/, '').replace(/<\?xml[^>]*\?>/g, '');
    var doc = new DOMParser().parseFromString('<events>' + text + '</events>', 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('This does not look like a valid NPS DTS XML log.');
    var events = doc.getElementsByTagName('Event'), pending = new Map(), out = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i], cls = txt(ev, 'Class');
      if (cls === null) continue;
      var ptype = txt(ev, 'Packet-Type');
      if (!pending.has(cls)) {
        if (ptype === '1' || ptype === '4') {
          pending.set(cls, {
            ts: txt(ev, 'Timestamp') || '', type: ptype, server: txt(ev, 'Computer-Name') || '',
            ip: txt(ev, 'Client-IP-Address') || '', ap: txt(ev, 'NAS-Identifier') || '',
            mac: txt(ev, 'Calling-Station-Id') || '',
            user: txt(ev, 'SAM-Account-Name') || txt(ev, 'User-Name') || '- UNKNOWN -'
          });
        }
        continue;
      }
      var r = pending.get(cls), reason = txt(ev, 'Reason-Code');
      out.push({
        cells: [r.ts, PACKET_TYPES[r.type] || r.type, r.server, r.ip, r.ap, r.mac, r.user,
                PACKET_TYPES[ptype] || ptype || '', REASON_CODES[reason] || (reason === null ? '' : 'Unknown reason code ' + reason)],
        cls: ptype === '2' ? 'ok' : ptype === '3' ? 'bad' : ''
      });
    }
    return { rows: out, events: events.length, unmatched: pending.size - out.length };
  }

  function render() {
    var body = $('body'), frag = document.createDocumentFragment(), end = Math.min(view.length, shown + PAGE);
    if (shown === 0) body.textContent = '';
    for (var i = shown; i < end; i++) {
      var tr = document.createElement('tr'), r = view[i];
      tr.className = r.cls;
      r.cells.forEach(function (c, j) {
        var td = document.createElement('td');
        td.textContent = c;
        if (j === 8) td.className = 'reason';
        tr.appendChild(td);
      });
      frag.appendChild(tr);
    }
    body.appendChild(frag);
    shown = end;
    $('count').textContent = view.length.toLocaleString() + ' of ' + rows.length.toLocaleString() + ' entries';
    var more = $('more');
    more.hidden = shown >= view.length;
    more.textContent = 'Showing ' + shown.toLocaleString() + ' of ' + view.length.toLocaleString() + ' (scroll to the bottom to load more)';
  }

  function apply() {
    var q = $('q').value.toLowerCase(), oc = $('outcome').value;
    view = rows.filter(function (r) {
      return (!oc || r.cells[7] === oc) && (!q || r.cells.join('\t').toLowerCase().indexOf(q) !== -1);
    });
    if (sortCol >= 0) view.sort(function (a, b) {
      return a.cells[sortCol].localeCompare(b.cells[sortCol], undefined, { numeric: true }) * sortDir;
    });
    shown = 0; $('wrap').scrollTop = 0; render();
  }

  function load(file) {
    var st = $('status'); st.className = ''; st.textContent = 'Reading ' + file.name + '…';
    file.text().then(function (t) {
      st.textContent = 'Parsing…';
      setTimeout(function () {
        try {
          var res = parse(t);
          rows = res.rows; sortCol = -1;
          st.textContent = file.name + ': ' + res.events.toLocaleString() + ' events, ' + rows.length.toLocaleString() +
            ' completed requests' + (res.unmatched > 0 ? ', ' + res.unmatched + ' without a response' : '') + '.';
          $('tools').hidden = $('wrap').hidden = false;
          document.querySelectorAll('th').forEach(function (th) { th.className = ''; });
          apply();
        } catch (e) { st.className = 'err'; st.textContent = e.message; }
      }, 20);
    }, function () { st.className = 'err'; st.textContent = 'Could not read that file.'; });
  }

  function csvCell(s) {
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // avoid spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    var lines = [COLS.map(csvCell).join(',')];
    view.forEach(function (r) { lines.push(r.cells.map(csvCell).join(',')); });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
    a.download = 'radius-log.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  var head = $('head');
  COLS.forEach(function (c, i) {
    var th = document.createElement('th'); th.textContent = c;
    th.addEventListener('click', function () {
      sortDir = sortCol === i ? -sortDir : 1; sortCol = i;
      head.querySelectorAll('th').forEach(function (h) { h.className = ''; });
      th.className = sortDir === 1 ? 'asc' : 'desc';
      apply();
    });
    head.appendChild(th);
  });

  $('file').addEventListener('change', function (e) { if (e.target.files[0]) load(e.target.files[0]); });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  var t; $('q').addEventListener('input', function () { clearTimeout(t); t = setTimeout(apply, 150); });
  $('outcome').addEventListener('change', apply);
  $('csv').addEventListener('click', exportCsv);
  $('wrap').addEventListener('scroll', function (e) {
    var w = e.target; if (shown < view.length && w.scrollTop + w.clientHeight >= w.scrollHeight - 80) render();
  });
  $('body').addEventListener('click', function (e) {
    var tr = e.target.closest('tr'); if (tr) tr.classList.toggle('open');
  });
})();
