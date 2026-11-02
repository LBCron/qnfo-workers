// renderer.js — Professional print typesetter for QNFO scientific papers.
//
// TYPESET-PRO-1 (2026-10-18). Before this version a paper PDF carried only a title, a bare author
// string and a stray "References" heading with nothing under it: the citation markers `[@key]`
// were printed as raw keys, the BibTeX that ships beside every paper in R2 (`references.bib`) was
// never read, and the affiliation / ORCID / identifier / licence metadata that the corpus does
// carry was dropped. This renderer fixes the whole block:
//
//   * title block: kind + date + version, title, subtitle, authors with affiliation superscripts,
//     affiliations, ORCID iD and contact, DOI / identifier, licence, then abstract, keywords,
//     subjects and a ready-to-copy "cite as" line;
//   * bibliography: a BibTeX parser, `[@key]` / `[@key; @key2]` -> numbered citations in order of
//     first appearance, and a hanging-indent reference list with the full entry (authors, title,
//     venue, volume, number, pages, year, DOI/URL). An unresolvable key is printed as the key
//     itself — never invented, never silently dropped;
//   * journal-grade print CSS: A4 geometry, booktabs tables, hyphenation, widow/orphan control,
//     keep-with-next headings, centred display math, figure captions.
//
// The renderer never invents metadata: a field that is absent in the frontmatter, the in-body
// byline block or the D1 row is left out rather than guessed.
import katex from "katex";
// PAPER-FORMAT-2:BEGIN
// PAPER-FORMAT-2: presentation-only normalization shared by publication, HTML and PDF.
function formatPaper(source, record) {
  const row = record || {};
  const original = String(source || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let text = original;
  const fields = {};
  let frontmatter = "";
  const fm = /^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (fm) {
    frontmatter = fm[0].trim();
    const lines = fm[1].split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /^([\w.-]+):[ \t]*(.*)$/.exec(lines[i]);
      if (!m) continue;
      let value = m[2];
      if (/^[>|][-+]?$/.test(value)) {
        const parts = [];
        while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) parts.push(lines[++i].trim());
        value = parts.join(" ");
      }
      fields[m[1].toLowerCase()] = value.replace(/^["']|["']$/g, "");
    }
    text = text.slice(fm[0].length);
  }
  const norm = (s) => String(s || "").toLowerCase().replace(/[*_`#]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
  const heading = (s) => /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(s);
  const abstractLabel = (s) => /^(?:#{1,6}[ \t]+)?(?:\d+\.?[ \t]+)?[*_]{0,2}abstract[ \t]*:?[ \t]*[*_]{0,2}[ \t]*:?[ \t]*$/i.test(s.trim());
  const metaLabel = /(?:^|\s)(?:[*_]{1,2})?(authors?|affiliations?|contact|e-?mail|orcid|isni|url|website|publication date|date|version|doi|license|keywords|status|modified|last updated|robots|dc\.rights)(?:[*_]{1,2})?[ \t]*:(?:[*_]{1,2})?[ \t]*/gi;
  const blocks = text.trim().split(/\n[ \t]*\n/);
  const explicitAbstract = !!fields.abstract || blocks.some((b) => abstractLabel(b.split("\n")[0]) || /^(?:#{1,6}[ \t]+)?[*_]{0,2}abstract[*_]{0,2}[ \t]*:/i.test(b));
  const kept = [];
  let inHeader = true, titleSeen = false, subtitle = "", abstract = "";
  let fence = "";
  const title = String(row.title || fields.title || "").replace(/\s+/g, " ").trim();
  let resolvedTitle = title;
  let pendingAbstract = false;
  for (let i = 0; i < blocks.length; i++) {
    let block = blocks[i];
    const lines = block.split("\n");
    // Never interpret headings, labels or blank paragraphs inside a fenced example.
    const protectedBlock = !!fence || lines.some((l) => /^\s{0,3}(`{3,}|~{3,})/.test(l));
    for (const line of lines) {
      const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (m) {
        if (!fence) fence = m[1];
        else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = "";
      }
    }
    if (protectedBlock) { inHeader = false; kept.push(block); continue; }
    if (inHeader && /^[-*_]{3,}$/.test(block.trim())) continue;
    if (abstractLabel(lines[0]) && lines.length > 1) {
      blocks.splice(i + 1, 0, lines.slice(1).join("\n"));
      block = lines[0];
    }
    const h = heading(block.split("\n")[0]);
    if (h && !abstractLabel(h[0]) && block.includes("\n") && lines.slice(1).every((l) => l.trim() && !/^\s*(?:[#>|`~]|\$\$|\\\[|[-*+]\s|\d+[.)]\s)/.test(l) && !/^\s*[*_]*(?:author|contact|orcid|date|version)\b/i.test(l))) {
      block = h[1] + " " + [h[2], ...lines.slice(1)].join(" ").replace(/\s+/g, " ");
    }
    metaLabel.lastIndex = 0;
    const label = abstractLabel(block);
    if (inHeader && label) {
      // Old repairs inserted an Abstract before a title continuation. Only the
      // last label before actual prose survives; no fragment becomes an abstract.
      pendingAbstract = !abstract;
      continue;
    }
    if (inHeader) {
      const matches = Array.from(block.matchAll(metaLabel));
      if (matches.length && matches[0].index === 0) {
        matches.forEach((m, j) => {
          let key = m[1].toLowerCase();
          if (key === "contact" || key === "e-mail") key = "email";
          const value = block.slice(m.index + m[0].length, j + 1 < matches.length ? matches[j + 1].index : block.length).replace(/\s+/g, " ").trim();
          if (value) fields[key] = value;
        });
        continue;
      }
      const bh = heading(block);
      const bare = block.replace(/^#+[ \t]+/, "").replace(/^(\*{1,3})([\s\S]+)\1$/, "$2").trim();
      const n = norm(bare), tn = norm(resolvedTitle);
      if ((!abstract && !titleSeen && bh && bh[1] === "#" && !/^(?:\d+[.)]?\s|chapter\b|introduction\b|references\b)/i.test(bare)) || (!abstract && !resolvedTitle && bh && !/^(?:\d|chapter\b|introduction\b|objective\b)/i.test(bare)) || (!abstract && n && tn && (n === tn || tn.startsWith(n + " ") || tn.endsWith(" " + n)))) {
        if (!resolvedTitle) resolvedTitle = bare;
        titleSeen = true;
        continue;
      }
      // Before a real abstract, a non-section heading is a subtitle, not a TOC item.
      if (!abstract && (bh || /^\*[^*\n][\s\S]*\*$/.test(block)) && blocks.slice(i + 1).some(abstractLabel) && !/^(?:\d+[.)]?\s|chapter\b|introduction\b|objective\b)/i.test(bare)) {
        subtitle = subtitle ? subtitle + " " + bare.replace(/\s+/g, " ") : bare.replace(/\s+/g, " ");
        continue;
      }
      const inlineAbs = /^(?:#{1,6}[ \t]+)?[*_]{0,2}abstract[*_]{0,2}[ \t]*:[*_ \t]*([\s\S]+)$/i.exec(block);
      if (inlineAbs) { pendingAbstract = true; block = inlineAbs[1]; }
      else if (bh) { inHeader = false; pendingAbstract = false; }
      else if (/^https?:\/\/\S+$/.test(block)) { fields.url = block; continue; }
      if (inHeader) {
        if (!pendingAbstract && !abstract && !explicitAbstract && !kept.length && !/^(?:[*_>\[|`~]|[-+]\s|\d+[.)]\s)/.test(block)) pendingAbstract = true;
        if (pendingAbstract) {
          kept.push("## Abstract");
          pendingAbstract = false;
          abstract = block;
        } else if (abstract) {
          abstract += "\n\n" + block;
        }
        kept.push(block);
        continue;
      }
    }
    kept.push(block);
  }
  let content = kept.join("\n\n").trim();
  // Capture an already canonical abstract (the parser remains in the header
  // until the first scientific section), retaining paragraphs and math verbatim.
  if (!abstract) {
    const a = /^## Abstract[ \t]*\n+([\s\S]*?)(?=\n#{1,6}[ \t]+|$)/m.exec(content);
    if (a) abstract = a[1].trim();
  }
  if (!abstract && fields.abstract) {
    abstract = fields.abstract;
    content = "## Abstract\n\n" + abstract + (content ? "\n\n" + content : "");
  }
  const sub = String(row.subtitle || subtitle || fields.subtitle || "").trim();
  const displayBody = (resolvedTitle ? "# " + resolvedTitle + "\n\n" : "") + (sub ? "*" + sub + "*\n\n" : "") + content + "\n";
  // Retain every original YAML field and lift removed byline fields into YAML,
  // rather than discarding bibliographic information during corpus repair.
  const originalKeys = new Set(fm ? fm[1].split("\n").filter((line) => /^[\w.-]+:/.test(line)).map((line) => line.slice(0, line.indexOf(":")).toLowerCase()) : []);
  const added = Object.keys(fields).filter((key) => key !== "title" && key !== "abstract" && !originalKeys.has(key));
  if (added.length) {
    const yaml = added.map((key) => key + ": " + JSON.stringify(fields[key])).join("\n");
    frontmatter = frontmatter ? frontmatter.replace(/\n---$/, "\n" + yaml + "\n---") : "---\n" + yaml + "\n---";
  }
  return { title: resolvedTitle, subtitle: sub, abstract, explicitAbstract, fields, content, displayBody, body: (frontmatter ? frontmatter + "\n\n" : "") + displayBody };
}
// PAPER-FORMAT-2:END

export const RENDERER_VERSION = "2.5.1-paper-format";
const PAPER_QUALITY_LABEL = "High-quality scholarly research";
const PAPER_QUALITY_BASIS = "QNFO publisher classification for open-access, versioned research with a public revision history and reader correction channel; this is not a claim of independent peer review.";
const PAPER_PEER_REVIEW_STATUS = "Not independently peer-reviewed";
const PAPER_QUALITY_TAGS = [PAPER_QUALITY_LABEL, "open-access scholarly work", "versioned research publication"];

/* ------------------------------------------------------------------ */
/* escaping                                                            */
/* ------------------------------------------------------------------ */

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ */
/* frontmatter                                                         */
/* ------------------------------------------------------------------ */

function parseFrontmatter(md) {
  const meta = {};
  let body = String(md == null ? "" : md).replace(/^\uFEFF/, "");
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (m) {
    body = body.slice(m[0].length);
    const lines = m[1].split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!kv) { i++; continue; }
      const key = kv[1], rest = kv[2];
      const isBlock = rest === "|" || rest === "|-" || rest === ">" || rest === ">-";
      if (isBlock || rest === "") {
        const vals = [];
        let j = i + 1;
        while (j < lines.length && (lines[j].trim() === "" || /^\s{1,}\S/.test(lines[j]))) {
          if (lines[j].trim() !== "") vals.push(lines[j].replace(/^\s{2,}/, "").replace(/^-\s+/, ""));
          j++;
        }
        i = j;
        const joined = vals.join("\n").trim();
        if (key === "keywords" || key === "tags" || key === "domains" || key === "categories" || key === "authors") {
          meta[key] = vals.map(function (v) { return v.trim(); }).filter(Boolean);
        } else {
          meta[key] = joined;
        }
        continue;
      }
      meta[key] = rest.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
      i++;
    }
  }
  return { meta: meta, body: body };
}

/* ------------------------------------------------------------------ */
/* LaTeX -> Unicode (bibliography and frontmatter fields)              */
/* ------------------------------------------------------------------ */

const COMBINING = {
  '"': "\u0308", "'": "\u0301", "`": "\u0300", "^": "\u0302", "~": "\u0303",
  "=": "\u0304", ".": "\u0307", "u": "\u0306", "v": "\u030C", "H": "\u030B",
  "c": "\u0327", "k": "\u0328", "r": "\u030A", "b": "\u0331", "d": "\u0323"
};

const SPECIAL_LETTERS = {
  ss: "\u00df", ae: "\u00e6", AE: "\u00c6", oe: "\u0153", OE: "\u0152",
  o: "\u00f8", O: "\u00d8", aa: "\u00e5", AA: "\u00c5", l: "\u0142", L: "\u0141",
  i: "\u0131", j: "\u0237", S: "\u00a7", P: "\u00b6"
};

// decodeLatex turns a BibTeX/LaTeX field into plain text, keeping `$...$` math intact so the
// caller can typeset it. Accents are applied as combining marks and then NFC-normalised, so
// `{\"U}ber` becomes `Über` and `f{\"u}r` becomes `für` — no mojibake, no transliteration.
function decodeLatex(s) {
  let t = String(s == null ? "" : s);
  const maths = [];
  t = t.replace(/\$([^$]*)\$/g, function (_, g) {
    maths.push(g);
    return "\u0001" + (maths.length - 1) + "\u0001";
  });
  t = t.replace(/\\textendash\b/g, "\u2013").replace(/\\textemdash\b/g, "\u2014");
  t = t.replace(/---/g, "\u2014").replace(/--/g, "\u2013");
  t = t.replace(/\\(["'`^~=.])\s*\{?([A-Za-z])\}?/g, function (_, acc, ch) {
    return ch + (COMBINING[acc] || "");
  });
  t = t.replace(/\\([uvHckrb])\s*\{([A-Za-z])\}/g, function (_, acc, ch) {
    return ch + (COMBINING[acc] || "");
  });
  t = t.replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)\b\s*/g, function (_, name) {
    return SPECIAL_LETTERS[name] || name;
  });
  t = t.replace(/\\(ldots|dots|cdots|textellipsis)\b/g, "\u2026");
  t = t.replace(/\\(times)\b/g, "\u00d7");
  t = t.replace(/\\(mid)\b/g, "|");
  t = t.replace(/\\(_[{}])/g, "_");
  t = t.replace(/\\([&%$#_{}])/g, "$1");
  t = t.replace(/[{}]/g, "");
  t = t.replace(/~/g, "\u00a0");
  try { t = t.normalize("NFC"); } catch (e) { /* older engines: leave as combining marks */ }
  t = t.replace(/\u0001(\d+)\u0001/g, function (_, i) {
    return "$" + maths[parseInt(i, 10)] + "$";
  });
  return t;
}

/* ------------------------------------------------------------------ */
/* BibTeX                                                             */
/* ------------------------------------------------------------------ */

// parseBibTeX returns a Map key -> { type, fields }. It walks the source rather than using a
// regex per field so that nested braces, quoted values and math inside a title all survive.
function parseBibTeX(src) {
  const out = new Map();
  const s = String(src == null ? "" : src);
  const n = s.length;
  let i = 0;
  while (i < n) {
    const at = s.indexOf("@", i);
    if (at < 0) break;
    const head = /^@([A-Za-z]+)\s*([{(])/.exec(s.slice(at, at + 40));
    if (!head) { i = at + 1; continue; }
    const type = head[1].toLowerCase();
    const open = head[2];
    const close = open === "{" ? "}" : ")";
    let j = at + head[0].length;
    let key = "";
    while (j < n && s[j] !== "," && s[j] !== close) { key += s[j]; j++; }
    key = key.trim();
    if (s[j] === ",") j++;
    const fields = {};
    let depth = 0;
    while (j < n) {
      while (j < n && /[\s,]/.test(s[j])) j++;
      if (j >= n) break;
      if (depth === 0 && s[j] === close) { j++; break; }
      let name = "";
      while (j < n && /[A-Za-z0-9_-]/.test(s[j])) { name += s[j]; j++; }
      while (j < n && /\s/.test(s[j])) j++;
      if (s[j] !== "=") {
        while (j < n && s[j] !== ",") j++;
        j++;
        continue;
      }
      j++;
      while (j < n && /\s/.test(s[j])) j++;
      let val = "";
      if (s[j] === "{") {
        depth = 1; j++;
        while (j < n && depth > 0) {
          if (s[j] === "{") depth++;
          else if (s[j] === "}") { depth--; if (depth === 0) { j++; break; } }
          val += s[j]; j++;
        }
      } else if (s[j] === '"') {
        j++;
        let q = 0;
        while (j < n) {
          if (s[j] === '"' && q === 0) { j++; break; }
          if (s[j] === "{") q++;
          if (s[j] === "}") q--;
          val += s[j]; j++;
        }
      } else {
        while (j < n && s[j] !== "," && s[j] !== close && !/\s/.test(s[j])) { val += s[j]; j++; }
      }
      if (name) fields[name.toLowerCase()] = val;
    }
    if (key) out.set(key, { type: type, fields: fields });
    i = Math.max(j, at + 1);
  }
  return out;
}

function bibNames(raw) {
  const parts = String(raw == null ? "" : raw).split(/\s+and\s+/i).map(function (x) { return x.trim(); }).filter(Boolean);
  const names = [];
  for (let k = 0; k < parts.length; k++) {
    const p0 = parts[k];
    if (/^others$/i.test(p0)) { names.push({ etal: true }); continue; }
    const p = decodeLatex(p0).replace(/\s+/g, " ").trim();
    let family = "", given = "";
    if (p.indexOf(",") >= 0) {
      const chunks = p.split(",");
      family = (chunks[0] || "").trim();
      given = chunks.slice(1).join(",").trim();
    } else {
      const toks = p.split(" ");
      family = toks.pop();
      given = toks.join(" ");
    }
    names.push({ family: family, given: given });
  }
  return names;
}

function initialsOf(given) {
  return String(given || "")
    .split(/[\s.]+/)
    .filter(Boolean)
    .map(function (t) {
      return /^[A-Z]{2,}$/.test(t) ? t : t.charAt(0).toUpperCase() + ".";
    })
    .join(" ");
}

// formatNames renders an author field in the numeric-style "A. B. Family, C. D. Other" form.
function formatNames(raw) {
  const ns = bibNames(raw);
  if (!ns.length) return "";
  let etal = false;
  const real = [];
  for (let i = 0; i < ns.length; i++) {
    if (ns[i].etal) etal = true;
    else real.push(ns[i]);
  }
  const rendered = real.map(function (nm) {
    const ini = initialsOf(nm.given);
    return (ini ? ini + " " : "") + nm.family;
  }).join(", ");
  return rendered + (etal ? ", et al." : "");
}

/* ------------------------------------------------------------------ */
/* math + field helpers                                                */
/* ------------------------------------------------------------------ */

function safeKatex(tex, displayMode) {
  try {
    return katex.renderToString(String(tex), {
      displayMode: !!displayMode,
      throwOnError: false,
      strict: false,
      output: "html"
    });
  } catch (err) {
    return '<span class="katex-error">' + esc(tex) + "</span>";
  }
}

// fieldHtml decodes a BibTeX field, escapes it, and typesets any `$...$` math it contains.
function fieldHtml(value) {
  const decoded = decodeLatex(value);
  const parts = decoded.split(/(\$[^$]*\$)/g);
  return parts.map(function (p) {
    if (p.length > 2 && p.charAt(0) === "$" && p.charAt(p.length - 1) === "$") {
      return '<span class="math-inline">' + safeKatex(p.slice(1, -1), false) + "</span>";
    }
    return esc(p);
  }).join("");
}

function plainOf(value) {
  return decodeLatex(value).replace(/\$([^$]*)\$/g, "$1").replace(/\s+/g, " ").trim();
}

function trimDot(s) {
  return String(s || "").replace(/\s+$/, "");
}

function doiFromFields(f) {
  const direct = String(f.doi || f.DOI || "").trim();
  if (/^10\.\d{4,9}\//.test(direct)) return direct;
  const hay = [f.howpublished, f.note, f.url, f.journal, f.publisher].filter(Boolean).join(" ");
  const m = /(10\.\d{4,9}\/[^\s,;)}]+)/.exec(hay);
  if (m) return m[1].replace(/[.,;]$/, "");
  return "";
}

function arxivFromFields(f) {
  const hay = [f.howpublished, f.eprint, f.journal, f.note].filter(Boolean).join(" ");
  const m = /arxiv[:\s]*([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)/i.exec(hay);
  if (m) return m[1];
  if (String(f.eprinttype || "").toLowerCase() === "arxiv" && f.eprint) return plainOf(f.eprint);
  return "";
}

/* ------------------------------------------------------------------ */
/* reference entries                                                   */
/* ------------------------------------------------------------------ */

// formatBibEntry returns the HTML body of one reference (without its number) and a plain-text
// form used for the "cite as" line. Only fields present in the entry are printed.
function formatBibEntry(entry) {
  const f = (entry && entry.fields) || {};
  const type = (entry && entry.type) || "misc";
  const author = formatNames(f.author || f.editor || "");
  const editor = !f.author && f.editor ? formatNames(f.editor) : "";
  const title = f.title ? fieldHtml(f.title) : "";
  const year = String(f.year || f.date || "").replace(/[^0-9]/g, "").slice(0, 4);
  const doi = doiFromFields(f);
  const arxiv = arxivFromFields(f);
  const url = String(f.url || "").trim();
  const bits = [];

  if (author) bits.push('<span class="ref-authors">' + author + "</span>.");

  function titlePart(italic) {
    if (!title) return "";
    const t = trimDot(title);
    const punct = /[.?!]$/.test(t) ? "" : ".";
    return italic ? "<em>" + t + "</em>" + punct : "\u201c" + t + punct + "\u201d";
  }

  const isBook = type === "book" || type === "booklet" || type === "manual" || type === "proceedings";
  const isThesis = type === "phdthesis" || type === "mastersthesis";

  if (isBook) {
    const path = [];
    if (title) path.push(titlePart(true));
    const pub = [f.address ? plainOf(f.address) : "", f.publisher ? plainOf(f.publisher) : ""].filter(Boolean).join(": ");
    if (pub) path.push(esc(pub) + (year ? ", " + year : ""));
    else if (year) path.push(year);
    if (editor) path.push("ed. " + editor);
    bits.push(path.filter(Boolean).join(" "));
  } else if (type === "article") {
    const seg = [titlePart(false)];
    const venue = f.journal ? plainOf(f.journal) : "";
    const vol = f.volume ? plainOf(f.volume) : "";
    const num = f.number || f.issue ? plainOf(f.number || f.issue) : "";
    const pages = f.pages ? plainOf(f.pages).replace(/--/g, "\u2013") : "";
    const tail = [];
    if (venue) tail.push("<em>" + esc(venue) + "</em>");
    if (vol) tail.push("vol. " + esc(vol));
    if (num) tail.push("no. " + esc(num));
    if (pages) tail.push("pp. " + esc(pages));
    if (year) tail.push(esc(year));
    seg.push(tail.join(", ") + (tail.length ? "." : ""));
    bits.push(seg.filter(Boolean).join(" "));
  } else if (isThesis) {
    const seg = [titlePart(true)];
    const kind = type === "phdthesis" ? "PhD thesis" : "Master's thesis";
    const school = f.school ? plainOf(f.school) : "";
    seg.push(esc(kind) + (school ? ", " + esc(school) : "") + (year ? ", " + esc(year) : "") + ".");
    bits.push(seg.filter(Boolean).join(" "));
  } else if (type === "techreport" || type === "report") {
    const seg = [titlePart(true)];
    const parts = [];
    if (f.number) parts.push("Technical Report " + plainOf(f.number));
    if (f.institution) parts.push(plainOf(f.institution));
    if (year) parts.push(year);
    if (parts.length) seg.push(esc(parts.join(", ")) + ".");
    bits.push(seg.filter(Boolean).join(" "));
  } else if (type === "inproceedings" || type === "conference" || type === "incollection" || type === "inbook") {
    const seg = [titlePart(false)];
    const booktitle = f.booktitle ? plainOf(f.booktitle) : "";
    const pages = f.pages ? plainOf(f.pages).replace(/--/g, "\u2013") : "";
    const inBits = [];
    if (booktitle) inBits.push("In <em>" + esc(booktitle) + "</em>");
    if (editor) inBits.push("ed. " + editor);
    if (pages) inBits.push("pp. " + esc(pages));
    if (year) inBits.push(esc(year));
    if (inBits.length) seg.push(inBits.join(", ") + ".");
    if (f.publisher) seg.push(esc(plainOf(f.publisher)) + ".");
    bits.push(seg.filter(Boolean).join(" "));
  } else {
    // misc / online / unpublished / preprint / software / dataset
    const seg = [titlePart(false)];
    const howRaw = f.howpublished ? plainOf(f.howpublished) : "";
    // a howpublished that is only an identifier (arXiv:…, a bare DOI) is a link, not a venue:
    // name the repository instead of printing a bare number
    const isId = /(10\.\d{4,9}\/|arxiv[:\s]*\d{4}\.)/i.test(howRaw);
    let venue = isId ? "" : howRaw;
    if (!venue) {
      if (/arxiv[:\s]*\d{4}\./i.test(howRaw)) venue = "arXiv preprint";
      else if (f.publisher) venue = plainOf(f.publisher);
      else if (f.institution) venue = plainOf(f.institution);
    }
    const tail = [];
    if (venue) tail.push(esc(venue));
    else if (f.journal) tail.push("<em>" + esc(plainOf(f.journal)) + "</em>");
    if (!venue && f.institution) tail.push(esc(plainOf(f.institution)));
    if (year) tail.push(esc(year));
    if (tail.length) seg.push(tail.join(", ") + ".");
    bits.push(seg.filter(Boolean).join(" "));
  }

  const links = [];
  if (doi) links.push('doi:<a href="https://doi.org/' + esc(doi) + '">' + esc(doi) + "</a>");
  if (arxiv) links.push('arXiv:<a href="https://arxiv.org/abs/' + esc(arxiv) + '">' + esc(arxiv) + "</a>");
  if (url && !/^https?:\/\/(dx\.)?doi\.org/.test(url)) links.push('<a href="' + esc(url) + '">' + esc(url.replace(/^https?:\/\//, "")) + "</a>");

  let bodyText = bits.filter(Boolean).join(" ").replace(/\s+/g, " ").replace(/ \./g, ".").trim();
  if (bodyText && !/\.$/.test(bodyText)) bodyText += ".";
  const html = bodyText + (links.length ? ' <span class="ref-links">' + links.join(" \u00b7 ") + "</span>" : "");
  const plainParts = [];
  if (author) plainParts.push(author + ".");
  if (title) plainParts.push(plainOf(f.title) + ".");
  if (f.journal) plainParts.push(plainOf(f.journal) + ".");
  if (year) plainParts.push(year + ".");
  if (doi) plainParts.push("doi:" + doi);
  return { html: html, plain: plainParts.join(" ") };
}

/* ------------------------------------------------------------------ */
/* citations                                                           */
/* ------------------------------------------------------------------ */

const CITE_RE = /\[@([^\]\[]+)\]/g;

function stripFences(s) {
  return String(s || "").replace(/```[\s\S]*?```/g, " ");
}

// scanCitations returns the citation keys in order of first appearance, which is the numbering
// numeric style requires.
function scanCitations(body) {
  const ordered = [];
  const seen = new Set();
  const src = stripFences(body);
  CITE_RE.lastIndex = 0;
  let m;
  while ((m = CITE_RE.exec(src))) {
    const groups = m[1].split(";");
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i].trim();
      // the outer capture already excludes the leading "@", so accept either form
      const km = /^@?([^\s,\]}]+)/.exec(g);
      if (!km) continue;
      const key = km[1];
      if (!seen.has(key)) { seen.add(key); ordered.push(key); }
    }
  }
  return ordered;
}

function collapseNumbers(nums) {
  const sorted = nums.slice().sort(function (a, b) { return a - b; });
  const segs = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) segs.push(sorted[i] + "\u2013" + sorted[j]);
    else for (let k = i; k <= j; k++) segs.push(String(sorted[k]));
    i = j + 1;
  }
  return segs.join(", ");
}

// citeHtml renders one `[@a; @b]` group. ctx carries the key -> number map; a key with no entry in
// the bibliography is printed as itself and counted, so a missing reference is visible rather than
// invented or dropped.
function citeHtml(inner, ctx) {
  const groups = String(inner || "").split(";").map(function (s) { return s.trim(); }).filter(Boolean);
  const nums = [];
  const missing = [];
  let locator = "";
  for (let i = 0; i < groups.length; i++) {
    const km = /^@([^\s,\]}]+)(.*)$/.exec(groups[i]);
    if (!km) continue;
    const key = km[1];
    const rest = (km[2] || "").trim();
    if (rest) locator = rest.replace(/^,\s*/, "");
    // keys are matched case-insensitively: a body may cite @Arute2019 where the entry says arute2019
    const num = ctx ? (ctx.numbering.get(String(key).toLowerCase()) || ctx.numbering.get(key)) : 0;
    if (num) nums.push(num);
    else { missing.push(key); if (ctx) ctx.missing.add(key); }
  }
  if (!nums.length && !missing.length) return "";
  const parts = [];
  if (nums.length) parts.push(collapseNumbers(nums));
  for (let i = 0; i < missing.length; i++) parts.push(missing[i]);
  let text = parts.join(", ");
  if (locator) text += ", " + locator;
  if (nums.length) {
    return '<a class="cite" href="#ref-' + Math.min.apply(null, nums) + '">[' + esc(text) + "]</a>";
  }
  // With no bibliography in the document there is nothing missing to flag — print the author-year key
  // plainly. When a bibliography does exist, an unmatched key is a real defect and stays marked.
  if (ctx && ctx.hasBib) {
    return '<span class="cite cite-missing" title="no bibliography entry for this key">[' + esc(text) + "]</span>";
  }
  return '<span class="cite">[' + esc(text) + "]</span>";
}

/* ------------------------------------------------------------------ */
/* markdown                                                            */
/* ------------------------------------------------------------------ */

function extractSpecials(src) {
  const stash = [];
  let t = String(src == null ? "" : src);
  function push(kind, content) {
    stash.push({ kind: kind, content: content });
    return "\x00" + kind + (stash.length - 1) + "\x00";
  }
  t = t.replace(/\x60\x60\x60([^\n]*)\n([\s\S]*?)\x60\x60\x60/g, function (_, lang, code) {
    return push("C", { lang: lang.trim(), code: code.replace(/\n$/, "") });
  });
  t = t.replace(/\$\$([\s\S]*?)\$\$/g, function (_, c) { return push("D", c.trim()); });
  t = t.replace(/\\\[([\s\S]*?)\\\]/g, function (_, c) { return push("D", c.trim()); });
  t = t.replace(/\$([^\$\n]+?)\$/g, function (_, c) { return push("I", c.trim()); });
  t = t.replace(/\\\(([\s\S]*?)\\\)/g, function (_, c) { return push("I", c.trim()); });
  return { text: t, stash: stash };
}

function restoreSpecials(text, stash) {
  return text.replace(/\x00([CDI])(\d+)\x00/g, function (_, kind, idx) {
    const e = stash[parseInt(idx, 10)];
    if (!e) return "";
    if (kind === "C") return "<pre" + (e.lang ? ' class="lang-' + esc(e.lang) + '"' : "") + "><code>" + esc(e.code) + "</code></pre>";
    if (kind === "D") return '<div class="math-display">' + safeKatex(e.content, true) + "</div>";
    return '<span class="math-inline">' + safeKatex(e.content, false) + "</span>";
  });
}

function isTableSep(line) {
  const cells = splitRow(line);
  if (!cells.length) return false;
  return cells.every(function (c) { return /^:?-{3,}:?$/.test(c.trim()); });
}

function splitRow(line) {
  let s = String(line).replace(/\r$/, "").trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (c === "\\" && j + 1 < s.length && s[j + 1] === "|") { cur += "|"; j++; }
    else if (c === "|") { cells.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function parseAlign(sepLine) {
  return splitRow(sepLine).map(function (c) {
    const l = c.startsWith(":"), r = c.endsWith(":");
    return (l && r) ? "center" : (r ? "right" : "left");
  });
}

function renderInlinePlain(t, ctx) {
  let s = String(t == null ? "" : t);
  const escTokens = [];
  s = s.replace(/\\\\([\\\x60*_{}\[\]()#+.\-!|>~])/g, function (m, ch) {
    escTokens.push(ch);
    return "\x00E" + (escTokens.length - 1) + "\x00";
  });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, url) {
    return '<figure><img src="' + esc(url) + '" alt="' + esc(alt) + '">' +
      (alt ? "<figcaption>" + renderInlinePlain(alt, ctx) + "</figcaption>" : "") + "</figure>";
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, text, url) {
    return '<a href="' + esc(url) + '">' + text + "</a>";
  });
  s = s.replace(/\x60([^\x60\n]+)\x60/g, function (_, code) { return "<code>" + esc(code) + "</code>"; });
  s = s.replace(/\[\s*(@[^\]\n]+?)\s*\]/g, function (_, inner) { return citeHtml(inner, ctx); });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/\x00E(\d+)\x00/g, function (_, i) { return esc(escTokens[parseInt(i, 10)] || ""); });
  return s;
}

function renderInline(raw, ctx) {
  const e = extractSpecials(raw);
  return restoreSpecials(renderInlinePlain(e.text, ctx), e.stash);
}

function renderMarkdown(body, ctx) {
  const e = extractSpecials(body);
  // Recover blank-line-collapsed markdown (producer stripped newline-newline -> space).
  e.text = e.text.replace(/([^\n])[ \t]+(\|[^\n]*\|)[ \t]*(?=\n([ \t]*\|?[\s:|-]+\|?[ \t]*\n))/g, (mm, pre, hdr, sep) => {
    const nh = hdr.split("|").filter((x) => x.trim() !== "").length;
    const ns = (sep.match(/-+/g) || []).length;
    return nh > 0 && nh === ns ? pre + "\n" + hdr : mm;
  });
  e.text = e.text.replace(/([^\n])[ \t]+(---)[ \t]+(?=#{1,6}[ \t])/g, "$1\n$2\n");
  e.text = e.text.replace(/([^\n])[ \t]+(---)[ \t]*(?=\n)/g, "$1\n$2\n");
  e.text = e.text.replace(/([^\n])[ \t]+(#{1,6}[ \t])/g, "$1\n$2");
  const lines = e.text.split("\n");
  let o = "", i = 0;
  while (i < lines.length) {
    const line = lines[i], t = line.trim();
    if (!t) { i++; continue; }
    if (/^\x00[CD]\d+\x00$/.test(t)) { o += t; i++; continue; }
    if (t.indexOf("|") >= 0) {
      let si = i + 1;
      while (si < lines.length && !lines[si].trim()) si++;
      if (si < lines.length && isTableSep(lines[si])) {
        const header = splitRow(line);
        const aligns = parseAlign(lines[si]);
        const rows = [];
        const sepCount = aligns.length;
        let tailProse = "";
        let j = si + 1;
        while (j < lines.length) {
          if (!lines[j].trim()) { j++; continue; }
          if (lines[j].trim().indexOf("|") < 0) break;
          let cells = splitRow(lines[j]);
          if (sepCount > 0 && cells.length > sepCount) {
            const segs = lines[j].trim().split("|");
            let used = 0, cutIdx = segs.length - 1;
            for (let k = 0; k < segs.length; k++) {
              if (segs[k].trim() !== "") {
                used++;
                if (used === sepCount) { cutIdx = k; break; }
              }
            }
            cells = segs.slice(0, cutIdx + 1).map((x) => x.trim()).filter((x) => x !== "");
            tailProse = segs.slice(cutIdx + 1).join("|").trim();
            rows.push(cells);
            j++;
            break;
          }
          rows.push(cells);
          j++;
        }
        i = j;
        const ncol = Math.max(header.length, aligns.length, rows.length ? Math.max.apply(null, rows.map(function (r) { return r.length; })) : 0);
        o += "<table><thead><tr>";
        for (let c = 0; c < ncol; c++) {
          const al = aligns[c] || "left";
          o += '<th style="text-align:' + al + '">' + renderInlinePlain(header[c] || "", ctx) + "</th>";
        }
        o += "</tr></thead><tbody>";
        for (const row of rows) {
          o += "<tr>";
          for (let c = 0; c < ncol; c++) {
            const al = aligns[c] || "left";
            o += '<td style="text-align:' + al + '">' + renderInlinePlain(row[c] || "", ctx) + "</td>";
          }
          o += "</tr>";
        }
        o += "</tbody></table>";
        if (tailProse) o += "<p>" + renderInlinePlain(tailProse, ctx) + "</p>";
        continue;
      }
    }
    const hm = t.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      o += "<h" + hm[1].length + ">" + renderInlinePlain(hm[2], ctx) + "</h" + hm[1].length + ">";
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { o += "<hr>"; i++; continue; }
    if (t.charAt(0) === ">") {
      o += "<blockquote>";
      while (i < lines.length && lines[i].trim().charAt(0) === ">") {
        o += "<p>" + renderInlinePlain(lines[i].trim().replace(/^>\s?/, ""), ctx) + "</p>";
        i++;
      }
      o += "</blockquote>";
      continue;
    }
    if (/^[-*+]\s+/.test(t)) {
      o += "<ul>";
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        o += "<li>" + renderInlinePlain(lines[i].trim().replace(/^[-*+]\s+/, ""), ctx) + "</li>";
        i++;
      }
      o += "</ul>";
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      o += "<ol>";
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        o += "<li>" + renderInlinePlain(lines[i].trim().replace(/^\d+\.\s+/, ""), ctx) + "</li>";
        i++;
      }
      o += "</ol>";
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim()) {
      const lt = lines[i].trim();
      if (/^(#{1,6}\s|>|[-*+]\s|\d+\.\s)/.test(lt)) break;
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(lt)) break;
      if (lt.indexOf("|") >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) break;
      buf.push(lt);
      i++;
    }
    if (buf.length) o += "<p>" + renderInlinePlain(buf.join(" "), ctx) + "</p>";
  }
  return restoreSpecials(o, e.stash);
}

/* ------------------------------------------------------------------ */
/* metadata assembly                                                   */
/* ------------------------------------------------------------------ */

// The corpus stores a byline block at the top of some bodies — "Author: … / Affiliation: … /
// Email: … / ORCID: … / ISNI: … / Version: … / Date: …". It is metadata, not prose: lift it into
// the title block and remove it from the body so it stops printing as a paragraph.
const BYLINE_KEYS = ["author", "authors", "affiliation", "affiliations", "email", "e-mail", "orcid", "isni", "version", "date", "doi", "url", "keywords", "license"];

function extractBylineBlock(body) {
  const lines = String(body || "").split(/\r?\n/);
  // the byline can sit under one or more headings ("## <title>" then "Author: …"), so leading
  // headings and blank lines are skipped before the block is looked for
  let i = 0;
  let headingsSkipped = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }
    if (/^#{1,6}\s/.test(t) && headingsSkipped < 3) { headingsSkipped++; i++; continue; }
    break;
  }
  const start = i;
  const fields = {};
  let consumed = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) break;
    const kv = /^([A-Za-z][A-Za-z .-]{1,18}):\s*(.+)$/.exec(line);
    const bareUrl = /^(https?:\/\/\S+)$/.exec(line);
    if (kv) {
      const key = kv[1].toLowerCase().replace(/\s+/g, "-");
      if (BYLINE_KEYS.indexOf(key) < 0) break;
      if (!fields[key]) fields[key] = kv[2].trim().replace(/\s{2,}$/, "");
      i++;
      consumed++;
      continue;
    }
    if (bareUrl) { if (!fields.url) fields.url = bareUrl[1]; i++; consumed++; continue; }
    break;
  }
  if (consumed < 2) return { fields: {}, body: body };
  const kept = lines.slice(0, start).concat(lines.slice(i));
  while (kept.length && !kept[0].trim()) kept.shift();
  return { fields: fields, body: kept.join("\n") };
}

function toList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(Boolean);
  const s = String(v).trim();
  if (!s) return [];
  if (s.charAt(0) === "[") {
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) return j.map(function (x) { return String(x).trim(); }).filter(Boolean);
    } catch (e) { /* not JSON */ }
  }
  return s.split(/[;|]\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function pick() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function monthYear(published) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(published || "").trim());
  if (!m) return String(published || "").trim();
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const mi = parseInt(m[2], 10) - 1;
  return (months[mi] || m[2]) + " " + parseInt(m[3], 10) + ", " + m[1];
}

// buildMeta merges three sources in order of authority: the D1 row (opts.meta, authoritative for
// the record), the frontmatter, then the in-body byline block. Nothing is synthesised.
function buildMeta(fm, byline, opts) {
  const D = (opts && opts.meta) || {};
  const authors = toList(D.authors).length ? toList(D.authors)
    : toList(fm.authors).length ? toList(fm.authors)
      : toList(pick(fm.author, byline.author, byline.authors));
  const affiliations = toList(D.affiliations).length ? toList(D.affiliations)
    : toList(fm.affiliations).length ? toList(fm.affiliations)
      : toList(pick(fm.affiliation, byline.affiliation, byline.affiliations));
  const keywords = toList(D.keywords).length ? toList(D.keywords) : toList(fm.keywords);
  const subjects = toList(D.categories).length ? toList(D.categories) : toList(fm.categories);
  const doi = pick(D.doi, D.identifier, fm.doi, byline.doi);
  const dateRaw = pick(D.published, fm.date, byline.date);
  return {
    slug: pick(D.slug, fm.slug, opts && opts.slug),
    title: pick(D.title, fm.title, opts && opts.title) || "Untitled",
    subtitle: pick(D.subtitle, fm.subtitle, byline.subtitle),
    authors: authors,
    affiliations: affiliations,
    orcid: pick(fm.ORCID, fm.orcid, byline.orcid, D.orcid, opts && opts.orcid),
    isni: pick(fm.ISNI, fm.isni, byline.isni, D.isni),
    email: pick(fm.email, byline.email, D.email),
    date: dateRaw,
    dateDisplay: monthYear(dateRaw),
    version: pick(D.version, fm.version, byline.version),
    doi: doi,
    license: pick(D.license, fm.license, byline.license),
    paperType: pick(D.paper_type, fm.paper_type, fm.type),
    journal: pick(D.journal, fm.journal),
    pages: pick(D.pages, fm.pages),
    keywords: keywords,
    subjects: subjects,
    abstract: pick(D.abstract, fm.abstract),
    qualityLabel: pick(D.quality_label, fm.quality_label) || PAPER_QUALITY_LABEL,
    qualityBasis: pick(D.quality_basis, fm.quality_basis) || PAPER_QUALITY_BASIS,
    peerReviewStatus: pick(D.peer_review_status, fm.peer_review_status) || PAPER_PEER_REVIEW_STATUS,
    qualityEvidenceUrl: pick(D.quality_evidence_url, fm.quality_evidence_url) || "https://qnfo.org/about",
    qualityTags: toList(D.quality_tags).length ? toList(D.quality_tags) : toList(fm.quality_tags).length ? toList(fm.quality_tags) : PAPER_QUALITY_TAGS,
    url: pick(D.url, fm.url, byline.url),
    bibSource: pick(D.bib, D.bibtex, opts && opts.bibtex)
  };
}

function cleanDoi(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^10\.\d{4,9}\//.test(s)) return s;
  const m = /(10\.\d{4,9}\/[^\s,;]+)/.exec(s);
  return m ? m[1] : "";
}

/* ------------------------------------------------------------------ */
/* front matter                                                        */
/* ------------------------------------------------------------------ */

function buildFront(meta, ctx) {
  const kindLine = [meta.paperType ? esc(meta.paperType.charAt(0).toUpperCase() + meta.paperType.slice(1)) : "",
    meta.dateDisplay ? esc(meta.dateDisplay) : "",
    meta.version ? "v" + esc(meta.version) : ""].filter(Boolean).join(" \u00b7 ");

  const authorBits = [];
  for (let i = 0; i < meta.authors.length; i++) {
    const name = esc(meta.authors[i]);
    const sup = meta.affiliations.length > 1 ? "<sup>" + (i + 1) + "</sup>" : "";
    authorBits.push('<span class="author">' + name + sup + "</span>");
  }

  const affilBits = [];
  if (meta.affiliations.length) {
    for (let i = 0; i < meta.affiliations.length; i++) {
      const sup = meta.affiliations.length > 1 ? "<sup>" + (i + 1) + "</sup>" : "";
      affilBits.push('<span class="affiliation">' + sup + esc(meta.affiliations[i]) + "</span>");
    }
  }

  const ids = [];
  if (meta.orcid) {
    ids.push('<a class="orcid" href="https://orcid.org/' + esc(meta.orcid) + '">ORCID ' + esc(meta.orcid) + "</a>");
  }
  if (meta.isni) ids.push("ISNI " + esc(meta.isni));
  if (meta.email) ids.push('<a href="mailto:' + esc(meta.email) + '">' + esc(meta.email) + "</a>");
  const doi = cleanDoi(meta.doi);
  if (doi) ids.push('DOI <a href="https://doi.org/' + esc(doi) + '">' + esc(doi) + "</a>");
  if (meta.license) ids.push(esc(meta.license));

  const kw = meta.keywords.length ? '<div class="kwline"><span class="kwlabel">Keywords</span> ' + esc(meta.keywords.join(" \u00b7 ")) + "</div>" : "";
  const subj = meta.subjects.length ? '<div class="kwline"><span class="kwlabel">Subjects</span> ' + esc(meta.subjects.join(" \u00b7 ")) + "</div>" : "";
  const quality = '<div class="kwline"><span class="kwlabel">Publisher classification</span> ' + esc(meta.qualityLabel) + ' <span class="quality-basis">(' + esc(meta.qualityBasis) + ')</span></div>' +
    '<div class="kwline"><span class="kwlabel">Peer-review status</span> ' + esc(meta.peerReviewStatus) + "</div>";

  let citeAs = "";
  const year = (meta.date || "").slice(0, 4);
  if (meta.authors.length && meta.title) {
    const firstAuthor = meta.authors[0];
    const surname = /,/.test(firstAuthor) ? firstAuthor.split(",")[0].trim() : firstAuthor.trim().split(" ").pop();
    const given = /,/.test(firstAuthor) ? firstAuthor.split(",").slice(1).join(",").trim() : firstAuthor.trim().split(" ").slice(0, -1).join(" ");
    const firstIni = initialsOf(given);
    const lead = [surname + (firstIni ? ", " + firstIni : "") + (meta.authors.length > 2 ? ", et al." : "")].join("");
    const tail = ["(" + (year || "n.d.") + ").", meta.title + ".", "QNFO Preprint" + (meta.version ? " v" + meta.version : "") + ".", doi ? "doi:" + doi : ""]
      .filter(Boolean).join(" ");
    citeAs = '<div class="citeas"><span class="kwlabel">Cite as</span> ' + esc(lead + " " + tail) + "</div>";
  }

  const abstractBlock = meta.abstract
    ? '<section class="abstract"><h2 class="abstract-h">Abstract</h2><p>' + renderInline(meta.abstract, ctx) + "</p></section>"
    : "";

  const html =
    '<header class="paper-head">' +
    (kindLine ? '<div class="paper-kind">' + kindLine + "</div>" : "") +
    '<h1 class="paper-title">' + esc(meta.title) + "</h1>" +
    (meta.subtitle ? '<div class="paper-subtitle">' + esc(meta.subtitle) + "</div>" : "") +
    (authorBits.length ? '<div class="paper-authors">' + authorBits.join('<span class="authsep">,</span> ') + "</div>" : "") +
    (affilBits.length ? '<div class="paper-affils">' + affilBits.join("") + "</div>" : "") +
    (ids.length ? '<div class="paper-ids">' + ids.join('<span class="idsep">\u00b7</span>') + "</div>" : "") +
    abstractBlock +
    '<div class="paper-kw">' + quality + kw + subj + "</div>" +
    (citeAs || "") +
    '<hr class="head-rule">' +
    "</header>";

  return {
    html: html,
    kindLine: kindLine,
    authorsText: meta.authors.join("; "),
    idsText: [meta.orcid ? "ORCID " + meta.orcid : "", doi ? "DOI " + doi : "", meta.license].filter(Boolean).join(" \u00b7 ")
  };
}

/* ------------------------------------------------------------------ */
/* reference list                                                      */
/* ------------------------------------------------------------------ */

// parseBodyReferences lifts the bibliography a paper carries in its own prose: many records end with
// "## References" and a numbered APA list whose entries end in the pandoc key that cites them, e.g.
// "1. Ostrowski, A. (1918). Über … *Acta Math*. [@Ostrowski1918]". Those papers ship no references.bib,
// so before this the keys printed as raw text and every citation read as unresolved.
// It returns the entries, the body with that section removed, and where the section stopped.
function parseBodyReferences(body) {
  const s = String(body || "");
  const head = /(^|\n)#{1,3}[ \t]*(References|Bibliography|Works Cited|Literature Cited)[ \t]*$/im.exec(s);
  if (!head) return null;
  const lines = s.slice(head.index + head[0].length).split(/\r?\n/);
  const entries = [];
  let cur = null;
  let consumed = 0;
  let stopped = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (cur) { entries.push(cur); cur = null; }
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line) || /^#{1,6}\s/.test(line)) { stopped = true; break; }
    const m = /^(?:\[(\d+)\]|(\d+)[.)]|[-*\u2022])\s+(.*)$/.exec(line);
    if (m) {
      if (cur) entries.push(cur);
      cur = { num: m[1] ? parseInt(m[1], 10) : (m[2] ? parseInt(m[2], 10) : 0), text: m[3] };
    } else if (cur) {
      cur.text += " " + line;
    } else {
      cur = { num: 0, text: line };
    }
    consumed = i;
  }
  if (cur) entries.push(cur);
  if (entries.length < 2) return null;
  // An unkeyed list cannot be matched to in-text citation keys, but it is still a bibliography and is
  // typeset as one. Guard against a stray "References" mention in mid-prose: an unkeyed section must be
  // the closing section (no heading after it). A keyed list is its own evidence and needs no such guard.
  const hasLaterHeading = /(^|\n)#{1,3}[ \t]+\S/.test(s.slice(head.index + head[0].length));

  let auto = 0;
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i].num) entries[i].num = auto + 1;
    auto = Math.max(auto, entries[i].num);
  }
  // the key annotation is usually the last token of the entry; strip it from the printed line
  let keyed = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const tail = /\[@([^\]]+)\]\s*$/.exec(e.text);
    let km = tail;
    if (!km) km = /\[@([^\]]+)\]/.exec(e.text);
    if (km) {
      e.key = km[1].trim().replace(/^@/, "");
      e.text = (e.text.slice(0, km.index) + e.text.slice(km.index + km[0].length)).replace(/\s+/g, " ").trim();
      if (e.text) keyed++;
    }
  }
  if (keyed < 2 && hasLaterHeading) return null;
  if (keyed === 0) {
    // without keys, demand the shape of a bibliography: at least three entries and a majority carrying
    // a publication year (or a DOI), so a checklist that happens to follow a "References" heading is
    // not reformatted into one
    if (entries.length < 3) return null;
    let dated = 0;
    for (let i = 0; i < entries.length; i++) {
      if (/(?:1[6-9]|20)\d{2}/.test(entries[i].text) || /10\.\d{4,9}\//.test(entries[i].text)) dated++;
    }
    if (dated / entries.length < 0.6) return null;
  }

  // remove the section from the body, keeping anything after it (a colophon, a changelog)
  const rest = lines.slice(consumed + 1).join("\n");
  const bodyWithout = s.slice(0, head.index) + (stopped ? "\n" + rest : "");
  return { entries: entries, bodyWithout: bodyWithout };
}

