# Knative Scaling Scenarios

## References
* [Upstream performance testing](https://github.com/knative/serving/issues/1625#issuecomment-511930023)
* [Upstream autoscale-go](https://github.com/knative/docs/tree/main/docs/serving/autoscaling/autoscale-go)

## Prerequisites
* A kubernetes cluster
* Configured `kubectl` pointing to the cluster
* `Knative Serving` installed (HEAD: `ko apply -Rf config/core`)
* `net-kourier` installed (HEAD: `ko apply -Rf config`)

## Configuration
```bash
# Knative config
kubectl patch configmap/config-network \
  --namespace knative-serving \
  --type merge \
  --patch '{"data":{"ingress-class":"kourier.ingress.networking.knative.dev"}}'
kubectl patch cm/config-features -n knative-serving -p '{"data":{"'kubernetes.podspec-init-containers'":"'Enabled'"}}'
kubectl patch cm/config-autoscaler -n knative-serving -p '{"data":{"'allow-zero-initial-scale'":"'true'"}}'
kubectl patch cm/config-observability -n knative-serving -p '{"data":{"'profiling.enable'":"'true'"}}'

# Metrics for kind
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.6.3/components.yaml
kubectl patch -n kube-system deployment metrics-server --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

# Make sure kourier is scaled enough to not be the bottleneck
kubectl -n kourier-system patch hpa 3scale-kourier-gateway --patch '{"spec":{"minReplicas":5}}'

# Create random payload
head -c $( echo 10K | numfmt --from=iec ) </dev/urandom > payload/10K
head -c $( echo 100K | numfmt --from=iec ) </dev/urandom > payload/100K
head -c $( echo 1000K | numfmt --from=iec ) </dev/urandom > payload/1000K
```

## Running tests
```bash
export DOMAIN=10.89.0.200.sslip.io
export SERVICE_COUNT=15
export BASE_REQUEST_TARGET=30 # The tests will start with this amount, then increase by *2, *4 and *6

# Create the requested amount of KServices
for (( i = 0; i < SERVICE_COUNT; i++ )); do
    cat services/* | sed -e "s/COUNT/${i}/g" | kubectl apply -f -
done

# Wait for all services to be ready
kubectl wait kservice --for=condition=Ready -n default --all

# Run the tests
./run_tests.sh
```

## Results
The results will be written to `results` and `results/heap`. The files are prefixed with the run-timestamp:
```bash
./run_tests.sh
Starting a new run for timestamp: 1680616481
Starting background process to monitor activator stats and profile memory
Running performance scenarios
Trying to stop the background jobs, if this fails please manually check [1]-  Running                 kubectl port-forward deployment/activator -n knative-serving 8008:8008 > /dev/null 2>&1 &
[2]+  Running                 while true; do
    kubectl top -n knative-serving pod --containers=true | grep activator >> results/"${date}"-activator-stats.log; curl http://localhost:8008/debug/pprof/heap > results/heap/"${date}"-$(date +%s)-activator-heap.out > /dev/null 2>&1; sleep 1;
done & and stop them
The results were written to the results folder

tree results            
results
├── 1680616481-activator-stats.log
├── 1680616481-config
├── 1680616481-k6s-stats.log
└── heap
    ├── 1680616481-1680616481-activator-heap.out
    ├── 1680616481-1680616482-activator-heap.out
    ├── 1680616481-1680616483-activator-heap.out
```

### Checking heap dumps
```bash
go tool pprof -http=:8080 results/heap/xxx.out

# Running GC and compare
curl "http://localhost:8008/debug/pprof/heap" > out1
curl "http://localhost:8008/debug/pprof/heap?gc=1"

# wait a while and dump again
curl "http://localhost:8008/debug/pprof/heap" > out2

# Compare the dumps
go tool pprof -http=:8080 -diff_base out1 out2
```

### Checking results with prometheus/grafana
TODO: https://github.com/javaducky/k6-office-hours-047
```bash
# Enable dashboard run
export ENABLE_DASHBOARD=true

# Same as above
./run_tests.sh
```
