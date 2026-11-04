// PAPER-CANONICAL-1: the stored shape of a paper. A new release, a revision and a repaired old row all end up as
// `# Title`, an optional italic subtitle, `## Abstract`, then the paper, with no YAML front matter, no byline or metadata
// block, no repeated or wrapped title and no in-body version history, changelog or revision banner. Who changed what and
// when lives in the ledger (paper_change_ledger / paper_change_bodies), paper_revision_log and the Versions tab, and the
// bibliographic fields live in the papers columns. Needs formatPaper (paper-format.js) in scope.
// canonicalPaper(source, record, opts) -> { body, title, subtitle, abstract, removed: [what was dropped], fields }
// opts.keepHistory keeps in-body history sections (owner-written papers whose history is the author's own text).
export function canonicalPaper(source, record, opts) {
  const o = opts || {};
  const removed = [];
  let dropped = 0;
  const HISTORY = /^(?:version|revision|document|change|release)\s+(?:history|log|notes)(?:\s*[:(\u2014-].*)?$|^change\s?log$|^correction\s+notices?$|^revision\s+notices?$|^what\s+changed(?:\s+in\s+.*)?$|^changes?\s+in\s+(?:this\s+)?(?:version|revision)\b.*$|^errata\s+and\s+revisions?$/i;
  const META = /^\s*(?:[*_]{1,2})?(?:authors?|affiliations?|institution|subtitle|supersedes|edition|corresponding author|e-?mail|contact|orcid|isni|website|url|date|published|publication date|version|doi|license|keywords|status|modified|last updated|robots|dc\.rights)(?:[*_]{1,2})?[ \t]*:/i;
  const words = (s) => String(s || "").toLowerCase().replace(/[*_`#]/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const overlap = (a, b) => {
    const x = new Set(words(a)), y = new Set(words(b));
    if (!x.size || !y.size) return 0;
    let n = 0;
    x.forEach((w) => { if (y.has(w)) n++; });
    return n / Math.min(x.size, y.size);
  };
  const metaLine = (l) => META.test(l) || /mailto:/i.test(l) || /^\s*https?:\/\/\S+\s*$/.test(l) || /^\s*[*_][^*_\n]*\b(?:QNFO|Quni|ORCID)\b[^*_\n]*[*_]\s*$/.test(l);

  // The header zone: blocks after the title that are a byline, metadata, a bare URL or the title said again. A subtitle
  // heading that sits above such a block becomes the italic subtitle line.
  const labelAnywhere = /\*\*(?:orcid|isni|doi|url|contact|e-?mail|version|date|affiliation|author)s?:?\*\*:?|orcid\.org|isni\.org/i;
  const isMeta = (b) => {
    const ls = b.split("\n");
    if (b.length > 900 || /^#/.test(ls[0])) return false;
    if (!metaLine(ls[0])) return false;
    return ls.filter((l) => metaLine(l) || labelAnywhere.test(l)).length * 2 >= ls.length;
  };
  const cleanHeader = (text, title) => {
    const blocks = text.replace(/\s+$/, "").split(/\n[ \t]*\n/);
    const isTitle = (b) => {
      const h = /^(#{2,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(b);
      return !!h && b.indexOf("\n") < 0 && !/^abstract\b/i.test(h[2].replace(/[*_]/g, "").trim()) && !!title && overlap(title, h[2]) >= 0.75 && words(h[2]).length >= 3;
    };
    let last = -1;
    for (let i = 1; i < Math.min(blocks.length, 10); i++) {
      if (/^#{1,6}[ \t]+(?:\d+(?:\.\d+)*[.)]?\s|abstract\b|introduction\b|chapter\b)/i.test(blocks[i].replace(/[*_]/g, ""))) break;
      if (isMeta(blocks[i]) || isTitle(blocks[i])) last = i;
    }
    const keep = [blocks[0]];
    let sub = blocks.length > 1 && /^\*[^*\n][\s\S]*\*$/.test(blocks[1]);
    for (let i = 1; i < blocks.length; i++) {
      const b = blocks[i];
      if (i <= last) {
        if (isMeta(b)) { removed.push("metadata"); continue; }
        if (isTitle(b)) { removed.push("repeated title"); dropped++; continue; }
        const h = /^(#{2,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(b);
        if (h && !sub && b.indexOf("\n") < 0 && words(h[2]).length <= 25) { keep.push("*" + h[2].replace(/[*_]/g, "").trim() + "*"); sub = true; removed.push("subtitle heading"); dropped++; continue; }
      }
      keep.push(b);
    }
    return keep.join("\n\n") + "\n";
  };
  const cleanHistory = (text) => {
    const lines = text.split("\n");
    const out = [];
    let fence = "";
    let skipLevel = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fm = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fm) {
        if (!fence) fence = fm[1];
        else if (fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = "";
        if (!skipLevel) out.push(line);
        continue;
      }
      if (fence) { if (!skipLevel) out.push(line); continue; }
      const h = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
      if (h) {
        const level = h[1].length;
        // A history section ends at the next heading of its own level or higher, and at a nested reference list, appendix or provenance heading.
        if (skipLevel && (level <= skipLevel || /^(?:\d+(?:\.\d+)*\.?\s+)?(?:references|bibliography|works cited|appendix|appendices|acknowledg|provenance|data availability|supplementary)/i.test(h[2].replace(/[*_`]/g, "").trim()))) skipLevel = 0;
        if (!skipLevel && level >= 2 && HISTORY.test(h[2].replace(/[*_`]/g, "").replace(/^\d+(?:\.\d+)*\.?\s+/, "").trim())) {
          skipLevel = level;
          removed.push(h[2].trim());
          dropped++;
          continue;
        }
        if (skipLevel) dropped++;
      }
      if (skipLevel) continue;
      // A revision banner is a blockquote opening with "Revised (version" or "Correction (version", with its continuation lines.
      if (/^>\s*\*\*(?:Revised|Correction|Revision)\s*\(version\b/i.test(line)) {
        while (i + 1 < lines.length && /^>/.test(lines[i + 1])) i++;
        removed.push("banner");
        continue;
      }
      out.push(line);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
  };

  let f = formatPaper(source, record);
  let body = f.displayBody;
  for (let pass = 0; pass < 3; pass++) {
    const title = String((record && record.title) || f.title || "");
    let next = cleanHeader(body, title);
    if (!o.keepHistory) next = cleanHistory(next);
    f = formatPaper(next, record);
    if (f.displayBody === body) break;
    body = f.displayBody;
  }
  // A body whose opening paragraph is the abstract without its heading gets the heading, so every paper opens the same way.
  const recAbs = String((record && record.abstract) || "").trim();
  if (recAbs && !/^## Abstract[ \t]*$/m.test(body)) {
    const squash = (s) => String(s).toLowerCase().replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
    const blocks = body.replace(/\s+$/, "").split(/\n[ \t]*\n/);
    let at = 1;
    if (blocks[at] && /^\*[^*\n][\s\S]*\*$/.test(blocks[at])) at++;
    const first = blocks[at] || "";
    if (first && !/^(?:#|\||```|~~~|\$\$|[-*+]\s|\d+[.)]\s)/.test(first) && squash(first).startsWith(squash(recAbs).slice(0, 80))) {
      const inner = /^\*\*([^*]+)\*\*$/.exec(first.trim());
      blocks.splice(at, 1, "## Abstract", inner ? inner[1] : first);
      body = blocks.join("\n\n") + "\n";
      removed.push("abstract heading added");
    }
  }
  return { body, title: f.title, subtitle: f.subtitle, abstract: f.abstract, fields: f.fields, removed, droppedHeadings: dropped };
}

