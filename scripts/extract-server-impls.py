#!/usr/bin/env python3
"""
One-off codemod (rework phase 02): split TanStack server functions into a plain
`<name>Impl(data)` function plus a thin `createServerFn` wrapper, so tests can
call the logic directly (server functions need the Start runtime context).

    export const fetchX = createServerFn({ method: "GET" })
      .inputValidator(V)
      .handler(async ({ data }): Promise<T> => { BODY });

becomes

    const fetchXInput = V;
    export async function fetchXImpl(data: ReturnType<typeof fetchXInput>): Promise<T> { BODY }
    export const fetchX = createServerFn({ method: "GET" })
      .inputValidator(fetchXInput)
      .handler(({ data }) => fetchXImpl(data));

Usage: extract-server-impls.py <file.ts> <name> [<name> ...]
"""
import re
import sys


def match_paren(s: str, i: int, open_ch: str, close_ch: str) -> int:
    """Index of the bracket closing s[i] (== open_ch), skipping strings/comments."""
    depth = 0
    j = i
    n = len(s)
    while j < n:
        c = s[j]
        if c in "\"'":
            q = c
            j += 1
            while j < n and s[j] != q:
                j += 2 if s[j] == "\\" else 1
        elif c == "`":
            j += 1
            while j < n and s[j] != "`":
                if s[j] == "\\":
                    j += 2
                    continue
                if s.startswith("${", j):
                    j = match_paren(s, j + 1, "{", "}")
                j += 1
        elif s.startswith("//", j):
            j = s.index("\n", j)
        elif s.startswith("/*", j):
            j = s.index("*/", j) + 1
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return j
        j += 1
    raise ValueError(f"unbalanced {open_ch} at {i}")


def transform(src: str, name: str) -> str:
    start = src.index(f"export const {name} = createServerFn(")
    create_open = src.index("(", start)
    create_close = match_paren(src, create_open, "(", ")")
    create_call = src[start + len(f"export const {name} = "): create_close + 1]

    pos = create_close + 1
    validator = None
    m = re.compile(r"\s*\.inputValidator\(").match(src, pos)
    if m:
        v_open = m.end() - 1
        v_close = match_paren(src, v_open, "(", ")")
        validator = src[v_open + 1: v_close].strip().rstrip(",").rstrip()
        pos = v_close + 1

    m = re.compile(r"\s*\.handler\(\s*async\s*\(([^)]*)\)\s*(:\s*[^=]+?)?\s*=>\s*\{").match(src, pos)
    if not m:
        raise ValueError(f"{name}: unsupported handler shape near {src[pos:pos+80]!r}")
    params, ret = m.group(1).strip(), (m.group(2) or "").strip()
    body_open = m.end() - 1
    body_close = match_paren(src, body_open, "{", "}")
    body = src[body_open + 1: body_close]

    end_paren = src.index(")", body_close)
    end = end_paren + 1
    if src[end] == ";":
        end += 1

    uses_data = "data" in params
    lines = []
    if validator:
        lines.append(f"const {name}Input = {validator};\n\n")
        sig = f"data: ReturnType<typeof {name}Input>" if uses_data else ""
    else:
        sig = ""
    lines.append(f"export async function {name}Impl({sig}){ret} {{{body}}}\n\n")
    wrapper = f"export const {name} = {create_call}"
    if validator:
        wrapper += f"\n  .inputValidator({name}Input)"
        wrapper += (
            f"\n  .handler(({{ data }}) => {name}Impl(data));"
            if uses_data
            else f"\n  .handler(() => {name}Impl());"
        )
    else:
        wrapper += f".handler(() => {name}Impl());"
    lines.append(wrapper)
    return src[:start] + "".join(lines) + src[end:]


def main() -> None:
    path, names = sys.argv[1], sys.argv[2:]
    src = open(path).read()
    for name in names:
        src = transform(src, name)
    open(path, "w").write(src)


if __name__ == "__main__":
    main()
