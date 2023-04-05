import http from 'k6/http';
import {check, sleep} from 'k6';
import {Counter} from 'k6/metrics';
import {randomItem} from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

const clusterDomain = __ENV.DOMAIN;
const isOCP = clusterDomain.includes("openshift.com")
const serviceName = 'autoscale-delay';

const smallPayload = open('../payload/10K');
const mediumPayload = open('../payload/100K');
const largePayload = open('../payload/1000K');
const requestTarget = __ENV.BASE_REQUEST_TARGET;

export const options = {
    stages: [
        {duration: '30s', target: requestTarget},
        {duration: '30s', target: requestTarget * 2},
        {duration: '30s', target: requestTarget * 4},
        {duration: '30s', target: requestTarget * 6},
        {duration: '30s', target: requestTarget * 8},
        {duration: '30s', target: requestTarget * 10},
    ],
    noConnectionReuse: true,
    userAgent: 'k6.io/1.0',
    insecureSkipTLSVerify: isOCP,
};

const startupDelays = ['0s', '5s', '15s'];
const sleepAmounts = [0, 10, 100, 1000, 5000];
const payloads = [{name: "No payload", payload: {}},
    {name: "Small", payload: smallPayload},
    {name: "Medium", payload: mediumPayload},
    {name: "Large", payload: largePayload}];

const payloadCounters = payloads.map(p => new Counter(`payload-${p.name}`));
const delayCounters = startupDelays.map(d => new Counter(`delay-${d}`));
const sleepCounters = sleepAmounts.map(s => new Counter(`sleep-${s}`));

/*
We have three types of KServices:
- no delay
- 5s startup delay
- 15s startup delay
All have target of 10 RPS, so if we send 50 requests, activator will scale to 5 instances
 */
export default function () {
    /* This scenario consists of batch requests with the following matrix
    - Amount of target KServices (e.g. 1-5)
    - Startup delay: (no, 5s, 15s) --> random value
    - Slow responses: (none, 10ms, 100ms, 1000ms, 5000ms) --> random value
    - Payload: (none, 10K, 100K, 500K) --> random value
     */
    const serviceCount = __ENV.SERVICE_COUNT;

    const requests = [];

    for (let i = 0; i < serviceCount; i++) {
        const delay = randomItem(startupDelays);
        const sleep = randomItem(sleepAmounts);
        const payload = randomItem(payloads);

        delayCounters[startupDelays.indexOf(delay)].add(1);
        sleepCounters[sleepAmounts.indexOf(sleep)].add(1);

        const payloadIndex = payloads.findIndex(p => p.name === payload.name);
        payloadCounters[payloadIndex].add(1);

        requests.push({
            method: 'POST',
            url: `${isOCP ? 'https://' : 'http://'}${serviceName}-${delay}-${i}${isOCP ? "-default." : ".default."}${clusterDomain}?sleep=${sleep}`,
            payload: payload.payload
        })
    }

    callAndCheck(requests);

    sleep(Math.random() * 2);
}

function callAndCheck(requests) {
    const responses = http.batch(requests);
    for (const response of responses) {
        check(response, {
            'is status 200': (r) => r.status === 200,
        });
    }
}
