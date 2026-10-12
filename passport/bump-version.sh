#!/bin/sh
# Run after editing the passport app so browsers pick up the new files right away.
cd "$(dirname "$0")" && V=$(date +%s)
sed -i "s#app.js?v=[0-9]*#app.js?v=$V#; s#app.css?v=[0-9]*#app.css?v=$V#" index.html
sed -i "s#store.js?v=[0-9]*#store.js?v=$V#; s#art.js?v=[0-9]*#art.js?v=$V#" app.js
sed -i "s#config.js?v=[0-9]*#config.js?v=$V#" store.js
echo "passport version $V"
