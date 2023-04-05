#!/usr/bin/env bash

mkdir -p results/heap
date=$(date +%s)

echo "Starting a new run for timestamp: ${date}"
echo "BASE_REQUEST_TARGET: $BASE_REQUEST_TARGET" >> results/"${date}-config"
echo "SERVICE_COUNT: $SERVICE_COUNT" >> results/"${date}-config"

echo "Starting background process to monitor activator stats and profile memory"
kubectl port-forward deployment/activator -n knative-serving 8008:8008 > /dev/null 2>&1 &

while true;
  do
  kubectl top -n knative-serving pod --containers=true | grep activator >> results/"${date}"-activator-stats.log
  curl http://localhost:8008/debug/pprof/heap > results/heap/"${date}"-$(date +%s)-activator-heap.out 2>/dev/null
  sleep 1
done &

echo "Running performance scenarios"
if [[ -z $ENABLE_DASHBOARD ]]; then
  podman run --rm -v $PWD:/code -i grafana/k6 -e DOMAIN=$DOMAIN -e DATE=$date -e BASE_REQUEST_TARGET=$BASE_REQUEST_TARGET -e SERVICE_COUNT=$SERVICE_COUNT run /code/tests/tests.js > results/"${date}"-k6-stats.log 2>&1
else
  echo "Dashboard enabled"
fi

echo "Trying to stop the background jobs, if this fails please manually check `jobs` and stop them"
kill %1
kill %2

echo "The results were written to the results folder"