// Why a canonical body must not replace the stored one, or "" when it may. A body that lost more than 35% of its words, a
// reference list, or headings beyond the ones canonicalPaper dropped on purpose is left alone and counted as refused.
export function canonicalRefusal(before, c) {
  const src = String(before || "").replace(/\r\n?/g, "\n");
  const fm = /^\s*---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(src);
  const core = fm ? src.slice(fm[0].length) : src;
  const count = (s) => (String(s).match(/\S+/g) || []).length;
  const heads = (s) => {
    let n = 0, fence = "";
    String(s).split("\n").forEach((l) => {
      const m = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
      if (m) { if (!fence) fence = m[1]; else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = ""; return; }
      if (!fence && /^#{2,6}[ \t]+\S/.test(l)) n++;
    });
    return n;
  };
  const wb = count(core), wa = count(c.body);
  if (wb > 0 && wa < wb * 0.65) return "words " + wb + " -> " + wa + ", more than 35% lost";
  const hb = heads(core), ha = heads(c.body);
  if (ha + (c.droppedHeadings || 0) + 2 < hb) return "headings " + hb + " -> " + ha + " with " + (c.droppedHeadings || 0) + " dropped on purpose";
  const refs = /^#{1,6}[ \t]*(?:\d+\.?[ \t]*)?(?:references|bibliography|works cited)\b/im;
  if (refs.test(core) && !refs.test(c.body)) return "reference list lost";
  if (!/^# \S/.test(c.body)) return "no title line";
  return "";
}

// The body to store: the canonical text only. Owner-written papers (identifier qnfo-2025-*) keep a history section of their own.
export function canonicalBody(md, record) {
  const r = record || {};
  return canonicalPaper(md, r, { keepHistory: String(r.identifier || "").indexOf("qnfo-2025-") === 0 }).body;
}
