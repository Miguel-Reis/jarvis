/**
 * Metrics Collector
 *
 * Centralized metrics collection for monitoring and observability.
 * Supports counters, histograms, and gauges.
 */

export type MetricType = 'counter' | 'histogram' | 'gauge';

export interface MetricLabels {
  [key: string]: string;
}

export interface MetricSample {
  name: string;
  type: MetricType;
  value: number;
  labels: MetricLabels;
  timestamp: number;
}

// Counter - only increases
class Counter {
  private value = 0;
  private samples: MetricSample[] = [];

  constructor(private name: string, private labels: MetricLabels = {}) {}

  increment(amount: number = 1): void {
    this.value += amount;
    this.recordSample(this.value);
  }

  getValue(): number {
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }

  private recordSample(value: number): void {
    this.samples.push({
      name: this.name,
      type: 'counter',
      value,
      labels: this.labels,
      timestamp: Date.now(),
    });

    // Keep last 1000 samples
    if (this.samples.length > 1000) {
      this.samples.shift();
    }
  }

  getSamples(): MetricSample[] {
    return this.samples;
  }
}

// Histogram - tracks distribution of values
class Histogram {
  private values: number[] = [];
  private sum = 0;
  private count = 0;
  private buckets: { threshold: number; count: number }[];

  constructor(
    private name: string,
    private labels: MetricLabels = {},
    bucketBoundaries: number[] = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
  ) {
    this.buckets = bucketBoundaries.map(threshold => ({ threshold, count: 0 }));
  }

  observe(value: number): void {
    this.values.push(value);
    this.sum += value;
    this.count++;

    // Update buckets
    for (const bucket of this.buckets) {
      if (value <= bucket.threshold) {
        bucket.count++;
      }
    }

    // Keep last 10000 values
    if (this.values.length > 10000) {
      const removed = this.values.shift()!;
      this.sum -= removed;
      this.count--;
    }
  }

