import http from 'k6/http';
import {check, sleep} from 'k6';

const clusterDomain = __ENV.DOMAIN;
const isOCP = clusterDomain.includes("openshift.com")
const serviceName = 'autoscale-fixed-amount';
const requestTarget = __ENV.BASE_REQUEST_TARGET;

export const options = {
    stages: [
        { target: __ENV.BASE_REQUEST_TARGET, duration: '30s' },
        { target: __ENV.BASE_REQUEST_TARGET * 2, duration: '30s' },
        { target: __ENV.BASE_REQUEST_TARGET * 4, duration: '30s' },
        { target: __ENV.BASE_REQUEST_TARGET * 8, duration: '30s' },
        { target: __ENV.BASE_REQUEST_TARGET * 16, duration: '30s' },
        { target: __ENV.BASE_REQUEST_TARGET * 32, duration: '30s' },
        { target: __ENV.BASE_REQUEST_TARGET * 64, duration: '30s' },
        { target: __ENV.BASE_REQUEST_TARGET * 128, duration: '30s' },
        { target: __ENV.BASE_REQUEST_TARGET * 256, duration: '30s' },
        { target: __ENV.BASE_REQUEST_TARGET * 512, duration: '30s' },
    ],
    noConnectionReuse: true,
    userAgent: 'k6.io/1.0',
    insecureSkipTLSVerify: isOCP,
};


export default function () {
    const requests = [{
        method: 'POST',
        url: `${isOCP ? 'https://' : 'http://'}${serviceName}${isOCP ? "-default." : ".default."}${clusterDomain}`
    }];

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
