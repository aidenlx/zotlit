# Extract the six /learn lessons into lessons.json for the tutorial prototype.
# Run: uv run --with pyyaml python extract-lessons.py
import json
import re
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
DOCS = HERE.parents[1]
MESSAGES = json.loads((DOCS.parents[1] / "messages/en.json").read_text())


def resolve_ui(text: str) -> str:
    # <UiLabel name={m.key()} /> -> **value**, m.key() bare -> value
    def label(mt):
        key = mt.group(1)
        val = MESSAGES.get(key, key)
        if isinstance(val, dict):
            val = key
        return f"**{val}**"

    def label_args(mt):
        key, args = mt.group(1), mt.group(2)
        val = MESSAGES.get(key, key)
        if isinstance(val, list):  # plural variants: take the "other" form
            val = next(
                (v for k, v in val[0]["match"].items() if k.endswith("=*")), key
            )
        if not isinstance(val, str):
            return f"**{key}**"
        for name, raw in re.findall(r"(\w+)\s*:\s*(\"[^\"]*\"|\d+)", args):
            val = val.replace("{" + name + "}", raw.strip('"'))
        return f"**{val}**"

    text = re.sub(r"<UiLabel\s+name=\{m\.(\w+)\(\)\}\s*/>", label, text)
    text = re.sub(r"<UiLabel\s+name=\{m\.(\w+)\((\{.*?\})\)\}\s*/>", label_args, text, flags=re.S)
    text = re.sub(r"<Command\s+inline\s+name=\{m\.(\w+)\(\)\}\s*/>", label, text)
    text = re.sub(r"\{\" \"\}", " ", text)
    return text


def clean(text: str) -> str:
    text = resolve_ui(text)
    text = re.sub(r"</?>", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse(path: Path):
    raw = path.read_text()
    _, fm, body = raw.split("---", 2)
    data = yaml.safe_load(fm)
    steps = []
    for mt in re.finditer(r"<Step n=\{(\d+)\}>(.*?)</Step>", body, re.S):
        n = int(mt.group(1))
        inner = mt.group(2)
        check = re.search(r"<Check>(.*?)</Check>", inner, re.S)
        fixes = []
        for f in re.finditer(
            r"<Fix\s+title=(?:\"([^\"]*)\"|\{(.*?)\})\s*>(.*?)</Fix>", inner, re.S
        ):
            title = f.group(1) or f.group(2) or ""
            fixes.append({"title": clean(title), "body": clean(f.group(3))})
        figure = re.search(r"<Figure>(.*?)</Figure>", inner, re.S)
        action = re.sub(r"<(Check|Fix|Figure)[\s\S]*?</\1>", "", inner)
        action = re.sub(r"<Fix[\s\S]*?</Fix>", "", action)
        meta = data["steps"][n - 1]
        steps.append(
            {
                "n": n,
                "name": meta["name"],
                "title": meta["title"],
                "alt": meta["alt"],
                "action": clean(action),
                "check": clean(check.group(1)) if check else "",
                "fixes": fixes,
                "figure": figure.group(1).strip() if figure else None,
            }
        )
    return {
        "slug": path.stem,
        "lesson": data["lesson"],
        "title": data["title"],
        "description": data["description"],
        "minutes": data["minutes"],
        "media": data["media"],
        "lede": data.get("lede"),
        "note": data.get("note"),
        "needs": data.get("needs"),
        "end": data.get("end"),
        "steps": steps,
    }


lessons = sorted(
    (parse(p) for p in (DOCS / "content/learn").glob("*.mdx")),
    key=lambda l: l["lesson"],
)
out = HERE / "lessons.json"
out.write_text(json.dumps(lessons, indent=1, ensure_ascii=False))
for l in lessons:
    print(l["lesson"], l["slug"], len(l["steps"]), "steps")
