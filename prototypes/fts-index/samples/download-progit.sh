#!/usr/bin/env bash
# Download Pro Git PDFs for larger benches. License: CC BY-NC-SA 3.0
# https://git-scm.com/book/en/v2
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
curl -fsSL -o progit-en.pdf "https://github.com/progit/progit2/releases/download/2.1.434/progit.pdf" \
  || curl -fsSL -o progit-en.pdf "https://media.githubusercontent.com/media/progit/progit2/master/progit.pdf"
# Chinese translation (CC BY-NC-SA) — adjust URL if release moves
echo "Downloaded EN to $DIR/progit-en.pdf"
echo "For ZH, see https://github.com/progit/progit2-zh (CC BY-NC-SA). Do not commit the PDFs."
