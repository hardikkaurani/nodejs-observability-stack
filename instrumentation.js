/**
 * instrumentation.js
 *
 * Centralized observability instrumentation module.
 * Configures Winston structured logging and Prometheus metrics
 * for the Node.js application.
 *
 * Exports:
 *   - logger:               Winston logger instance (JSON format)
 *   - httpRequestsTotal:    Counter for total HTTP requests
 *   - httpErrorsTotal:      Counter for total HTTP errors
 *   - httpRequestDuration:  Histogram for request latency
 *   - register:             Prometheus metric registry
 */

const winston = require('winston');
const promClient = require('prom-client');

// ---------------------------------------------------------------------------
// Winston Structured Logger
// ---------------------------------------------------------------------------
// All log output is JSON-formatted for easy ingestion by log aggregation
// systems (ELK, Loki, CloudWatch, etc.).
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'nodejs-observability-app' },
  transports: [
    new winston.transports.Console()
  ]
});

// ---------------------------------------------------------------------------
// Prometheus Metrics
// ---------------------------------------------------------------------------

// Use the default global registry so /metrics exposes everything in one place.
const register = promClient.register;

// Collect default Node.js runtime metrics (GC, event loop, memory, etc.).
promClient.collectDefaultMetrics({ register });

/**
 * Counter: http_requests_total
 *
 * Tracks every inbound HTTP request. Labels allow slicing by method,
 * route, and response status code in PromQL.
 */
const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['method', 'route', 'status'],
  registers: [register]
});

/**
 * Counter: http_errors_total
 *
 * Dedicated error counter labelled only by route. The alert rule
 * HighErrorRate divides this by http_requests_total to compute an
 * error-rate percentage.
 */
const httpErrorsTotal = new promClient.Counter({
  name: 'http_errors_total',
  help: 'Total number of HTTP errors (status >= 500)',
  labelNames: ['route'],
  registers: [register]
});

/**
 * Histogram: http_request_duration_seconds
 *
 * Records request latency. Default buckets cover a wide range from
 * 5 ms to 10 s, suitable for most web applications.
 */
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

module.exports = {
  logger,
  httpRequestsTotal,
  httpErrorsTotal,
  httpRequestDuration,
  register
};
