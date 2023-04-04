# Knative Scaling Scenarios

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

# Metrics for kind
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.6.3/components.yaml
kubectl patch -n kube-system deployment metrics-server --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
  
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
