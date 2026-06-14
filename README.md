# Node.js Observability Stack

A complete, production-style observability system for a Node.js Express service. Features structured logging (Winston), metrics collection (Prometheus), dashboards (Grafana), and alerting (Alertmanager) — all containerized with Docker Compose.

---

## Architecture

```
                                     ┌─────────────────┐
                                     │   Alertmanager   │
                                     │   :9093          │
                                     └────────▲─────────┘
                                              │ alerts
┌──────────┐    scrape :3000/metrics ┌────────┴─────────┐    datasource    ┌──────────┐
│  Client   │───────────────────────▶│   Prometheus      │◀────────────────│  Grafana  │
│ (curl/    │        HTTP            │   :9090           │                 │  :3001    │
│  browser) │◀──────────────────────▶├───────────────────┤                 └──────────┘
└──────────┘         :3000           │  alert_rules.yml  │
     │                               └───────────────────┘
     │
     ▼
┌──────────────────────────────────┐
│       Node.js Express App        │
│            :3000                 │
├──────────────────────────────────┤
│  GET /        → Success (200)    │
│  GET /fail    → Error (500)      │
│  GET /metrics → Prometheus       │
├──────────────────────────────────┤
│  Winston (structured JSON logs)  │
│  prom-client (metrics)           │
└──────────────────────────────────┘
```

### Data Flow

1. The **Node.js app** exposes business endpoints (`/`, `/fail`) and a metrics endpoint (`/metrics`)
2. **Prometheus** scrapes `/metrics` every 15 seconds and evaluates alert rules
3. When the error rate exceeds 2%, Prometheus fires the **HighErrorRate** alert to **Alertmanager**
4. **Grafana** queries Prometheus to render real-time dashboards
5. **Winston** outputs structured JSON logs to stdout (viewable via `docker logs`)

---

## Repository Structure

```
.
├── app.js                              # Express application
├── instrumentation.js                  # Winston logger + Prometheus metrics
├── package.json                        # Node.js dependencies
├── Dockerfile                          # Multi-stage Docker build
├── docker-compose.yml                  # Full stack orchestration
├── README.md                           # This file
├── runbook.md                          # Incident response runbook
├── .gitignore                          # Git ignore rules
│
├── prometheus/
│   ├── prometheus.yml                  # Prometheus configuration
│   └── alert_rules.yml                 # Alert rules (HighErrorRate)
│
├── alertmanager/
│   └── alertmanager.yml                # Alertmanager configuration
│
└── grafana/
    ├── dashboards/
    │   └── node-dashboard.json         # Pre-provisioned Grafana dashboard
    └── provisioning/
        ├── datasources/
        │   └── datasource.yml          # Auto-configure Prometheus datasource
        └── dashboards/
            └── dashboard.yml           # Auto-load dashboards from disk
```

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v20+ recommended)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+ recommended)
- Ports **3000**, **3001**, **9090**, **9093** must be available

---

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/hardikkaurani/nodejs-observability-stack.git
cd nodejs-observability-stack
```

### 2. Start the Entire Stack

```bash
docker-compose up --build
```

This single command builds the Node.js application image and starts all four services:

| Service       | URL                          | Purpose                |
| ------------- | ---------------------------- | ---------------------- |
| App           | http://localhost:3000         | Node.js application    |
| Prometheus    | http://localhost:9090         | Metrics & alerting     |
| Grafana       | http://localhost:3001         | Dashboards             |
| Alertmanager  | http://localhost:9093         | Alert management       |

### 3. Verify Everything Is Running

```bash
docker-compose ps
```

All services should show status `Up`.

---

## Generating Traffic

### Normal Traffic (Success Requests)

```bash
# Single request
curl http://localhost:3000/

