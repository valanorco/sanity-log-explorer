import { useEffect, useRef } from "react"

import embed from "vega-embed"

export type AnomalyPoint = {
  id: string
  timestamp: string
  response_time_ms: number
  has_latency: boolean
  response_size_bytes: number | null
  partition_domain: string
  partition_request: string
  response_status: number | null
  ip_address: string
  is_anomaly: boolean
  anomaly_score: number
  primary_anomaly_reason: string
  anomaly_reason: string
}

type AnomalyChartProps = {
  points: AnomalyPoint[]
  bucketMinutes: number
}

function toMinuteBucket(isoTimestamp: string, windowMinutes: number) {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) return isoTimestamp.slice(0, 16)

  const safeWindow = Math.max(1, Math.floor(windowMinutes))
  const bucketMs = safeWindow * 60_000
  const bucketStart = Math.floor(date.getTime() / bucketMs) * bucketMs
  return new Date(bucketStart).toISOString()
}

export function AnomalyChart({ points, bucketMinutes }: AnomalyChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const bucketMap = new Map<
      string,
      {
        timestamp: string
        request_count: number
        anomaly_count: number
        total_response_size_bytes: number
        reasons: Map<string, number>
        ips: Set<string>
      }
    >()

    for (const point of points) {
      const bucket = toMinuteBucket(point.timestamp, bucketMinutes)
      const existing = bucketMap.get(bucket) ?? {
        timestamp: bucket,
        request_count: 0,
        anomaly_count: 0,
        total_response_size_bytes: 0,
        reasons: new Map<string, number>(),
        ips: new Set<string>(),
      }

      existing.request_count += 1
      existing.total_response_size_bytes += point.response_size_bytes ?? 0
      if (point.ip_address !== "-") {
        existing.ips.add(point.ip_address)
      }
      if (point.is_anomaly) {
        existing.anomaly_count += 1
        const reason = point.primary_anomaly_reason === "none" ? "latency" : point.primary_anomaly_reason
        existing.reasons.set(reason, (existing.reasons.get(reason) ?? 0) + 1)
      }

      bucketMap.set(bucket, existing)
    }

    const chartValues = Array.from(bucketMap.values())
      .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
      .map((bucket) => {
        const dominantReasonEntry = Array.from(bucket.reasons.entries()).sort((left, right) => right[1] - left[1])[0]
        return {
          timestamp: bucket.timestamp,
          request_count: bucket.request_count,
          anomaly_count: bucket.anomaly_count,
          unique_ips: bucket.ips.size,
          total_response_size_mb: bucket.total_response_size_bytes / (1024 * 1024),
          avg_response_size_kb:
            bucket.request_count > 0
              ? bucket.total_response_size_bytes / bucket.request_count / 1024
              : 0,
          is_anomaly: bucket.anomaly_count > 0,
          primary_anomaly_reason: dominantReasonEntry?.[0] ?? "normal",
        }
      })

    const spec = {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      width: "container",
      height: 300,
      data: { values: chartValues },
      layer: [
        {
          transform: [{ filter: "datum.is_anomaly === false" }],
          mark: { type: "bar", opacity: 0.65, color: "#64748b" },
          encoding: {
            x: { field: "timestamp", type: "temporal", title: "Timestamp" },
            y: { field: "request_count", type: "quantitative", title: "Requests" },
            tooltip: [
              { field: "timestamp", type: "temporal", title: "Timestamp" },
              { field: "request_count", type: "quantitative", title: "Requests" },
              { field: "total_response_size_mb", type: "quantitative", title: "Total response size (MB)", format: ".2f" },
              { field: "avg_response_size_kb", type: "quantitative", title: "Avg response size (KB)", format: ".2f" },
              { field: "unique_ips", type: "quantitative", title: "Unique IPs" },
            ],
          },
        },
        {
          transform: [{ filter: "datum.is_anomaly === true" }],
          mark: { type: "bar", opacity: 0.95 },
          encoding: {
            x: { field: "timestamp", type: "temporal", title: "Timestamp" },
            y: { field: "request_count", type: "quantitative", title: "Requests" },
            color: {
              field: "primary_anomaly_reason",
              type: "nominal",
              title: "Primary anomaly type",
              scale: {
                domain: ["high_volume_ip", "burst_ip", "ewma_burst", "cusum_shift", "latency", "normal"],
                range: ["#7c3aed", "#ea580c", "#0f766e", "#1d4ed8", "#dc2626", "#64748b"],
              },
            },
            tooltip: [
              { field: "timestamp", type: "temporal", title: "Timestamp" },
              { field: "request_count", type: "quantitative", title: "Requests" },
              { field: "anomaly_count", type: "quantitative", title: "Anomalous requests" },
              { field: "total_response_size_mb", type: "quantitative", title: "Total response size (MB)", format: ".2f" },
              { field: "avg_response_size_kb", type: "quantitative", title: "Avg response size (KB)", format: ".2f" },
              { field: "unique_ips", type: "quantitative", title: "Unique IPs" },
              { field: "primary_anomaly_reason", type: "nominal", title: "Primary anomaly type" },
            ],
          },
        },
        {
          mark: { type: "line", strokeWidth: 2, color: "#0f172a", opacity: 0.9 },
          encoding: {
            x: { field: "timestamp", type: "temporal", title: "Timestamp" },
            y: {
              field: "total_response_size_mb",
              type: "quantitative",
              title: "Total response size (MB)",
              axis: { orient: "right", titleColor: "#0f172a", labelColor: "#0f172a" },
            },
            tooltip: [
              { field: "timestamp", type: "temporal", title: "Timestamp" },
              { field: "request_count", type: "quantitative", title: "Requests" },
              { field: "total_response_size_mb", type: "quantitative", title: "Total response size (MB)", format: ".2f" },
              { field: "avg_response_size_kb", type: "quantitative", title: "Avg response size (KB)", format: ".2f" },
            ],
          },
        },
      ],
      resolve: {
        scale: {
          y: "independent",
        },
      },
      config: {
        view: { stroke: "#e2e8f0" },
        axis: {
          labelColor: "#475569",
          titleColor: "#334155",
          gridColor: "#e2e8f0",
        },
      },
      autosize: { type: "fit", contains: "padding" },
    }

    let finalized = false
    void embed(containerRef.current, spec, { actions: false }).then((result) => {
      if (finalized) {
        result.view.finalize()
      }
    })

    return () => {
      finalized = true
    }
  }, [points, bucketMinutes])

  return <div ref={containerRef} className="w-full" />
}