// buildParsedRefs renders a body-carried bibliography. The entries keep the author's own wording — this
// reproduces the record, it does not rewrite it.
function buildParsedRefs(ctx, parsed) {
  if (!parsed || !parsed.entries.length) return { html: "", count: 0, missing: [] };
  let out = '<section class="refs"><h2 class="refs-h">References</h2><ol class="refs-list" start="1">';
  for (let i = 0; i < parsed.entries.length; i++) {
    const e = parsed.entries[i];
    out += '<li class="ref" id="ref-' + e.num + '"><span class="ref-num">[' + e.num + "]</span> " + renderInline(e.text, ctx) + "</li>";
  }
  out += "</ol></section>";
  return { html: out, count: parsed.entries.length, missing: Array.from(ctx ? ctx.missing : []) };
}

function buildReferences(ctx, bib) {
  if (!bib || !bib.size) return { html: "", count: 0, missing: Array.from(ctx ? ctx.missing : []) };
  const items = [];
  if (ctx && ctx.ordered.length) {
    for (let i = 0; i < ctx.ordered.length; i++) {
      const key = ctx.ordered[i];
      const entry = bib.get(key);
      if (!entry) continue;
      items.push({ num: ctx.numbering.get(String(key).toLowerCase()) || ctx.numbering.get(key), key: key, html: formatBibEntry(entry).html });    }
  }
  if (!items.length) {
    // No in-text citations but a bibliography ships with the paper: list it alphabetically, which is
    // how such a paper is normally read.
    const keys = Array.from(bib.keys()).sort(function (a, b) {
      const fa = formatNames((bib.get(a).fields || {}).author || "");
      const fb = formatNames((bib.get(b).fields || {}).author || "");
      return fa.localeCompare(fb) || a.localeCompare(b);
    });
    for (let i = 0; i < keys.length; i++) {
      items.push({ num: i + 1, key: keys[i], html: formatBibEntry(bib.get(keys[i])).html });
    }
  }
  if (!items.length) return { html: "", count: 0, missing: [] };
  let out = '<section class="refs"><h2 class="refs-h">References</h2><ol class="refs-list" start="1">';
  for (let i = 0; i < items.length; i++) {
    out += '<li class="ref" id="ref-' + items[i].num + '"><span class="ref-num">[' + items[i].num + ']</span> ' + items[i].html + "</li>";
  }
  out += "</ol></section>";
  return { html: out, count: items.length, missing: Array.from(ctx ? ctx.missing : []) };
}

