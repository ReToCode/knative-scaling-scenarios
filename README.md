# Knative Scaling Scenarios

## References
* [Upstream performance testing](https://github.com/knative/serving/issues/1625#issuecomment-511930023)
* [Upstream autoscale-go](https://github.com/knative/docs/tree/main/docs/serving/autoscaling/autoscale-go)
* [xk6-output-prometheus-remote](https://github.com/grafana/xk6-output-prometheus-remote)

## Prerequisites
* A kubernetes cluster
* Configured `kubectl` pointing to the cluster
* `Knative Serving` installed (HEAD: `ko apply -Rf config/core`)
* `net-kourier` installed (HEAD: `ko apply -Rf config`)

## Configuration
```bash
# Create random payload
head -c $( echo 10K | numfmt --from=iec ) </dev/urandom > payload/10K
head -c $( echo 100K | numfmt --from=iec ) </dev/urandom > payload/100K
head -c $( echo 1000K | numfmt --from=iec ) </dev/urandom > payload/1000K
```

### Kind
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
kubectl -n kourier-system patch hpa 3scale-kourier-gateway --patch '{"spec":{"minReplicas":10}}'
```

### OpenShift
```bash
# Install Operator and Knative Serving
oc apply -f openshift/serverless-operator.yaml
oc apply -f openshift/knative-serving.yaml
```

## Running test scenarios
### Environment
All the test scenarios share the following configuration
```bash
export DOMAIN=10.89.0.200.sslip.io
```

### Results
The results will be written to `results` and `results/heap`. The files are prefixed with the run-timestamp:
```bash
./run_tests.sh
Starting a new run for timestamp: 1680616481
Starting background process to monitor activator stats and profile memory
Running performance scenarios
Trying to stop the background jobs, if this fails please manually check [1]-  Running                 kubectl port-forward deployment/activator -n knative-serving 8008:8008 > /dev/null 2>&1 &
[2]+  Running                 while true; do
    kubectl top -n knative-serving pod --containers=true | grep activator >> results_local/"${date}"-activator-stats.log; curl http://localhost:8008/debug/pprof/heap > results_local/heap/"${date}"-$(date +%s)-activator-heap.out > /dev/null 2>&1; sleep 1;
done & and stop them
The results_local were written to the results_local folder

tree results_local            
results_local
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
go tool pprof -http=:8080 results_local/heap/xxx.out

# Running GC and compare
curl "http://localhost:8008/debug/pprof/heap" > out1
curl "http://localhost:8008/debug/pprof/heap?gc=1"

# wait a while and dump again
curl "http://localhost:8008/debug/pprof/heap" > out2

# Compare the dumps
go tool pprof -http=:8080 -diff_base out1 out2
```

### Visualizing results with prometheus/grafana
You need a running prometheus/grafana setup for this, locally you can run:
```bash
podman run -d --name prometheus --tz=local -p 9090:9090 prom/prometheus:v2.42.0 --web.enable-remote-write-receiver --enable-feature=native-histograms --config.file=/etc/prometheus/prometheus.yml
PROMETHEUS_IP=$(podman inspect prometheus | jq -r '.[].NetworkSettings.IPAddress')
sed "s/PROMETHEUSIP/${PROMETHEUS_IP}/g" visualization/datasource-template.yaml > visualization/datasources/datasource.yaml
podman run -d --name grafana --tz=local -v $PWD/visualization:/etc/grafana/provisioning/ -p 3000:3000 -e GF_AUTH_ANONYMOUS_ORG_ROLE=Admin -e GF_AUTH_ANONYMOUS_ENABLED=true -e GF_AUTH_BASIC_ENABLED=false grafana/grafana:9.4.3
```

```bash
# Enable reporting metrics to prometheus
export ENABLE_PROMETHEUS=true
export PROMETHEUS_IP=$(podman inspect prometheus | jq -r '.[].NetworkSettings.IPAddress')

./run_tests.sh <script>
```

Check the results at [http://localhost:3000](http://localhost:3000)

## Scenarios
### 1) Activator always in path + scale to the limit
**Description**
This scenario tests the scaling limit of one activator and checks resource usage of that pod.
* We have 20 already running KServices without any delays or sleeps
* We have only one activator (HPA is set to 1-1)
* The activator always stays in the path
* We start with $BASE_REQUEST_TARGET and double it every 30 seconds

**Preparation**
```bash
# Kind: Patch Activator HPA
kubectl -n knative-serving patch hpa activator --patch '{"spec":{"minReplicas":1, "maxReplicas": 1}}'

# OCP: Patch Activator HPA
oc apply -f openshift/knative-serving-one-activator.yaml
kubectl -n knative-serving patch hpa activator --patch '{"spec":{"minReplicas":1, "maxReplicas": 1}}'

# Create the KService
kubectl apply -f scenarios/activator-limit/services

# Wait for all services to be ready
kubectl wait kservice --for=condition=Ready -n default --all
```

**Running**
```bash
# Starting RPS, this will be doubled 10 times every 30 seconds 
export SERVICE_COUNT=1
export BASE_REQUEST_TARGET=10
./run_tests.sh scenarios/activator-limit/tests.js
```


### 2) Scaling with delays
**Description**
We have three types of KServices:
* No startup delay
* 5s startup delay
* 15s startup delay
* We have only one activator (HPA is set to 1-1) 
* All have target of 10 RPS, so if we send 50 requests, activator will scale to 5 instances
 
This scenario consists of batch requests per VU with the following matrix
* Amount of target KServices (e.g. 1-15)
* Startup delay: (no, 5s, 15s) --> random value
* Slow responses: (none, 10ms, 100ms, 1000ms, 5000ms) --> random value
* Payload: (none, 10K, 100K, 500K) --> random value

**Preparation**
```bash
# Kind: Patch Activator HPA
kubectl -n knative-serving patch hpa activator --patch '{"spec":{"minReplicas":1, "maxReplicas": 1}}'

# OCP: Patch Activator HPA
// TODO

# Create the requested amount of KServices
export SERVICE_COUNT=15
for (( i = 0; i < SERVICE_COUNT; i++ )); do
    cat scenarios/scaling/services/* | sed -e "s/COUNT/${i}/g" | kubectl apply -f -
done

# Wait for all services to be ready
kubectl wait kservice --for=condition=Ready -n default --all
```

**Running**
```bash
# This targets k6's Virtual Users (https://k6.io/docs/get-started/running-k6/)
# each VU does multiple requests, depending on the scenario. VUs are essentially parallel while(true) loops.
# Tests will start with this base VU value and increase the load over time
export BASE_REQUEST_TARGET=30
export SERVICE_COUNT=15 # same as above

./run_tests.sh scenarios/scaling/tests.js
```


## Cleanup
```bash
# Kind
kubectl -n knative-serving patch hpa activator --patch '{"spec":{"minReplicas":1, "maxReplicas": 20}}'

# OCP
oc apply -f openshift/knative-serving-default.yaml

# Cleanup KServices
kubectl delete ksvc --all -A
```
