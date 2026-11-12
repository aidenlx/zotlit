#!/bin/sh
# Edge states per variant at 1440 and 700; prints overflow, h1 count, broken media and errors.
# Usage: ./check2.sh <KEY>
cd "$(dirname "$0")"
mkdir -p shots
export AGENT_BROWSER_SESSION="learn-check2-$1"
KEY=$1
for W in 1440 700; do
  agent-browser set viewport $W 900 >/dev/null
  agent-browser open "http://localhost:4841/prototype-learn.html?t=$(date +%s)#$KEY" >/dev/null
  agent-browser wait --load networkidle >/dev/null
  sleep 3
  for S in "back:setProto({view:'hub',step:0,done:[1]})" "l2s3:openLesson(2,3)" "l4s5:openLesson(4,5)" "l4end:openLesson(4,6)" "l6s6:openLesson(6,6)"; do
    NAME=${S%%:*}
    ACT=${S#*:}
    agent-browser eval "window.__proto.$ACT" >/dev/null
    sleep 1.5
    agent-browser screenshot "$PWD/shots/$KEY-$NAME-$W.png" >/dev/null
    agent-browser eval "(() => { const o = document.documentElement.scrollWidth - innerWidth; const bad = [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src.split('/').pop()); return '$KEY $NAME $W overflow=' + o + ' h1=' + document.querySelectorAll('h1').length + ' broken=' + (bad.join(',') || 'none') + ' raw=' + /\*\*|query_view|<UiLabel/.test(document.body.innerText); })()"
  done
done
echo "errors:"
agent-browser errors
agent-browser close >/dev/null
