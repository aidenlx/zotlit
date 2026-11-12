# /learn tutorial prototype (round 1)

A throwaway prototype: five shapes for the ZotLit tutorial (course page and lesson), switchable in one page. The verdict and the question it settled are in the comment at the top of `prototype-learn.html`.

To run it from this folder:

```sh
ln -s ../../apps/docs/public/img/learn media
mkdir frames
for f in media/*/step-*.mp4; do d=$(basename "$(dirname "$f")"); s=$(basename "$f" .mp4); ffmpeg -v error -sseof -0.15 -i "$f" -frames:v 1 -q:v 3 "frames/$d-$s.jpg"; done
python3 -m http.server 4841   # open http://localhost:4841/prototype-learn.html
```

The lesson data comes from `apps/docs/content/learn/*.mdx` by way of `extract-lessons.py`. `shell.html` plus `lessons.json` builds the base page (`build-shell.py`), and the prototype skill's `assemble.py` spliced the switcher and the five variants into `prototype-learn.html`, which holds them all.
