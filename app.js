/**
 * app.js
 *
 * Express application with full observability instrumentation.
 *
 * Endpoints:
 *   GET /         – Success response. Logs request, increments counters.
 *   GET /fail     – Simulated failure (HTTP 500). Logs error, increments error metrics.
 *   GET /metrics  – Prometheus metrics endpoint (text/plain).
 */

const express = require('express');
const {
  logger,
  httpRequestsTotal,
  httpErrorsTotal,
  httpRequestDuration,
  register
} = require('./instrumentation');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware: Request instrumentation
// ---------------------------------------------------------------------------
// Wraps every request to record latency, log structured data, and update
// Prometheus counters. Placed before route handlers so every route is covered.
app.use((req, res, next) => {
  // Skip instrumentation for the /metrics endpoint itself to avoid
  // polluting dashboards with scrape traffic.
  if (req.path === '/metrics') {
    return next();
  }

  const start = process.hrtime.bigint();

  // Hook into the response finish event to capture the final status code.
  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSeconds = durationNs / 1e9;

    const labels = {
      method: req.method,
      route: req.route ? req.route.path : req.path,
      status: res.statusCode
    };

    // Update Prometheus metrics
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, durationSeconds);

    // Structured log entry for every request
    logger.info('HTTP request processed', {
      method: req.method,
      route: req.route ? req.route.path : req.path,
      statusCode: res.statusCode,
      durationMs: (durationSeconds * 1000).toFixed(2),
      userAgent: req.get('User-Agent') || 'unknown'
    });
  });

  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /
 * Returns a JSON success response.
 */
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Hello from the observability demo service!',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /fail
 * Simulates an application error (HTTP 500).
 * Increments the dedicated error counter and logs a structured error.
 */
app.get('/fail', (req, res) => {
  // Increment error-specific counter
  httpErrorsTotal.inc({ route: '/fail' });

  // Log structured error
  logger.error('Simulated application failure', {
    method: req.method,
    route: '/fail',
    statusCode: 500,
    error: 'Internal Server Error',
    reason: 'Intentional failure for observability testing'
  });

  res.status(500).json({
    status: 'error',
    message: 'Something went wrong!',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /metrics
 * Exposes Prometheus metrics in the standard text exposition format.
 */
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (err) {
    logger.error('Failed to generate metrics', { error: err.message });
    res.status(500).end('Error generating metrics');
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid
  });
});
