#!/bin/bash
# Starts every PayGuard service in dependency order.
#
#   8080  fraud-engine  (Java/Spring)    — rules scoring + Phase 1 logistic model
#   8000  ml-service    (FastAPI)       — Phase 2 GBM scoring + Phase 3 rule checker
#   3000  server        (Node/Express)  — API, orchestration, shadow-mode fan-out
#   5000  client        (Vite/React)    — dashboard
#
# The ML sidecar is started BEFORE the Node server on purpose: Node calls it in
# parallel with the Java engine on every transaction, and it serves the rule
# consistency analysis. Starting it second would mean a window of `fallback`
# records at boot. Nothing depends on it being up, though — every caller
# degrades to a named fallback rather than failing.

# Kill any existing processes on our ports
for port in 8000 8080 3000 5000; do
  pid=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$pid" ]; then
    kill $pid 2>/dev/null
    sleep 1
  fi
done

ML_PYTHON=""
for candidate in ml-service/.venv/bin/python ml/.venv/bin/python python3; do
  if [ -x "$candidate" ] || command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
      ML_PYTHON="$candidate"
      break
    fi
  fi
done

if [ -n "$ML_PYTHON" ]; then
  echo "=== Starting ML Service (FastAPI, port 8000) using $ML_PYTHON ==="
  cd ml-service
  nohup "$(cd .. && pwd)/$ML_PYTHON" -m uvicorn app:app --port 8000 </dev/null > /tmp/ml-service.log 2>&1 &
  echo "ML Service PID: $!"
  cd ..
else
  echo "=== ML Service SKIPPED — no interpreter with fastapi+uvicorn ==="
  echo "    cd ml-service && python3 -m venv --system-site-packages .venv && ./.venv/bin/pip install -r requirements.txt"
  echo "    Scoring and rule checks will report 'fallback' / 'unavailable' until it runs."
fi

echo "=== Starting Fraud Engine (Java, port 8080) ==="
nohup java -jar fraud-engine/target/fraud-engine-0.0.1-SNAPSHOT.jar </dev/null > /tmp/fraud-engine.log 2>&1 &
echo "Fraud Engine PID: $!"

sleep 5

echo "=== Starting Backend Server (Node.js, port 3000) ==="
cd server
PORT=3000 nohup node index.js </dev/null > /tmp/server.log 2>&1 &
SERVER_PID=$!
cd ..
echo "Server PID: $SERVER_PID"

sleep 3

echo "=== Starting Frontend (Vite, port 5000) ==="
cd client
nohup npx vite --port 5000 --strictPort </dev/null > /tmp/client.log 2>&1 &
CLIENT_PID=$!
cd ..
echo "Client PID: $CLIENT_PID"

sleep 5

echo ""
echo "=== Status Check ==="
curl -sf http://localhost:8000/health >/dev/null && echo " [ml-service OK on :8000]" || echo " [ml-service NOT RESPONDING on :8000]"
curl -sf http://localhost:8080/api/fraud/health && echo " [fraud-engine OK]" || echo " [fraud-engine NOT RESPONDING]"
curl -sf http://localhost:3000/api/system/health && echo " [server OK]" || echo " [server NOT RESPONDING]"
curl -sf http://localhost:5000 > /dev/null && echo " [client OK on :5000]" || echo " [client NOT RESPONDING on :5000]"
echo ""
echo "=== All services started ==="
