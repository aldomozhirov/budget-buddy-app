#!/usr/bin/env python3
"""Split docs/design/html/styleguide.html into one Markdown file per section.

Run from the repository root after the style guide is regenerated:

    python3 docs/design/split-styleguide.py

It rewrites docs/design/styleguide/ (one file per <section id>, plus README.md
as the index). The live demos are left out because each one is repeated as
copyable markup; the page's own CSS and script are left out too.
"""
import re
import shutil
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "html" / "styleguide.html"
OUT = ROOT / "styleguide"
VOID = {"br", "img", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "input", "hr", "meta", "link"}
INLINE = {"code", "b", "strong", "em", "i", "span", "a", "br", "svg", "small", "kbd"}


class Node:
    def __init__(self, tag, attrs=None):
        self.tag, self.attrs, self.kids = tag, dict(attrs or []), []

    def cls(self):
        return (self.attrs.get("class") or "").split()

    def text(self):
        return "".join(k if isinstance(k, str) else k.text() for k in self.kids)

    def find(self, pred):
        for k in self.kids:
            if isinstance(k, Node):
                if pred(k):
                    yield k
                yield from k.find(pred)


class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].kids.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].kids.append(Node(tag, attrs))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].kids.append(data)


def squash(s):
    return re.sub(r"\s+", " ", s).strip()


def inline(node):
    out = []
    for k in node.kids if isinstance(node, Node) else [node]:
        if isinstance(k, str):
            out.append(k)
        elif k.tag == "code":
            out.append("`" + squash(k.text()) + "`")
        elif k.tag in ("b", "strong"):
            out.append("**" + squash(inline(k)) + "** ")
        elif k.tag == "br":
            out.append(" ")
        elif k.tag in ("svg", "button"):
            continue
        else:
            out.append(inline(k))
    return "".join(out)


def cell(node):
    return squash(inline(node)).replace("|", "\\|")


def table(node):
    rows = [[cell(c) for c in r.kids if isinstance(c, Node) and c.tag in ("th", "td")] for r in node.find(lambda n: n.tag == "tr")]
    rows = [r for r in rows if r]
    if not rows:
        return []
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * len(rows[0])]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return ["\n".join(lines)]


def icons(node):
    items = []
    for b in node.find(lambda n: "sg-icon" in n.cls()):
        name = squash("".join(k for k in b.kids if isinstance(k, str)))
        use = squash("".join(k.text() for k in b.kids if isinstance(k, Node) and k.tag == "span"))
        items.append((name, use, b.attrs.get("data-svg", "")))
    wrap = re.compile(r"^(<svg[^>]*>)(.*)(</svg>)$", re.S)
    heads = {wrap.match(s).group(1) for _, _, s in items if wrap.match(s)}
    if len(heads) == 1 and all(wrap.match(s) for _, _, s in items):
        head = heads.pop()
        out = ["Every icon uses this wrapper; the table gives what goes inside it.", "```html\n" + head + "…</svg>\n```"]
        out.append("\n".join(["| Name | Use | Inside the wrapper |", "|---|---|---|"] + ["| %s | %s | `%s` |" % (n, u, wrap.match(s).group(2)) for n, u, s in items]))
        return out
    return ["\n".join("- **%s** (%s): `%s`" % i for i in items)]