# Continuous traffic (every 0.5 seconds)
while true; do curl -s http://localhost:3000/ > /dev/null; sleep 0.5; done
```

**On Windows PowerShell:**

```powershell
while ($true) { Invoke-WebRequest -Uri http://localhost:3000/ -UseBasicParsing | Out-Null; Start-Sleep -Milliseconds 500 }
```

### Error Traffic (Trigger Alerts)

```bash
# Single error
curl http://localhost:3000/fail

# Generate enough errors to trigger HighErrorRate alert
# (send errors alongside some normal traffic)
for i in $(seq 1 100); do curl -s http://localhost:3000/fail > /dev/null; done
```

**On Windows PowerShell:**

```powershell
1..100 | ForEach-Object { Invoke-WebRequest -Uri http://localhost:3000/fail -UseBasicParsing | Out-Null }
```

> **Note:** The HighErrorRate alert fires when error rate exceeds 2% sustained for 1 minute. You need to generate a mix of `/fail` and `/` requests where `/fail` makes up more than 2% of total traffic.

---

## Accessing the Services

### Grafana (Dashboards)

- **URL:** [http://localhost:3001](http://localhost:3001)
- **Username:** `admin`
- **Password:** `admin`
- **Dashboard:** Navigate to **Dashboards** → **Node.js Observability Dashboard**

The dashboard is **auto-provisioned** — no manual setup needed. It contains:

| Panel                | PromQL Query                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Requests Per Second  | `sum(rate(http_requests_total[1m]))`                                                                |
| Error Rate %         | `(sum(rate(http_errors_total[1m])) / sum(rate(http_requests_total[1m]))) * 100`                     |
| Total Errors         | `sum(http_errors_total)`                                                                            |
| Request Latency      | `histogram_quantile(0.50\|0.90\|0.99, sum by (le) (rate(http_request_duration_seconds_bucket[1m])))` |

### Prometheus (Metrics & Alerts)

- **URL:** [http://localhost:9090](http://localhost:9090)
- **Targets:** [http://localhost:9090/targets](http://localhost:9090/targets) — verify the `nodejs-app` target is `UP`
- **Alerts:** [http://localhost:9090/alerts](http://localhost:9090/alerts) — view alert status

#### Useful PromQL Queries

```promql
# Total request rate
sum(rate(http_requests_total[1m]))

# Error rate as a percentage
(sum(rate(http_errors_total[1m])) / sum(rate(http_requests_total[1m]))) * 100

# 99th percentile latency
histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[1m])))
```

### Alertmanager (Alert Routing)

- **URL:** [http://localhost:9093](http://localhost:9093)
- View active and silenced alerts
- The default receiver logs alerts (visible in the Alertmanager UI)

---

## Alert Rule: HighErrorRate

### The Query

```promql
(
  sum(rate(http_errors_total[1m]))
  /
  sum(rate(http_requests_total[1m]))
) * 100 > 2
```

### Explanation

This alert calculates the **error rate as a percentage** over a 1-minute window:

1. `rate(http_errors_total[1m])` — computes the per-second rate of errors over the last minute
2. `rate(http_requests_total[1m])` — computes the per-second rate of all requests over the last minute
3. The division gives the **ratio** of errors to total requests
4. Multiply by 100 to convert to a **percentage**
5. The alert fires if this percentage exceeds **2%** for at least **1 minute** (`for: 1m`)

### Why `sum()` Is Required

The `sum()` aggregation is **critical** for this query to work correctly. Here's why:

**The Problem — Label Mismatch:**

- `http_errors_total` has labels: `{route}`
- `http_requests_total` has labels: `{method, route, status}`

When Prometheus evaluates a binary operation (like division) between two metrics, it performs **label matching** — it tries to match time series on their **shared labels**. Because these two metrics have **different label sets**, Prometheus cannot find matching pairs, and the division returns **no results**.

**The Solution — `sum()` Aggregation:**

Wrapping both sides in `sum()` **removes all labels**, reducing each metric to a single scalar value:

```promql
sum(rate(http_errors_total[1m]))     → single value (e.g., 0.5)
sum(rate(http_requests_total[1m]))   → single value (e.g., 10.0)
```

Now the division works correctly:

```
0.5 / 10.0 = 0.05 → 5% error rate
```

**Without `sum()`**, the query would silently return empty results, and the alert would **never fire** — a dangerous silent failure in a production monitoring system.

---

## Stopping the Stack

```bash
# Stop all services
docker-compose down

# Stop and remove all data (volumes)
docker-compose down -v
```

---

## Troubleshooting

| Issue                             | Solution                                                       |
| --------------------------------- | -------------------------------------------------------------- |
| Port already in use               | Stop the conflicting service or change ports in `docker-compose.yml` |
| Prometheus target DOWN            | Check if the app container is running: `docker-compose ps`     |
| Grafana dashboard empty           | Wait 30s for Prometheus to scrape data, then refresh           |
| Alert not firing                  | Generate sustained error traffic for > 1 minute                |
| Container crash loop              | Check logs: `docker logs <container-name> --tail 100`          |

---

## Technologies

| Component    | Technology                    | Version   |
| ------------ | ----------------------------- | --------- |
| Runtime      | Node.js                       | 20 LTS    |
| Framework    | Express                       | 4.x       |
| Logging      | Winston                       | 3.x       |
| Metrics      | prom-client                   | 15.x      |
| Collection   | Prometheus                    | 2.53      |
| Dashboards   | Grafana                       | 11.1      |
| Alerting     | Alertmanager                  | 0.27      |
| Container    | Docker + Docker Compose       | Latest    |

---

## License

MIT