// stripTrailingReferencesHeading removes an empty "References"/"Bibliography" heading that the
// producer left at the end of the body. A heading followed by real entries is kept as written.
function stripTrailingReferencesHeading(body) {
  const s = String(body || "");
  const re = /(^|\n)(#{1,3})\s*(References|Bibliography|Works Cited)\s*$/i;
  const m = re.exec(s);
  if (m && !s.slice(m.index + m[0].length).trim()) {
    return s.slice(0, m.index).replace(/\s+$/, "");
  }
  return s;
}

function dropDuplicateTitle(body, title) {
  const s = String(body || "");
  const m = /^(#{1,2})\s+(.+?)\s*$/m.exec(s);
  if (!m) return s;
  const norm = function (x) {
    return String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  };
  if (norm(m[2]) === norm(title)) {
    return s.slice(0, m.index) + s.slice(m.index + m[0].length).replace(/^\s*\n/, "");
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* public entry points                                                 */
/* ------------------------------------------------------------------ */

function renderPaperHTML(md, opts) {
  opts = opts || {};
  const pm = parseFrontmatter(md);
  const lifted = extractBylineBlock(pm.body);
  const meta = buildMeta(pm.meta, lifted.fields, opts);
  const formatted = formatPaper(md, { title: meta.title === "Untitled" ? "" : meta.title, subtitle: meta.subtitle });
  meta.title = formatted.title || meta.title;
  meta.subtitle = formatted.subtitle;
  meta.abstract = (formatted.explicitAbstract && formatted.abstract) || meta.abstract;
  const fields = formatted.fields;
  if (!meta.authors.length) meta.authors = toList(fields.authors || fields.author);
  if (!meta.affiliations.length) meta.affiliations = toList(fields.affiliations || fields.affiliation);
  meta.orcid = meta.orcid || fields.orcid || "";
  meta.isni = meta.isni || fields.isni || "";
  meta.email = (meta.email || fields.email || "").replace(/\[[^\]]+\]\(mailto:([^)]+)\)/g, "$1");
  meta.orcid = meta.orcid.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/^https?:\/\/orcid\.org\//, "");
  meta.version = meta.version || fields.version || "";
  meta.date = meta.date || fields.date || fields["publication date"] || "";
  meta.dateDisplay = monthYear(meta.date);
  meta.license = meta.license || fields.license || "";

  const bib = parseBibTeX(meta.bibSource || "");
  const ctx = { ordered: [], numbering: new Map(), missing: new Set(), hasBib: false };

  let body = formatted.explicitAbstract
    ? formatted.content.replace(/^## Abstract[ \t]*\n+[\s\S]*?(?=\n#{1,6}[ \t]+|$)/m, "").trim()
    : formatted.content.replace(/^## Abstract[ \t]*\n+/, "");

  // Bibliography source, in order of authority: the paper's BibTeX (references.bib in R2), then the
  // numbered list the paper carries in its own text, then nothing.
  let parsedRefs = null;
  if (bib.size) {
    const lower = new Map();
    bib.forEach(function (v, k) { lower.set(String(k).toLowerCase(), k); });
    ctx.ordered = scanCitations(body + "\n" + (meta.abstract || ""));
    let n = 0;
    for (let i = 0; i < ctx.ordered.length; i++) {
      const key = ctx.ordered[i];
      const real = bib.has(key) ? key : lower.get(String(key).toLowerCase());
      if (real) {
        n++;
        ctx.numbering.set(String(key).toLowerCase(), n);
        if (real !== key) ctx.numbering.set(real, n);
      }
    }
    ctx.hasBib = n > 0;
  } else {
    parsedRefs = parseBodyReferences(body);
    if (parsedRefs) {
      for (let i = 0; i < parsedRefs.entries.length; i++) {
        const e = parsedRefs.entries[i];
        if (e.key) ctx.numbering.set(String(e.key).toLowerCase(), e.num);
      }
      ctx.hasBib = ctx.numbering.size > 0;
      body = parsedRefs.bodyWithout;
    }
  }

  // an empty "References" heading with nothing under it is a defect either way: drop it, and let
  // the generated list take its place when a bibliography exists
  body = stripTrailingReferencesHeading(body);

  // render first: the citation pass records unresolved keys on ctx, and the reference list reports them
  const bodyHtml = renderMarkdown(body, ctx);
  const refs = bib.size ? buildReferences(ctx, bib) : (parsedRefs ? buildParsedRefs(ctx, parsedRefs) : buildReferences(ctx, bib));
  const front = buildFront(meta, ctx);

  return {
    title: meta.title,
    author: meta.authors.join("; "),
    authors: meta.authors,
    affiliations: meta.affiliations,
    date: meta.date,
    version: meta.version,
    doi: cleanDoi(meta.doi),
    license: meta.license,
    abstract: meta.abstract,
    qualityLabel: meta.qualityLabel,
    qualityBasis: meta.qualityBasis,
    peerReviewStatus: meta.peerReviewStatus,
    qualityEvidenceUrl: meta.qualityEvidenceUrl,
    qualityTags: meta.qualityTags,
    keywords: meta.keywords,
    bodyHtml: bodyHtml,
    refsHtml: refs.html,
    front: front.html,
    kindLine: front.kindLine,
    idsText: front.idsText,
    stats: {
      citations: ctx.numbering.size,
      references: refs.count,
      unresolved: refs.missing,
      bibEntries: bib.size
    }
  };
}

const PRINT_CSS = `
@page { size: A4; margin: 21mm 19mm 22mm 19mm; }
@page :first { margin-top: 18mm; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Source Serif Pro", "Charter", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
  font-size: 10.2pt; line-height: 1.52; color: #14171c;
  text-align: justify; hyphens: auto; -webkit-hyphens: auto;
  overflow-wrap: break-word; font-kerning: normal;
  font-variant-numeric: proportional-nums;
}

/* ---- title block ---- */
.paper-head { margin: 0 0 14pt 0; }
.paper-kind { font-size: 7.9pt; letter-spacing: .13em; text-transform: uppercase; color: #6b7280; text-align: center; margin: 0 0 9pt 0; }
h1.paper-title { font-size: 18.5pt; font-weight: 600; line-height: 1.24; text-align: center; margin: 0 0 5pt 0; hyphens: none; letter-spacing: -0.005em; }
.paper-subtitle { text-align: center; font-size: 12pt; font-style: italic; color: #3d4450; margin: 0 0 9pt 0; }
.paper-authors { text-align: center; font-size: 11.4pt; line-height: 1.5; margin: 11pt 0 3pt 0; hyphens: none; }
.paper-authors .authsep { color: #9aa1ab; }
.paper-authors sup { font-size: 7pt; vertical-align: super; color: #4b5563; }
.paper-affils { text-align: center; font-size: 8.7pt; line-height: 1.45; color: #4b5563; margin: 4pt 0 0 0; }
.paper-affils .affiliation { display: inline-block; margin: 0 6pt; }
.paper-affils sup { font-size: 6.6pt; }
.paper-ids { text-align: center; font-size: 8.2pt; color: #5b626b; margin: 7pt 0 0 0; }
.paper-ids a, .paper-kw a { color: #1f3a68; text-decoration: none; }
.paper-ids .idsep { margin: 0 4pt; color: #b3b9c2; }

.abstract { margin: 15pt 26pt 9pt 26pt; }
.abstract-h { font-size: 8.6pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #1f3a68; text-align: center; margin: 0 0 5pt 0; border: 0; padding: 0; }
.abstract p { font-size: 9.5pt; line-height: 1.5; margin: 0; text-align: justify; }

.paper-kw { font-size: 8.4pt; color: #3d4450; margin: 8pt 26pt 2pt 26pt; text-align: left; }
.kwline { margin: 0 0 2.5pt 0; }
.kwlabel { font-weight: 700; letter-spacing: .06em; text-transform: uppercase; font-size: 7.4pt; color: #6b7280; margin-right: 1pt; }
.citeas { font-size: 8.2pt; color: #3d4450; margin: 7pt 26pt 0 26pt; text-align: left; }
.head-rule { border: none; border-top: .6pt solid #cfd4db; margin: 13pt 0 0 0; }

/* ---- body ---- */
h1, h2, h3, h4, h5 { font-weight: 600; page-break-after: avoid; break-after: avoid; hyphens: none; }
h1 { font-size: 13.6pt; margin: 18pt 0 6pt 0; }
h2 { font-size: 12pt; margin: 15pt 0 5pt 0; }
h3 { font-size: 10.6pt; margin: 12pt 0 4pt 0; font-style: italic; font-weight: 600; }
h4 { font-size: 10.2pt; margin: 10pt 0 3pt 0; }
p { margin: 0 0 6.5pt 0; orphans: 3; widows: 3; }
p + p { margin-top: 0; }
ul, ol { margin: 0 0 7pt 0; padding-left: 17pt; }
li { margin: 0 0 2.5pt 0; }
li > p { margin: 0 0 3pt 0; }
blockquote { margin: 9pt 18pt; padding: 2pt 0 2pt 11pt; border-left: 1.6pt solid #c7ccd4; color: #333a44; font-size: 9.6pt; }
hr { border: none; border-top: .6pt solid #d6d9de; margin: 13pt 0; }

/* ---- tables (booktabs) ---- */
table { width: 100%; border-collapse: collapse; margin: 10pt 0 11pt 0; font-size: 8.6pt; line-height: 1.36; page-break-inside: avoid; }
caption { caption-side: top; text-align: left; font-size: 8.4pt; color: #3d4450; padding: 0 0 4pt 0; }
thead { display: table-header-group; }
th { font-weight: 700; text-align: left; vertical-align: bottom; border-top: 1.1pt solid #14171c; border-bottom: .55pt solid #14171c; padding: 3.5pt 5pt; }
td { border: none; padding: 2.6pt 5pt; vertical-align: top; }
tbody tr:last-child td { border-bottom: 1.1pt solid #14171c; }
tbody tr + tr td { border-top: .3pt solid #e4e7eb; }
thead th + th, tbody td + td { padding-left: 6pt; }

/* ---- figures ---- */
figure { margin: 12pt 0; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; height: auto; }
figcaption { font-size: 8.5pt; line-height: 1.4; color: #3d4450; margin-top: 5pt; text-align: left; }

/* ---- math ---- */
.math-display { text-align: center; margin: 11pt 0; page-break-inside: avoid; }
.math-inline { white-space: nowrap; }
.katex { font-size: 1.03em; }
.katex-display { margin: 0 !important; }
mjx-container[display='true'] { margin: 4pt 0 !important; }

/* ---- code ---- */
pre { font-family: "JetBrains Mono", Consolas, "Courier New", monospace; font-size: 7.9pt; line-height: 1.42; background: #f7f7f5; border: .4pt solid #e2e4e8; border-left: 1.6pt solid #c7ccd4; padding: 6pt 8pt; margin: 9pt 0; white-space: pre-wrap; word-wrap: break-word; page-break-inside: avoid; }
code { font-family: "JetBrains Mono", Consolas, "Courier New", monospace; font-size: .9em; }
pre code { font-size: 1em; }

/* ---- citations + references ---- */
.cite { color: #1f3a68; text-decoration: none; font-variant-numeric: lining-nums; }
.cite-missing { color: #8a6d1f; border-bottom: .4pt dotted #8a6d1f; }
a { color: #1f3a68; text-decoration: none; }
.refs { margin-top: 16pt; }
.refs-h { font-size: 12pt; font-weight: 600; margin: 0 0 6pt 0; }
ol.refs-list { list-style: none; margin: 0; padding: 0; counter-reset: none; }
li.ref { font-size: 8.7pt; line-height: 1.42; margin: 0 0 4.2pt 0; padding-left: 2.4em; text-indent: -2.4em; text-align: left; page-break-inside: avoid; }
li.ref .ref-num { color: #14171c; font-variant-numeric: lining-nums; }
li.ref em { font-style: italic; }
li.ref .ref-links { color: #5b626b; font-size: .95em; word-break: break-all; }
li.ref a { border-bottom: .3pt solid #d6d9de; }
`;

function renderFullHTML(md, opts) {
  const r = renderPaperHTML(md, opts);
  if (opts && opts.stats && typeof opts.stats === "object") Object.assign(opts.stats, r.stats);
  const doi = cleanDoi(r.doi);
  // the description tag carries plain prose: citation markers and emphasis are markup, not text
  const description = String(r.abstract || "")
    .replace(/\[@[^\]]+\]/g, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 380);
  const metas = [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + esc(r.title) + (r.author ? " \u2014 " + esc(r.author) : "") + "</title>",
    '<meta name="author" content="' + esc(r.author) + '">',
    r.abstract ? '<meta name="description" content="' + esc(description) + '">' : "",
    r.keywords && r.keywords.length ? '<meta name="keywords" content="' + esc(r.keywords.join(", ")) + '">' : "",
    '<meta name="qnfo:quality-label" content="' + esc(r.qualityLabel) + '">',
    '<meta name="qnfo:quality-basis" content="' + esc(r.qualityBasis) + '">',
    '<meta name="qnfo:peer-review-status" content="' + esc(r.peerReviewStatus) + '">',
    '<meta name="qnfo:quality-evidence" content="' + esc(r.qualityEvidenceUrl) + '">',
    r.date ? '<meta name="dcterms.created" content="' + esc(r.date) + '">' : "",
    '<meta name="dcterms.type" content="ScholarlyArticle">',
    '<meta name="citation_publication_type" content="research-article">',
    doi ? '<meta name="citation_doi" content="' + esc(doi) + '">' : "",
    '<meta name="citation_title" content="' + esc(r.title) + '">',
    r.authors.map(function (a) { return '<meta name="citation_author" content="' + esc(a) + '">'; }).join(""),
    r.date ? '<meta name="citation_publication_date" content="' + esc(r.date) + '">' : "",
    '<meta name="citation_publisher" content="QNFO">',
    r.qualityTags.map(function (tag) { return '<meta name="citation_keywords" content="' + esc(tag) + '">'; }).join(""),
    '<script type="application/ld+json">' + JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ScholarlyArticle",
      headline: r.title,
      author: r.authors.map(function (name) { return { "@type": "Person", name: name }; }),
      publisher: { "@type": "Organization", name: "QNFO", publishingPrinciples: r.qualityEvidenceUrl },
      genre: r.qualityLabel,
      keywords: r.keywords.concat(r.qualityTags),
      additionalProperty: [
        { "@type": "PropertyValue", name: "Publisher quality classification", value: r.qualityLabel, description: r.qualityBasis },
        { "@type": "PropertyValue", name: "Peer review status", value: r.peerReviewStatus }
      ]
    }).replace(/</g, "\\u003c") + "</script>"
  ].filter(Boolean).join("");
  return '<!DOCTYPE html><html lang="en"><head>' + metas +
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css">' +
    "<style>" + PRINT_CSS + "</style></head><body>" +
    r.front + r.bodyHtml + r.refsHtml + "</body></html>";
}

// buildPrintTemplates returns the running head and the page footer. Kept here (not in worker.js)
// so the typeset test can assert them without a browser.
function buildPrintTemplates(meta) {
  meta = meta || {};
  const title = String(meta.title || "").replace(/\s+/g, " ").trim();
  const shortTitle = title.length > 72 ? title.slice(0, 69).replace(/[\s,;:.]+$/, "") + "\u2026" : title;
  const authors = String(meta.authors || "").trim();
  const doi = cleanDoi(meta.doi);
  const right = authors.length > 52 ? authors.slice(0, 49) + "\u2026" : authors;
  const head = '<div style="font-family:Georgia,serif;font-size:7.6pt;color:#6b7280;width:100%;padding:0 19mm 3px 19mm;border-bottom:.4px solid #dfe2e7;box-sizing:border-box;display:flex;justify-content:space-between;align-items:baseline;">' +
    "<span>" + esc(shortTitle) + "</span><span style=\"text-align:right;\">" + esc(right) + "</span></div>";
  const left = doi ? ("doi:" + doi) : (meta.license ? String(meta.license) : "");
  const foot = '<div style="font-family:Georgia,serif;font-size:7.6pt;color:#6b7280;width:100%;padding:3px 19mm 0 19mm;box-sizing:border-box;display:flex;justify-content:space-between;align-items:baseline;">' +
    "<span>" + esc(left) + "</span>" +
    '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>' +
    "<span>" + esc(meta.license && doi ? String(meta.license) : "QNFO") + "</span></div>";
  return { headerTemplate: head, footerTemplate: foot };
}

export {
  esc,
  parseFrontmatter,
  parseBibTeX,
  decodeLatex,
  formatNames,
  formatBibEntry,
  scanCitations,
  parseBodyReferences,
  buildReferences,
  buildMeta,
  buildFront,
  buildPrintTemplates,
  extractBylineBlock,
  renderMarkdown,
  renderInline,
  renderPaperHTML,
  renderFullHTML,
  cleanDoi,
  PRINT_CSS
};
