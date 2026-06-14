# Incident Runbook — Node.js Observability Stack

## Table of Contents

- [Alert: HighErrorRate](#alert-higherrorrate)
- [Failure Mode 1: Application Bug](#failure-mode-1-application-bug)
- [Failure Mode 2: Dependency Failure](#failure-mode-2-dependency-failure)
- [Failure Mode 3: Traffic Spike](#failure-mode-3-traffic-spike)
- [Escalation Matrix](#escalation-matrix)

---

## Alert: HighErrorRate

| Field       | Value                                      |
| ----------- | ------------------------------------------ |
| **Name**    | HighErrorRate                              |
| **Severity**| Critical                                   |
| **Condition** | Error rate > 2% sustained for 1 minute  |

### Meaning

The ratio of HTTP errors (`http_errors_total`) to total requests (`http_requests_total`) has exceeded **2%** for at least 1 minute. This indicates a significant portion of user-facing requests are failing.

### PromQL Expression

```promql
(
  sum(rate(http_errors_total[1m]))
  /
  sum(rate(http_requests_total[1m]))
) * 100 > 2
```

### Immediate Actions

1. Open Grafana dashboard at [http://localhost:3001](http://localhost:3001)
2. Check the **Error Rate %** panel for the current error percentage
3. Check application logs: `docker logs observability-app --tail 100`
4. Identify the root cause using the failure modes below

---

## Failure Mode 1: Application Bug

### Description

A code-level bug is causing HTTP 500 responses. This is the most common cause of the HighErrorRate alert.

### Symptoms

- Elevated HTTP 500 responses in the **Error Rate %** Grafana panel
- Structured error logs appearing in the application container output
- `http_errors_total` counter increasing steadily
- Errors concentrated on specific routes

### Diagnosis Steps

1. **Check application logs for error details:**

   ```bash
   docker logs observability-app --tail 200 | grep '"level":"error"'
   ```

2. **Identify the failing route:**

   ```bash
   docker logs observability-app --tail 200 | grep '"statusCode":500'
   ```

3. **Check the /fail endpoint directly:**

   ```bash
   curl -s http://localhost:3000/fail | jq .
   ```

4. **Verify metrics for error breakdown:**

   ```bash
   curl -s http://localhost:3000/metrics | grep http_errors_total
   ```

5. **Check Prometheus for route-level error rate:**

   Open [http://localhost:9090](http://localhost:9090) and query:

   ```promql
   rate(http_errors_total[5m])
   ```

### Recovery Actions

1. **Identify the buggy code path** from the structured error logs (check `route`, `statusCode`, `error` fields)
2. **Fix the application code** and redeploy:

   ```bash
   docker-compose up --build app
   ```

3. **Verify recovery** — confirm the error rate drops below 2% on the Grafana dashboard
4. **Post-incident:** Add regression tests covering the failure scenario

---

## Failure Mode 2: Dependency Failure

### Description

An upstream service or infrastructure dependency (database, cache, external API) is unavailable or degraded, causing the application to return errors.

### Symptoms

- Increased error rate across **multiple** routes (not just one)
- Application logs show connection timeouts or refused connections
- Errors appear suddenly (not gradually increasing)
- Container health checks may start failing

### Diagnosis Steps

1. **Check all container statuses:**

   ```bash
   docker-compose ps
   ```

2. **Check container resource usage:**

   ```bash
   docker stats --no-stream
   ```

3. **Check application logs for dependency errors:**

   ```bash
   docker logs observability-app --tail 200 | grep -i "ECONNREFUSED\|timeout\|EHOSTUNREACH"
   ```

4. **Check Prometheus targets are healthy:**

   Open [http://localhost:9090/targets](http://localhost:9090/targets)

5. **Verify network connectivity between containers:**

   ```bash
   docker exec observability-app wget -qO- http://prometheus:9090/-/healthy
   ```

### Recovery Actions

1. **Restart the failed dependency:**

   ```bash
   docker-compose restart <service-name>
   ```

2. **If a container is in a crash loop**, check its logs:

   ```bash
   docker logs <container-name> --tail 100
   ```

3. **Rebuild if necessary:**

   ```bash
   docker-compose up --build
   ```

4. **Verify recovery** — check that all containers show `Up (healthy)` in `docker-compose ps`
5. **Post-incident:** Add health checks and circuit breakers for external dependencies

---

## Failure Mode 3: Traffic Spike

### Description

An unusual surge in traffic is overwhelming the application, causing increased latency and potential errors due to resource exhaustion.

### Symptoms

- Significantly increased request volume in the **Requests Per Second** Grafana panel
- Elevated latency in the **Request Latency** panel (especially p99)
- Container CPU/memory usage approaching limits
- Possible HTTP 503 (Service Unavailable) responses

### Diagnosis Steps

1. **Check current request rate in Grafana:**

   Open [http://localhost:3001](http://localhost:3001) and look at the **Requests Per Second** panel

2. **Query Prometheus for request rate:**

   ```promql
   sum(rate(http_requests_total[1m]))
   ```

3. **Check latency percentiles:**

   ```promql
   histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[1m])))
   ```

4. **Check container resource usage:**

   ```bash
   docker stats --no-stream
   ```

5. **Check for abnormal traffic patterns:**

   ```bash
   docker logs observability-app --tail 500 | grep '"method"' | sort | uniq -c | sort -rn
   ```

### Recovery Actions

1. **If traffic is legitimate:**
   - Scale the application horizontally (add replicas in Docker Compose)
   - Increase container resource limits
   - Enable rate limiting in the application or a reverse proxy

2. **If traffic is malicious (DDoS):**
   - Enable rate limiting immediately
   - Block offending IPs at the network/proxy level
   - Consider adding a WAF (Web Application Firewall)

3. **Quick scale-up:**

   ```bash
   docker-compose up --scale app=3
   ```

4. **Verify recovery** — check that latency returns to normal on the Grafana dashboard
5. **Post-incident:** Implement auto-scaling, rate limiting, and traffic analysis

---

## Escalation Matrix

| Severity | Response Time | Escalation                                |
| -------- | ------------- | ----------------------------------------- |
| Critical | 5 minutes     | On-call engineer → Team lead → SRE manager |
| Warning  | 30 minutes    | On-call engineer → Team lead               |
| Info     | Next business day | Ticket created for review              |
