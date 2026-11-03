// PAPER-FORMAT-2: presentation-only normalization shared by publication, HTML and PDF.
export function formatPaper(source, record) {
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
  const metaLabel = /(?:^|\s)(?:[*_]{1,2})?(authors?|affiliations?|contact|e-?mail|orcid|isni|url|website|publication date|date|version|doi|license|keywords|status|modified|last updated|robots|dc\.rights)(?:[*_]{1,2})?[ \t]*:[*_]{0,2}[ \t]*/gi;
  const blocks = text.trim().split(/\n[ \t]*\n/);
  const explicitAbstract = !!fields.abstract || blocks.some((b) => abstractLabel(b.split("\n")[0]) || /^(?:#{1,6}[ \t]+)?[*_]{0,2}abstract[*_]{0,2}[ \t]*:/i.test(b));
  const kept = [];
  let inHeader = true, titleSeen = false, subtitle = "", abstract = "", titleFragment = "", abstractFragment = false;
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
      if (abstractFragment) {
        const fragmentIndex = kept.lastIndexOf(abstract);
        if (fragmentIndex >= 0) kept.splice(fragmentIndex, 1);
        abstract = "";
        abstractFragment = false;
      }
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
        if (!resolvedTitle || (bh && bh[1] === "#" && tn && n.startsWith(tn + " "))) resolvedTitle = bare;
        titleSeen = true;
        continue;
      }
      // Before a real abstract, a non-section heading is a subtitle, not a TOC item.
      if ((!abstract || abstractFragment) && (bh || /^\*[^*\n][\s\S]*\*$/.test(block)) && blocks.slice(i + 1).some(abstractLabel) && !/^(?:\d+[.)]?\s|chapter\b|introduction\b|objective\b)/i.test(bare)) {
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
          if (!kept.includes("## Abstract")) kept.push("## Abstract");
          pendingAbstract = false;
          abstract = block;
          abstractFragment = (block.trim().match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || []).length <= 3;
          if (abstractFragment && !titleFragment && /\b(?:of|and|or|the|to|for|with|in|by|from|as|at|on|about|into|through|between|without|than|over|under)$/i.test(resolvedTitle)) {
            const candidate = block.trim().replace(/[.!?]+$/, "");
            if (/^[A-Z][A-Za-z'-]*$/.test(candidate)) titleFragment = candidate;
          }
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
  const recordAbstract = String(row.abstract || "").trim();
  const words = (value) => (String(value || "").match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || []).length;
  const fragment = titleFragment || (words(abstract) <= 3 ? abstract.trim().replace(/[.!?]+$/, "") : "");
  if (recordAbstract && words(recordAbstract) >= 20 && words(abstract) <= 3) {
    if (words(abstract) <= 3) abstract = recordAbstract;
  }
  if (fragment) {
    if (/\b(?:of|and|or|the|to|for|with|in|by|from|as|at|on|about|into|through|between|without|than|over|under)$/i.test(resolvedTitle) && /^[A-Z][A-Za-z'-]*$/.test(fragment)) {
      resolvedTitle = (resolvedTitle + " " + fragment).trim();
    }
    const abstractMatch = /^## Abstract[ \t]*\n+([\s\S]*?)(?=\n#{1,6}[ \t]+|$)/m.exec(content);
    if (recordAbstract && words(recordAbstract) >= 20 && abstractMatch && words(abstractMatch[1]) <= 3) {
      content = content.slice(0, abstractMatch.index) + "## Abstract\n\n" + recordAbstract + content.slice(abstractMatch.index + abstractMatch[0].length);
      abstract = recordAbstract;
    }
  }
  if (resolvedTitle) {
    fields.title = resolvedTitle;
    frontmatter = frontmatter.replace(/^title:[ \t]*.*$/mi, "title: " + JSON.stringify(resolvedTitle));
  }
  if (abstract) fields.abstract = abstract;
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
