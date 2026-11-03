"""Code-change contract shared by the code-task and conflict-repair publishers."""
import re

CODE_PATH_RE = re.compile(r"(\.(?:[cm]?js|jsx|tsx?|py|sql|sh|bash|rs|go|rb|java|kt|swift|c|cc|cpp|h|cs|php|html|css|scss|vue|svelte|toml|ya?ml)$|(?:^|/)(?:package(?:-lock)?|tsconfig|config|wrangler)\.jsonc?$)", re.I)


def implementation_path(path):
    return not path.lower().startswith("docs/") and bool(CODE_PATH_RE.search(path))


def numstat_has_code_changes(delta):
    for line in delta.splitlines():
        parts = line.split("\t")
        if (len(parts) == 3 and implementation_path(parts[2])
                and parts[0].isdigit() and parts[1].isdigit()
                and int(parts[0]) + int(parts[1]) > 0):
            return True
    return False
