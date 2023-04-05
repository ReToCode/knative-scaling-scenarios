#!/usr/bin/env bash

mkdir -p results_local/heap
date=$(date +%s)
script=$1

echo "Starting a new run for timestamp: ${date}"
echo "BASE_REQUEST_TARGET: $BASE_REQUEST_TARGET" >> results_local/"${date}-config"
echo "SERVICE_COUNT: $SERVICE_COUNT" >> results_local/"${date}-config"

echo "Starting background process to monitor activator stats and profile memory"
kubectl port-forward deployment/activator -n knative-serving 8008:8008 > /dev/null 2>&1 &

while true;
  do
  kubectl top -n knative-serving pod --containers=true | grep activator >> results_local/"${date}"-activator-stats.log
  curl http://localhost:8008/debug/pprof/heap > results_local/heap/"${date}"-$(date +%s)-activator-heap.out 2>/dev/null
  sleep 1
done &

echo "Running performance scenarios"
if [[ -z $ENABLE_PROMETHEUS ]]; then
  echo "Reporting results to a file in `results_local` folder"
  podman run --rm -v $PWD:/code -i grafana/k6 -e DOMAIN=$DOMAIN -e DATE=$date -e BASE_REQUEST_TARGET=$BASE_REQUEST_TARGET -e SERVICE_COUNT=$SERVICE_COUNT run /code/$script > results_local/"${date}"-k6-stats.log 2>&1
else
  echo "Reporting results to prometheus/grafana"
  podman run --rm -v $PWD:/code -p 6565:6565 -i grafana/k6 -e K6_PROMETHEUS_RW_SERVER_URL=http://$PROMETHEUS_IP:9090/api/v1/write -e K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true -e K6_OUT=experimental-prometheus-rw -e DOMAIN=$DOMAIN -e DATE=$date -e BASE_REQUEST_TARGET=$BASE_REQUEST_TARGET -e SERVICE_COUNT=$SERVICE_COUNT run /code/$script --tag testid=$date > results_local/"${date}"-k6-stats.log 2>&1
fi

echo "Trying to stop the background jobs, if this fails please manually check `jobs` and stop them"
kill %1
kill %2

echo "The results were written to the results folder"