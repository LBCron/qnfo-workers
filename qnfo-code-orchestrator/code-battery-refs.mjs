// Reference solutions for the harder CODE-BATTERY-1 tasks (logic 1.1). Used by code-battery.test.mjs only; never shipped in worker.js, so a model reading the repository finds the
// tasks and their hidden tests but not these answers next to them. Each function is written the plain way; the test proves that it passes every hidden test of its task.

export function evalExpr(s) {
  var src = String(s), pos = 0, bad = false;
  function ws() { while (pos < src.length && src[pos] === " ") pos++; }
  function peek() { ws(); return src[pos]; }
  function num() {
    ws();
    var m = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(pos));
    if (!m) { bad = true; return 0; }
    pos += m[0].length;
    return parseFloat(m[0]);
  }
  function atom() {
    var c = peek();
    if (c === "(") { pos++; var v = expr(); if (peek() !== ")") { bad = true; return 0; } pos++; return v; }
    return num();
  }
  function power() { var b = atom(); if (peek() === "^") { pos++; var e = unary(); return Math.pow(b, e); } return b; }
  function unary() { var c = peek(); if (c === "-") { pos++; return -unary(); } if (c === "+") { pos++; return unary(); } return power(); }
  function term() {
    var v = unary();
    for (;;) {
      var c = peek();
      if (c !== "*" && c !== "/" && c !== "%") return v;
      pos++;
      var r = unary();
      if (c === "*") v = v * r;
      else if (r === 0) { bad = true; return 0; }
      else v = c === "/" ? v / r : v % r;
    }
  }
  function expr() {
    var v = term();
    for (;;) {
      var c = peek();
      if (c !== "+" && c !== "-") return v;
      pos++;
      var r = term();
      v = c === "+" ? v + r : v - r;
    }
  }
  var out = expr();
  ws();
  if (bad || pos !== src.length || !isFinite(out)) return null;
  return out;
}

export function nextCron(expr, fromIso) {
  var parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) return null;
  function parse(field, lo, hi, sevenIsZero) {
    var set = {};
    field.split(",").forEach(function (p) {
      var step = 1, range = p, sl = p.indexOf("/");
      if (sl >= 0) { step = parseInt(p.slice(sl + 1), 10); range = p.slice(0, sl); }
      var a = lo, b = hi;
      if (range !== "*") {
        var dash = range.indexOf("-");
        if (dash >= 0) { a = parseInt(range.slice(0, dash), 10); b = parseInt(range.slice(dash + 1), 10); }
        else { a = parseInt(range, 10); b = sl >= 0 ? hi : a; }
      }
      for (var v = a; v <= b; v += step) set[sevenIsZero && v === 7 ? 0 : v] = true;
    });
    return set;
  }
  var mi = parse(parts[0], 0, 59), ho = parse(parts[1], 0, 23), dom = parse(parts[2], 1, 31), mo = parse(parts[3], 1, 12), dow = parse(parts[4], 0, 7, true);
  var domR = parts[2][0] !== "*", dowR = parts[4][0] !== "*";
  var from = new Date(fromIso);
  var t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), from.getUTCHours(), from.getUTCMinutes() + 1, 0, 0);
  var limit = t + 8 * 366 * 86400000;
  var day = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  function dayOk(ms) {
    var d = new Date(ms);
    if (!mo[d.getUTCMonth() + 1]) return false;
    var a = !!dom[d.getUTCDate()], b = !!dow[d.getUTCDay()];
    if (domR && dowR) return a || b;
    if (domR) return a;
    if (dowR) return b;
    return true;
  }
  for (; day <= limit; day += 86400000) {
    if (!dayOk(day)) continue;
    for (var h = 0; h < 24; h++) {
      if (!ho[h]) continue;
      for (var m = 0; m < 60; m++) {
        if (!mi[m]) continue;
        var cand = day + h * 3600000 + m * 60000;
        if (cand >= t) return new Date(cand).toISOString();
      }
    }
  }
  return null;
}

