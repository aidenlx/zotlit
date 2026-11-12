#!/bin/sh
# Render one variant in four states at three widths; report errors and overflow.
# Usage: ./check.sh <KEY>   (screenshots land in shots/<KEY>-<state>-<width>.png)
cd "$(dirname "$0")"
mkdir -p shots
export AGENT_BROWSER_SESSION="learn-check-$1"
KEY=$1
for W in 1440 700 390; do
  agent-browser set viewport $W 900 >/dev/null
  agent-browser open "http://localhost:4841/prototype-learn.html?t=$(date +%s)#$KEY" >/dev/null
  agent-browser wait --load networkidle >/dev/null
  sleep 3
  for S in "hub:setProto({view:'hub',step:0,done:[]})" "open:openLesson(1,0)" "step3:openLesson(1,3)" "end:openLesson(1,7)"; do
    NAME=${S%%:*}
    ACT=${S#*:}
    # The shared section exposes the store helpers on window.__proto.
    agent-browser eval "window.__proto.$ACT" >/dev/null
    sleep 1.2
    agent-browser screenshot "$PWD/shots/$KEY-$NAME-$W.png" >/dev/null
    agent-browser eval "(() => { const o = document.documentElement.scrollWidth - innerWidth; return '$KEY $NAME $W overflow=' + o + ' h1=' + document.querySelectorAll('h1').length; })()"
  done
done
agent-browser errors 2>/dev/null | head -20
agent-browser close >/dev/null