  getStats(): {
    count: number;
    sum: number;
    average: number;
    min: number;
    max: number;
    p50: number;
    p90: number;
    p99: number;
  } {
    if (this.values.length === 0) {
      return { count: 0, sum: 0, average: 0, min: 0, max: 0, p50: 0, p90: 0, p99: 0 };
    }

    const sorted = [...this.values].sort((a, b) => a - b);

    return {
      count: this.count,
      sum: this.sum,
      average: this.sum / this.count,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  reset(): void {
    this.values = [];
    this.sum = 0;
    this.count = 0;
    this.buckets = this.buckets.map(b => ({ ...b, count: 0 }));
  }
}

// Gauge - can go up or down
class Gauge {
  private value = 0;
  private samples: MetricSample[] = [];

  constructor(private name: string, private labels: MetricLabels = {}) {}

  set(value: number): void {
    this.value = value;
    this.recordSample(value);
  }

  increment(amount: number = 1): void {
    this.value += amount;
    this.recordSample(this.value);
  }

  decrement(amount: number = 1): void {
    this.value -= amount;
    this.recordSample(this.value);
  }

  getValue(): number {
    return this.value;
  }

  private recordSample(value: number): void {
    this.samples.push({
      name: this.name,
      type: 'gauge',
      value,
      labels: this.labels,
      timestamp: Date.now(),
    });

    // Keep last 100 samples
    if (this.samples.length > 100) {
      this.samples.shift();
    }
  }

  getSamples(): MetricSample[] {
    return this.samples;
  }
}

export class MetricsCollector {
  private counters = new Map<string, Counter>();
  private histograms = new Map<string, Histogram>();
  private gauges = new Map<string, Gauge>();

  /**
   * Get or create a counter
   */
  counter(name: string, labels?: MetricLabels): Counter {
    const key = this.makeKey(name, labels);
    let counter = this.counters.get(key);

    if (!counter) {
      counter = new Counter(name, labels ?? {});
      this.counters.set(key, counter);
    }

    return counter;
  }

  /**
   * Get or create a histogram
   */
  histogram(name: string, labels?: MetricLabels, buckets?: number[]): Histogram {
    const key = this.makeKey(name, labels);
    let histogram = this.histograms.get(key);

    if (!histogram) {
      histogram = new Histogram(name, labels ?? {}, buckets);
      this.histograms.set(key, histogram);
    }

    return histogram;
  }

  /**
   * Get or create a gauge
   */
  gauge(name: string, labels?: MetricLabels): Gauge {
    const key = this.makeKey(name, labels);
    let gauge = this.gauges.get(key);

    if (!gauge) {
      gauge = new Gauge(name, labels ?? {});
      this.gauges.set(key, gauge);
    }

    return gauge;
  }

  /**
   * Export all metrics in Prometheus format
   */
  exportPrometheus(): string {
    const lines: string[] = [];

    // Export counters
    for (const counter of this.counters.values()) {
      const samples = counter.getSamples();
      if (samples.length > 0) {
        const last = samples[samples.length - 1];
        const labelsStr = this.formatLabels(last.labels);
        lines.push(`# TYPE ${last.name} counter`);
        lines.push(`${last.name}${labelsStr} ${last.value}`);
      }
    }

    // Export histograms
    for (const histogram of this.histograms.values()) {
      const stats = histogram.getStats();
      const name = histogram['name'];
      lines.push(`# TYPE ${name} histogram`);
      lines.push(`${name}_count ${stats.count}`);
      lines.push(`${name}_sum ${stats.sum}`);
      lines.push(`${name}_avg ${stats.average.toFixed(2)}`);
      lines.push(`${name}_p50 ${stats.p50.toFixed(2)}`);
      lines.push(`${name}_p90 ${stats.p90.toFixed(2)}`);
      lines.push(`${name}_p99 ${stats.p99.toFixed(2)}`);
    }

    // Export gauges
    for (const gauge of this.gauges.values()) {
      const samples = gauge.getSamples();
      if (samples.length > 0) {
        const last = samples[samples.length - 1];
        const labelsStr = this.formatLabels(last.labels);
        lines.push(`# TYPE ${last.name} gauge`);
        lines.push(`${last.name}${labelsStr} ${last.value}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Export all metrics as JSON
   */
  exportJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, counter] of this.counters.entries()) {
      result[key] = { type: 'counter', value: counter.getValue() };
    }

    for (const [key, histogram] of this.histograms.entries()) {
      result[key] = { type: 'histogram', ...histogram.getStats() };
    }

    for (const [key, gauge] of this.gauges.entries()) {
      result[key] = { type: 'gauge', value: gauge.getValue() };
    }

    return result;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }

  // --- Private helpers ---

  private makeKey(name: string, labels?: MetricLabels): string {
    if (!labels) return name;
    const labelsStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(':');
    return `${name}:${labelsStr}`;
  }

  private formatLabels(labels: MetricLabels): string {
    if (Object.keys(labels).length === 0) return '';
    const parts = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `{${parts}}`;
  }
}

// Global metrics collector instance
export const globalMetricsCollector = new MetricsCollector();

// Pre-defined system metrics counters
export const systemMetrics = {
  httpRequests: globalMetricsCollector.counter('http_requests_total', { method: 'all' }),
  httpErrors: globalMetricsCollector.counter('http_errors_total', { method: 'all' }),
  llmCalls: globalMetricsCollector.counter('llm_calls_total', {}),
  llmTokens: globalMetricsCollector.counter('llm_tokens_total', {}),
  toolCalls: globalMetricsCollector.counter('tool_calls_total', {}),
  toolErrors: globalMetricsCollector.counter('tool_errors_total', {}),
  dbQueries: globalMetricsCollector.counter('db_queries_total', {}),
  activeConnections: globalMetricsCollector.gauge('active_connections', {}),
  responseTime: globalMetricsCollector.histogram('http_response_time_ms', {}),
  toolExecutionTime: globalMetricsCollector.histogram('tool_execution_time_ms', {}),
};