export function applyPatch(text, patch) {
  var orig = String(text).split("\n"), endsNl = orig.length > 0 && orig[orig.length - 1] === "";
  if (endsNl) orig.pop();
  var lines = String(patch).split("\n"), out = [], pos = 0, i = 0;
  while (i < lines.length && lines[i].indexOf("@@") !== 0) i++;
  while (i < lines.length) {
    var h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
    if (!h) { i++; continue; }
    i++;
    var start = parseInt(h[1], 10), oldLen = h[2] === undefined ? 1 : parseInt(h[2], 10);
    var hunk = [];
    while (i < lines.length && lines[i].indexOf("@@") !== 0) { if (lines[i][0] !== "\\" && lines[i] !== "") hunk.push(lines[i]); i++; }
    var oldLines = hunk.filter(function (l) { return l[0] === " " || l[0] === "-"; }).map(function (l) { return l.slice(1); });
    var at = oldLines.length === 0 ? start : start - 1;
    if (at < pos || at + oldLines.length > orig.length) return null;
    for (var k = 0; k < oldLines.length; k++) if (orig[at + k] !== oldLines[k]) return null;
    for (; pos < at; pos++) out.push(orig[pos]);
    hunk.forEach(function (l) { if (l[0] === " ") out.push(l.slice(1)); else if (l[0] === "+") out.push(l.slice(1)); });
    pos = at + oldLines.length;
    void oldLen;
  }
  for (; pos < orig.length; pos++) out.push(orig[pos]);
  var res = out.join("\n");
  return endsNl && out.length ? res + "\n" : res;
}

export function csvParse(text) {
  var s = String(text), rows = [], row = [], f = "", i = 0, q = false, any = false;
  if (s === "") return [];
  while (i < s.length) {
    var c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === "") { q = true; any = true; i++; continue; }
    if (c === ",") { row.push(f); f = ""; any = true; i++; continue; }
    if (c === "\r" && s[i + 1] === "\n") { i++; continue; }
    if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; any = false; i++; continue; }
    f += c; any = true; i++;
  }
  if (q) return null;
  if (any || f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows;
}

export function satisfies(version, range) {
  function ver(v) { var p = String(v).replace(/^[=v]+/, "").split("."); return [parseInt(p[0], 10) || 0, parseInt(p[1], 10) || 0, parseInt(p[2], 10) || 0]; }
  function cmp(a, b) { for (var i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; }
  var v = ver(version);
  function setOk(set) {
    var comps = set.trim().split(/\s+/).filter(Boolean);
    if (!comps.length) return true;
    return comps.every(function (c) {
      if (c === "*" || c === "x" || c === "X") return true;
      var m = /^(\^|~|>=|<=|>|<|=)?\s*v?(.*)$/.exec(c), op = m[1] || "", rest = m[2];
      var parts = rest.split(".");
      var isX = function (p) { return p === undefined || p === "x" || p === "X" || p === "*" || p === ""; };
      var n = 0; while (n < 3 && !isX(parts[n])) n++;
      var full = ver(parts.map(function (p, i) { return i < n ? p : "0"; }).join("."));
      var lo = full, hi;
      if (op === "^") {
        if (full[0] > 0 || n === 1) hi = [full[0] + 1, 0, 0];
        else if (full[1] > 0 || n === 2) hi = [0, full[1] + 1, 0];
        else hi = [0, 0, full[2] + 1];
        return cmp(v, lo) >= 0 && cmp(v, hi) < 0;
      }
      if (op === "~") {
        hi = n <= 1 ? [full[0] + 1, 0, 0] : [full[0], full[1] + 1, 0];
        return cmp(v, lo) >= 0 && cmp(v, hi) < 0;
      }
      var next = n === 0 ? null : n === 1 ? [full[0] + 1, 0, 0] : n === 2 ? [full[0], full[1] + 1, 0] : null;
      if (op === ">=") return cmp(v, lo) >= 0;
      if (op === "<") return cmp(v, lo) < 0;
      if (op === ">") return next ? cmp(v, next) >= 0 : cmp(v, full) > 0;
      if (op === "<=") return next ? cmp(v, next) < 0 : cmp(v, full) <= 0;
      if (n === 3) return cmp(v, full) === 0;
      if (n === 0) return true;
      hi = n === 1 ? [full[0] + 1, 0, 0] : [full[0], full[1] + 1, 0];
      return cmp(v, lo) >= 0 && cmp(v, hi) < 0;
    });
  }
  return String(range).split("||").some(setOk);
}

export function topoSort(nodes, edges) {
  var all = {}, out = {}, indeg = {};
  nodes.forEach(function (n) { all[n] = true; });
  edges.forEach(function (e) { all[e[0]] = true; all[e[1]] = true; });
  Object.keys(all).forEach(function (n) { out[n] = {}; indeg[n] = 0; });
  edges.forEach(function (e) { if (!out[e[0]][e[1]]) { out[e[0]][e[1]] = true; indeg[e[1]]++; } });
  var ready = Object.keys(all).filter(function (n) { return indeg[n] === 0; }), res = [];
  var byCode = function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };
  while (ready.length) {
    ready.sort(byCode);
    var n = ready.shift();
    res.push(n);
    Object.keys(out[n]).forEach(function (m) { if (--indeg[m] === 0) ready.push(m); });
  }
  return res.length === Object.keys(all).length ? res : null;
}
