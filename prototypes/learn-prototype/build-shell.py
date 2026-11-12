# Inline lessons.json into shell.html -> prototype-learn.html (round 1 base).
from pathlib import Path

here = Path(__file__).resolve().parent
html = (here / "shell.html").read_text()
data = (here / "lessons.json").read_text().replace("</", "<\\/")
(here / "prototype-learn.html").write_text(html.replace("__LESSONS__", data))
print("wrote prototype-learn.html")