def blocks(node, depth=1):
    out, buf = [], []

    def flush():
        text = squash("".join(buf))
        buf.clear()
        if text:
            out.append(text)

    for k in node.kids:
        if isinstance(k, str) or k.tag in INLINE and "sg-spec" not in k.cls():
            buf.append(k if isinstance(k, str) else inline(_wrap(k)))
            continue
        flush()
        c = k.cls()
        if k.tag in ("script", "style", "button") or {"sg-stage", "sg-motion", "sg-motion-box", "chipbox"} & set(c):
            continue
        if "sg-spec" in c:
            out.append("Rules: " + squash(k.text()))
        elif k.tag in ("h1", "h2"):
            out.append("#" * depth + " " + squash(k.text()))
        elif k.tag in ("h3", "h4"):
            out.append("#" * (depth + 1) + " " + squash(k.text()))
        elif k.tag in ("p", "figcaption"):
            out.append(squash(inline(k)))
        elif k.tag == "table":
            out += table(k)
        elif k.tag in ("ul", "ol"):
            lis = [squash(inline(li)) for li in k.kids if isinstance(li, Node) and li.tag == "li"]
            out.append("\n".join(("%d. " % (i + 1) if k.tag == "ol" else "- ") + t for i, t in enumerate(lis)))
        elif k.tag == "pre":
            out.append("```html\n" + k.text().strip("\n") + "\n```")
        elif k.tag == "img":
            out.append("![%s](../html/%s)" % (k.attrs.get("alt", ""), k.attrs.get("src", "")))
        elif "sg-icons" in c:
            out += icons(k)
        elif "sg-swatches" in c:
            rows = ["| Token | Light · dark | Use |", "|---|---|---|"]
            for sw in k.find(lambda n: "meta" in n.cls()):
                name = squash("".join(x.text() for x in sw.kids if isinstance(x, Node) and x.tag == "b"))
                use = squash("".join(x.text() for x in sw.kids if isinstance(x, Node) and x.tag == "span"))
                vals = squash("".join(x for x in sw.kids if isinstance(x, str)))
                rows.append("| `%s` | %s | %s |" % (name, vals, use))
            out.append("\n".join(rows))
        elif "sg-type-row" in c:
            out.append("- " + squash(" · ".join(squash(inline(_wrap(x))) for x in k.kids if not isinstance(x, str) or x.strip())))
        else:
            out += blocks(k, depth)
    flush()
    return out


def _wrap(k):
    n = Node("x")
    n.kids = [k]
    return n


def main():
    tree = Tree()
    tree.feed(SRC.read_text(encoding="utf-8"))
    sections = list(tree.root.find(lambda n: n.tag == "section" and n.attrs.get("id")))
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    index = []
    for s in sections:
        sid = s.attrs["id"]
        head = next(s.find(lambda n: n.tag in ("h1", "h2")), None)
        title = squash(head.text()) if head else sid
        spec = next(s.find(lambda n: "sg-spec" in n.cls()), None)
        classes = []
        for td in s.find(lambda n: n.tag == "td"):
            first = next((x for x in td.kids if isinstance(x, Node)), None)
            if first is not None and first.tag == "code" and first.text().startswith(".") and first.text() not in classes:
                classes.append(squash(first.text()))
        body = "\n\n".join(blocks(s))
        while True:
            merged = re.sub(r"(^|\n)(- [^\n]*)\n\n(?=- )", r"\1\2\n", body)
            if merged == body:
                break
            body = merged
        (OUT / (sid + ".md")).write_text(body + "\n", encoding="utf-8")
        index.append("| [%s](%s.md) | %s | %s |" % (title, sid, squash(spec.text()) if spec else "", " ".join("`%s`" % c for c in classes)))
    readme = [
        "# Style guide, by section",
        "Generated from `docs/design/html/styleguide.html` by `docs/design/split-styleguide.py`. Do not edit these files; regenerate them.",
        "Read this index, then open only the sections the task needs. Each section has the rules, the class table, do and don't, and copyable markup. To see a component rendered, open `docs/design/html/styleguide.html` or `components.html` in a browser. The classes are defined in `docs/design/html/bb.css`, which wins over any export.",
        "\n".join(["| Section | Design rules | Classes |", "|---|---|---|"] + index),
    ]
    (OUT / "README.md").write_text("\n\n".join(readme) + "\n", encoding="utf-8")
    print("wrote %d sections to %s" % (len(sections), OUT))


if __name__ == "__main__":
    main()
