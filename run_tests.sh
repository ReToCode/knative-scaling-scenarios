#!/usr/bin/env bash

date=$(date +%s)

echo "Starting a new run for timestamp: ${date}"
echo "BASE_REQUEST_TARGET: $BASE_REQUEST_TARGET" >> results/"${date}-config"
echo "SERVICE_COUNT: $SERVICE_COUNT" >> results/"${date}-config"

echo "Starting background process to monitor activator stats"

while true;
  do
  kubectl top -n knative-serving pod --containers=true | grep activator >> results/"${date}"-activator-stats.log
  sleep 1
done &

echo "Running performance scenarios"
podman run --rm -v $PWD:/code -i grafana/k6 -e DOMAIN=$DOMAIN -e BASE_REQUEST_TARGET=$BASE_REQUEST_TARGET -e SERVICE_COUNT=$SERVICE_COUNT run /code/tests/tests.js > results/"${date}"-k6s-stats.log 2>&1

echo "Trying to stop the background job, if this fails please manually check `jobs` and stop it"
kill %1

echo "The results were written to the results folder"