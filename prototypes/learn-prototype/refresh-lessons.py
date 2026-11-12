# Replace only the lessons JSON block inside prototype-learn.html (variants stay).
import re
from pathlib import Path

here = Path(__file__).resolve().parent
page = here / "prototype-learn.html"
data = (here / "lessons.json").read_text().replace("</", "<\\/")
html = page.read_text()
html, n = re.subn(
    r'(<script type="application/json" id="lessons">).*?(</script>)',
    lambda m: m.group(1) + data + m.group(2),
    html,
    count=1,
    flags=re.S,
)
page.write_text(html)
print("lessons block replaced:", n)
