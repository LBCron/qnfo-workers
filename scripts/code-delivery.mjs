export const CODE_DELIVERY_DOD = "## Definition of done (CODE-CHANGE-REQUIRED-1)\n\n"
  + "- Implement the issue's remedy in code, an applied migration, or executable configuration in this PR.\n"
  + "- Link the issue and identify the changed implementation paths; run the relevant regression checks.\n"
  + "- Verify the required outcome after canonical deployment before closing the issue.\n\n"
  + "An empty diff, investigation-only report, or documentation-only PR does not satisfy this definition of done. "
  + "If the requested implementation already exists, record that evidence on the issue, not in a no-change PR.";

export const CODE_PATH_RE = /(\.(?:[cm]?js|jsx|tsx?|py|sql|sh|bash|rs|go|rb|java|kt|swift|c|cc|cpp|h|cs|php|html|css|scss|vue|svelte|toml|ya?ml)$|(?:^|\/)(?:package(?:-lock)?|tsconfig|config|wrangler)\.jsonc?$)/i;

export function hasCodeChanges(files) {
  return Array.isArray(files) && files.some((f) => {
    const name = String(f && f.filename || "");
    return name && !/^docs\//i.test(name) && CODE_PATH_RE.test(name)
      && (f.additions === undefined || f.deletions === undefined || Number(f.additions) + Number(f.deletions) > 0);
  });
}

export function withCodeDeliveryDoD(body) {
  const text = String(body || "");
  return text.includes(CODE_DELIVERY_DOD) ? text : text + "\n\n" + CODE_DELIVERY_DOD;
}
