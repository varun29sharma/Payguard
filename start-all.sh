#!/bin/bash
# Starts the three PayGuard services. (The Python file in ml/ is an offline
# experiment — it is not a service and is not started here.)
#
#   8080  fraud-engine  (Java / Spring Boot) — scores every transaction
#   3000  server        (Node / Express)     — API, blocklist, alerts, sockets
#   5173  client        (React / Vite)       — analyst dashboard
#
# Build the fraud engine first if the jar does not exist:
#   cd fraud-engine && ./mvnw package -DskipTests && cd ..

set -e
cd "$(dirname "$0")"

echo "=== 1/3 Fraud engine (Java, port 8080) ==="
nohup java -jar fraud-engine/target/fraud-engine-0.0.1-SNAPSHOT.jar </dev/null > /tmp/payguard-engine.log 2>&1 &
echo "PID: $!"
sleep 5

echo "=== 2/3 Server (Node, port 3000) ==="
cd server && PORT=3000 nohup node index.js </dev/null > /tmp/payguard-server.log 2>&1 &
echo "PID: $!"
cd ..
sleep 3

echo "=== 3/3 Client (Vite, port 5173) ==="
cd client && nohup npm run dev </dev/null > /tmp/payguard-client.log 2>&1 &
echo "PID: $!"
cd ..
sleep 5

echo ""
echo "=== Status ==="
curl -sf http://localhost:8080/api/fraud/health >/dev/null && echo " fraud-engine OK  (:8080)" || echo " fraud-engine NOT RESPONDING — see /tmp/payguard-engine.log"
curl -sf http://localhost:3000/health >/dev/null && echo " server OK        (:3000)" || echo " server NOT RESPONDING — see /tmp/payguard-server.log"
curl -sf http://localhost:5173 >/dev/null && echo " client OK        (:5173)" || echo " client NOT RESPONDING — see /tmp/payguard-client.log"
echo ""
echo "Open http://localhost:5173"
