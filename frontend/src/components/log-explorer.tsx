import type { ChangeEvent } from "react"
import { useEffect, useRef, useState } from "react"

import { clearServerData, uploadFile, runTransform, fetchSchema, fetchSessions, runQuery } from "@/client/queries"
import type { ImportSession as BackendImportSession } from "@/client/types"
import { AnomalyChart, type AnomalyPoint } from "./anomaly-chart"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"

type SelectState = {
  dates: string[]
  domains: string[]
  requests: string[]
  endpoints: string[]
}

type ImportSession = {
  id: string
  fileId: string
  filename: string
  status: string
  importedAtIso: string
  updatedAtIso: string
  transformedAtIso: string | null
  rowsRead: number
  rowsLoaded: number
  rowsRejected: number
}

const MAX_HISTORY_ITEMS = 200

const emptyOptions: SelectState = {
  dates: [],
  domains: [],
  requests: [],
  endpoints: [],
}

function getSelectedValues(event: ChangeEvent<HTMLSelectElement>) {
  return Array.from(event.target.selectedOptions).map((option) => option.value)
}

function hasActiveFilters(filters: SelectState) {
  return (
    filters.dates.length > 0 ||
    filters.domains.length > 0 ||
    filters.requests.length > 0 ||
    filters.endpoints.length > 0
  )
}

function columnLabel(column: string) {
  const knownLabels: Record<string, string> = {
    event_id: "Event ID",
    timestamp: "Timestamp",
    partition_date: "Date",
    partition_domain: "Domain",
    partition_request: "Request",
    partition_endpoint: "Endpoint",
    request_method: "Method",
    request_label: "Request label",
    response_status: "Status",
    response_time_ms: "Response time (ms)",
    request_size_bytes: "Request size",
    response_size_bytes: "Response size",
    ip_address: "IP",
  }

  return knownLabels[column] ?? column.replaceAll("_", " ")
}

const BYTE_COLUMNS = new Set([
  "request_size_bytes",
  "response_size_bytes",
  "avg_request_size",
  "avg_response_size",
  "total_request_size",
  "total_response_size",
])

function formatBytesValue(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"]
  if (!Number.isFinite(value)) return "-"
  if (value === 0) return "0 B"

  const absValue = Math.abs(value)
  const unitIndex = Math.min(Math.floor(Math.log(absValue) / Math.log(1024)), units.length - 1)
  const scaledValue = value / 1024 ** unitIndex
  const decimals = unitIndex === 0 ? 0 : scaledValue >= 100 ? 0 : scaledValue >= 10 ? 1 : 2

  return `${scaledValue.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })} ${units[unitIndex]}`
}

function formatCellValue(column: string, value: string | number | null) {
  if (value == null) return "-"

  if (BYTE_COLUMNS.has(column)) {
    const numericValue = typeof value === "number" ? value : Number(value)
    if (Number.isFinite(numericValue)) return formatBytesValue(numericValue)
  }

  return String(value)
}

type SortDirection = "asc" | "desc"

type AnalysisResult = {
  points: AnomalyPoint[]
  thresholdMs: number | null
  anomalyCount: number
  reasonCounts: Record<string, number>
}

type AnalysisControls = {
  latencyIqrMultiplier: number
  ipVolumeIqrMultiplier: number
  burstIqrMultiplier: number
  burstWindowMinutes: number
  minIpVolumeCount: number
  minBurstCount: number
  ewmaAlpha: number
  ewmaStdDevMultiplier: number
  cusumDrift: number
  cusumThreshold: number
}

type AnalysisPresetName = "Conservative" | "Balanced" | "Aggressive"

type AnomalyReason = "latency" | "high_volume_ip" | "burst_ip" | "ewma_burst" | "cusum_shift"

function emptyReasonCounts(): Record<AnomalyReason, number> {
  return {
    latency: 0,
    high_volume_ip: 0,
    burst_ip: 0,
    ewma_burst: 0,
    cusum_shift: 0,
  }
}

const ANALYSIS_PRESETS: Record<AnalysisPresetName, AnalysisControls> = {
  Conservative: {
    latencyIqrMultiplier: 2.5,
    ipVolumeIqrMultiplier: 2.5,
    burstIqrMultiplier: 2.5,
    burstWindowMinutes: 2,
    minIpVolumeCount: 4,
    minBurstCount: 4,
    ewmaAlpha: 0.2,
    ewmaStdDevMultiplier: 3,
    cusumDrift: 1,
    cusumThreshold: 8,
  },
  Balanced: {
    latencyIqrMultiplier: 1.5,
    ipVolumeIqrMultiplier: 1.5,
    burstIqrMultiplier: 1.5,
    burstWindowMinutes: 1,
    minIpVolumeCount: 2,
    minBurstCount: 2,
    ewmaAlpha: 0.3,
    ewmaStdDevMultiplier: 2,
    cusumDrift: 0.5,
    cusumThreshold: 5,
  },
  Aggressive: {
    latencyIqrMultiplier: 1,
    ipVolumeIqrMultiplier: 1,
    burstIqrMultiplier: 1,
    burstWindowMinutes: 1,
    minIpVolumeCount: 2,
    minBurstCount: 2,
    ewmaAlpha: 0.45,
    ewmaStdDevMultiplier: 1.2,
    cusumDrift: 0,
    cusumThreshold: 2,
  },
}

const NUMERIC_COLUMNS = new Set([
  "response_status",
  "response_time_ms",
  "request_size_bytes",
  "response_size_bytes",
])

function compareRows(
  leftRow: Record<string, string | number | null>,
  rightRow: Record<string, string | number | null>,
  column: string,
  direction: SortDirection,
) {
  const leftValue = leftRow[column]
  const rightValue = rightRow[column]

  if (leftValue == null && rightValue == null) return 0
  if (leftValue == null) return direction === "asc" ? 1 : -1
  if (rightValue == null) return direction === "asc" ? -1 : 1

  let comparison = 0

  if (column === "timestamp") {
    comparison = new Date(String(leftValue)).getTime() - new Date(String(rightValue)).getTime()
  } else if (NUMERIC_COLUMNS.has(column)) {
    comparison = Number(leftValue) - Number(rightValue)
  } else {
    comparison = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" })
  }

  return direction === "asc" ? comparison : -comparison
}

function percentile(sortedValues: number[], quantile: number) {
  if (sortedValues.length === 0) return null

  const index = (sortedValues.length - 1) * quantile
  const low = Math.floor(index)
  const high = Math.ceil(index)
  if (low === high) return sortedValues[low]

  const weight = index - low
  return sortedValues[low] + (sortedValues[high] - sortedValues[low]) * weight
}

function toMinuteBucket(isoTimestamp: string, windowMinutes: number) {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) return isoTimestamp.slice(0, 16)

  const safeWindow = Math.max(1, Math.floor(windowMinutes))
  const bucketMs = safeWindow * 60_000
  const bucketStart = Math.floor(date.getTime() / bucketMs) * bucketMs
  return new Date(bucketStart).toISOString()
}

function detectRateAnomalyBuckets(points: AnomalyPoint[], controls: AnalysisControls) {
  const bucketCounts = new Map<string, number>()
  for (const point of points) {
    const bucket = toMinuteBucket(point.timestamp, controls.burstWindowMinutes)
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1)
  }

  const orderedBuckets = Array.from(bucketCounts.entries())
    .sort(([left], [right]) => new Date(left).getTime() - new Date(right).getTime())
    .map(([bucket, count]) => ({ bucket, count }))

  if (orderedBuckets.length === 0) {
    return { ewmaBuckets: new Set<string>(), cusumBuckets: new Set<string>() }
  }

  const counts = orderedBuckets.map((item) => item.count)
  const mean = counts.reduce((sum, value) => sum + value, 0) / counts.length
  const variance = counts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / counts.length
  const stdDev = Math.sqrt(variance)
  const scale = stdDev > 0 ? stdDev : 1

  const ewmaBuckets = new Set<string>()
  let ewma = orderedBuckets[0].count
  for (const { bucket, count } of orderedBuckets) {
    ewma = controls.ewmaAlpha * count + (1 - controls.ewmaAlpha) * ewma
    const residual = count - ewma
    if (residual > controls.ewmaStdDevMultiplier * scale) {
      ewmaBuckets.add(bucket)
    }
  }

  const cusumBuckets = new Set<string>()
  let positiveCusum = 0
  for (const { bucket, count } of orderedBuckets) {
    const deviation = count - mean - controls.cusumDrift
    positiveCusum = Math.max(0, positiveCusum + deviation)
    if (positiveCusum > controls.cusumThreshold * scale) {
      cusumBuckets.add(bucket)
      positiveCusum = 0
    }
  }

  return { ewmaBuckets, cusumBuckets }
}

function analyzeLatencyRows(
  rows: Array<Record<string, string | number | null>>,
  controls: AnalysisControls,
): AnalysisResult {
  const nullablePoints: Array<AnomalyPoint | null> = rows
    .map((row, index) => {
      const responseTimeValue = row.response_time_ms
      const timestampValue = row.timestamp
      const latency = Number(responseTimeValue)
      if (!timestampValue) return null
      const hasLatency = Number.isFinite(latency)

      const point: AnomalyPoint = {
        id: String(row.event_id ?? `row-${index}`),
        timestamp: String(timestampValue),
        response_time_ms: hasLatency ? latency : 0,
        has_latency: hasLatency,
        response_size_bytes: Number.isFinite(Number(row.response_size_bytes))
          ? Number(row.response_size_bytes)
          : null,
        partition_domain: row.partition_domain == null ? "-" : String(row.partition_domain),
        partition_request: row.partition_request == null ? "-" : String(row.partition_request),
        response_status: Number.isFinite(Number(row.response_status)) ? Number(row.response_status) : null,
        ip_address: row.ip_address == null ? "-" : String(row.ip_address),
        is_anomaly: false,
        anomaly_score: 0,
        primary_anomaly_reason: "none",
        anomaly_reason: "none",
      }

      return point
    })

  const points = nullablePoints.filter((point): point is AnomalyPoint => point !== null)

  if (points.length === 0) {
    return { points: [], thresholdMs: null, anomalyCount: 0, reasonCounts: emptyReasonCounts() }
  }

  const latencies = points
    .filter((point) => point.has_latency)
    .map((point) => point.response_time_ms)
    .sort((left, right) => left - right)
  const q1 = latencies.length > 0 ? percentile(latencies, 0.25) : null
  const q3 = latencies.length > 0 ? percentile(latencies, 0.75) : null

  let thresholdMs: number | null
  if (latencies.length === 0) {
    thresholdMs = null
  } else if (q1 == null || q3 == null) {
    thresholdMs = latencies[latencies.length - 1]
  } else {
    const iqr = q3 - q1
    if (iqr > 0) {
      thresholdMs = q3 + controls.latencyIqrMultiplier * iqr
    } else {
      const mean = latencies.reduce((sum, value) => sum + value, 0) / latencies.length
      const variance = latencies.reduce((sum, value) => sum + (value - mean) ** 2, 0) / latencies.length
      const standardDeviation = Math.sqrt(variance)
      thresholdMs = mean + (standardDeviation > 0 ? standardDeviation * 3 : 0)
    }
  }

  const ipCounts = new Map<string, number>()
  for (const point of points) {
    if (point.ip_address !== "-") {
      ipCounts.set(point.ip_address, (ipCounts.get(point.ip_address) ?? 0) + 1)
    }
  }

  const ipCountValues = Array.from(ipCounts.values()).sort((left, right) => left - right)
  const ipQ1 = percentile(ipCountValues, 0.25)
  const ipQ3 = percentile(ipCountValues, 0.75)
  const ipVolumeThreshold =
    ipQ1 != null && ipQ3 != null
      ? ipQ3 + Math.max(1, (ipQ3 - ipQ1) * controls.ipVolumeIqrMultiplier)
      : ipCountValues.length > 0
        ? ipCountValues[ipCountValues.length - 1]
        : Number.POSITIVE_INFINITY

  const heavyIps = new Set(
    Array.from(ipCounts.entries())
      .filter(([, count]) => count >= ipVolumeThreshold && count >= controls.minIpVolumeCount)
      .map(([ip]) => ip),
  )

  const burstCounts = new Map<string, number>()
  for (const point of points) {
    if (point.ip_address === "-") continue
    const bucket = toMinuteBucket(point.timestamp, controls.burstWindowMinutes)
    const key = `${point.ip_address}|${bucket}`
    burstCounts.set(key, (burstCounts.get(key) ?? 0) + 1)
  }

  const burstValues = Array.from(burstCounts.values()).sort((left, right) => left - right)
  const burstQ1 = percentile(burstValues, 0.25)
  const burstQ3 = percentile(burstValues, 0.75)
  const burstThreshold =
    burstQ1 != null && burstQ3 != null
      ? burstQ3 + Math.max(1, (burstQ3 - burstQ1) * controls.burstIqrMultiplier)
      : burstValues.length > 0
        ? burstValues[burstValues.length - 1]
        : Number.POSITIVE_INFINITY

  const burstKeys = new Set(
    Array.from(burstCounts.entries())
      .filter(([, count]) => count >= burstThreshold && count >= controls.minBurstCount)
      .map(([key]) => key),
  )

  const { ewmaBuckets, cusumBuckets } = detectRateAnomalyBuckets(points, controls)

  const reasonCounts = emptyReasonCounts()

  const reasonPriority: AnomalyReason[] = [
    "ewma_burst",
    "cusum_shift",
    "burst_ip",
    "high_volume_ip",
    "latency",
  ]

  const analyzedPoints = points.map((point) => {
    const anomalyScore = thresholdMs == null || !point.has_latency ? 0 : point.response_time_ms - thresholdMs
    const reasons: AnomalyReason[] = []

    if (point.has_latency && thresholdMs != null && anomalyScore > 0) reasons.push("latency")
    if (point.ip_address !== "-" && heavyIps.has(point.ip_address)) reasons.push("high_volume_ip")

    const globalBucket = toMinuteBucket(point.timestamp, controls.burstWindowMinutes)
    if (ewmaBuckets.has(globalBucket)) reasons.push("ewma_burst")
    if (cusumBuckets.has(globalBucket)) reasons.push("cusum_shift")

    if (point.ip_address !== "-") {
      const bucket = toMinuteBucket(point.timestamp, controls.burstWindowMinutes)
      const key = `${point.ip_address}|${bucket}`
      if (burstKeys.has(key)) reasons.push("burst_ip")
    }

    for (const reason of reasons) {
      reasonCounts[reason] += 1
    }

    const primaryReason = reasonPriority.find((reason) => reasons.includes(reason)) ?? "latency"

    return {
      ...point,
      is_anomaly: reasons.length > 0,
      anomaly_score: anomalyScore,
      primary_anomaly_reason: reasons.length > 0 ? primaryReason : "none",
      anomaly_reason: reasons.length > 0 ? reasons.join(", ") : "none",
    }
  })

  const anomalyCount = analyzedPoints.filter((point) => point.is_anomaly).length
  return { points: analyzedPoints, thresholdMs, anomalyCount, reasonCounts }
}

function isImportSession(value: unknown): value is ImportSession {
  if (!value || typeof value !== "object") return false

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.fileId === "string" &&
    typeof candidate.filename === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.importedAtIso === "string" &&
    typeof candidate.updatedAtIso === "string" &&
    (typeof candidate.transformedAtIso === "string" || candidate.transformedAtIso === null) &&
    typeof candidate.rowsRead === "number" &&
    typeof candidate.rowsLoaded === "number" &&
    typeof candidate.rowsRejected === "number"
  )
}

function mapBackendSession(session: BackendImportSession): ImportSession {
  return {
    id: `${session.file_id}|${session.created_at}`,
    fileId: session.file_id,
    filename: session.filename,
    status: session.status,
    importedAtIso: session.created_at,
    updatedAtIso: session.updated_at,
    transformedAtIso: session.transformed_at,
    rowsRead: session.rows_read,
    rowsLoaded: session.rows_loaded,
    rowsRejected: session.rows_rejected,
  }
}

function formatSessionLabel(session: ImportSession) {
  const timeLabel = new Date(session.importedAtIso).toLocaleString()
  return `${timeLabel} | ${session.filename} | ${session.fileId} | ${session.status}`
}

export default function LogExplorer() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [currentFileId, setCurrentFileId] = useState<string | null>(null)
  const [status, setStatus] = useState("No file uploaded yet.")
  const [chartMessage, setChartMessage] = useState("Run a query to load table results.")
  const [processLog, setProcessLog] = useState<string[]>(["Ready. Pick a file to begin ingest."])
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState("Upload progress: 0%")
  const [queryRows, setQueryRows] = useState<Array<Record<string, string | number | null>>>([])

  const [options, setOptions] = useState<SelectState>(emptyOptions)
  const [selected, setSelected] = useState<SelectState>(emptyOptions)

  const [isUploading, setIsUploading] = useState(false)
  const [isTransforming, setIsTransforming] = useState(false)
  const [isQuerying, setIsQuerying] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [canTransform, setCanTransform] = useState(false)
  const [canQuery, setCanQuery] = useState(false)
  const [sessionHistory, setSessionHistory] = useState<ImportSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState("")
  const [sortColumn, setSortColumn] = useState("timestamp")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(50)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [anomalyPoints, setAnomalyPoints] = useState<AnomalyPoint[]>([])
  const [anomalyThresholdMs, setAnomalyThresholdMs] = useState<number | null>(null)
  const [anomalyCount, setAnomalyCount] = useState(0)
  const [anomalyReasonCounts, setAnomalyReasonCounts] = useState<Record<string, number>>({
    latency: 0,
    high_volume_ip: 0,
    burst_ip: 0,
    ewma_burst: 0,
    cusum_shift: 0,
  })
  const [analysisControls, setAnalysisControls] = useState<AnalysisControls>({
    latencyIqrMultiplier: 1.5,
    ipVolumeIqrMultiplier: 1.5,
    burstIqrMultiplier: 1.5,
    burstWindowMinutes: 1,
    minIpVolumeCount: 2,
    minBurstCount: 2,
    ewmaAlpha: 0.3,
    ewmaStdDevMultiplier: 2,
    cusumDrift: 0.5,
    cusumThreshold: 5,
  })
  const [selectedAnalysisPreset, setSelectedAnalysisPreset] = useState<AnalysisPresetName>("Balanced")
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  useEffect(() => {
    void loadSessionHistory()
  }, [])

  async function loadSessionHistory() {
    try {
      const response = await fetchSessions(MAX_HISTORY_ITEMS)
      const mapped = response.sessions.map(mapBackendSession).filter(isImportSession)
      setSessionHistory(mapped)
      return mapped
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      appendLog(`Failed to load session history: ${message}`)
      return []
    }
  }

  function appendLog(message: string) {
    const entry = `[${new Date().toLocaleTimeString()}] ${message}`
    setProcessLog((prev) => [...prev.slice(-49), entry])
  }

  function setUploadProgress(percent: number, loadedBytes?: number, totalBytes?: number) {
    const safePercent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0))
    setProgress(safePercent)

    if (typeof loadedBytes === "number" && typeof totalBytes === "number" && totalBytes > 0) {
      const loadedMb = (loadedBytes / (1024 * 1024)).toFixed(1)
      const totalMb = (totalBytes / (1024 * 1024)).toFixed(1)
      setProgressText(`Upload progress: ${safePercent}% (${loadedMb}MB / ${totalMb}MB)`)
      return
    }

    setProgressText(`Upload progress: ${safePercent}%`)
  }

  function resetFilters() {
    setSelected(emptyOptions)
    appendLog("Filters reset.")
    setStatus("Filters reset. Run Query to refresh chart.")
  }

  async function clearData() {
    const confirmed = window.confirm(
      "Clear all data? This will permanently delete previous sessions, uploads, staging files, and query data.",
    )
    if (!confirmed) {
      appendLog("Clear data canceled by user.")
      return
    }

    try {
      setIsClearing(true)
      const result = await clearServerData()

    setCurrentFileId(null)
    setOptions(emptyOptions)
    setSelected(emptyOptions)
    setSelectedSessionId("")
    setSessionHistory([])
    setCanTransform(false)
    setCanQuery(false)
    setQueryRows([])
    setAnomalyPoints([])
    setAnomalyThresholdMs(null)
    setAnomalyCount(0)
    setAnomalyReasonCounts(emptyReasonCounts())
    setAnalysisError(null)
    setProgress(0)
    setProgressText("Upload progress: 0%")
    setChartMessage("Run a query to load table results.")
    setStatus(result.message)
    setProcessLog([
      `[${new Date().toLocaleTimeString()}] ${result.message} Upload files deleted: ${result.deleted_upload_files}, staging entries deleted: ${result.deleted_staging_files}.`,
    ])

    await loadSessionHistory()

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      setStatus(`Clear data failed: ${message}`)
      appendLog(`Clear data failed: ${message}`)
    } finally {
      setIsClearing(false)
    }
  }

  async function loadSchema(fileId: string) {
    appendLog(`Loading schema for file ${fileId}.`)
    const schema = await fetchSchema(fileId)
    const nextOptions: SelectState = {
      dates: schema.dates,
      domains: schema.domains,
      requests: schema.requests,
      endpoints: schema.endpoints,
    }

    setOptions(nextOptions)
    setSelected((prev) => ({
      dates: prev.dates.filter((value) => nextOptions.dates.includes(value)),
      domains: prev.domains.filter((value) => nextOptions.domains.includes(value)),
      requests: prev.requests.filter((value) => nextOptions.requests.includes(value)),
      endpoints: prev.endpoints.filter((value) => nextOptions.endpoints.includes(value)),
    }))

    setCanQuery(schema.status === "ready")
    setCanTransform(schema.status !== "ready")
    setStatus(`File ${fileId} is ${schema.status}. Rows in marts: ${schema.row_count}.`)
    appendLog(`Schema loaded. File status=${schema.status}, rows=${schema.row_count}.`)
  }

  async function handleLoadPreviousSession() {
    if (!selectedSessionId) {
      setStatus("Please select a previous session first.")
      return
    }

    const session = sessionHistory.find((item) => item.id === selectedSessionId)
    if (!session) {
      setStatus("Selected session was not found in history.")
      return
    }

    try {
      setCurrentFileId(session.fileId)
      setOptions(emptyOptions)
      setSelected(emptyOptions)
      setQueryRows([])
      setAnomalyPoints([])
      setAnomalyThresholdMs(null)
      setAnomalyCount(0)
      setAnomalyReasonCounts(emptyReasonCounts())
      setAnalysisError(null)
      setChartMessage("Run a query to load table results.")

      appendLog(`Loading previous session ${session.fileId} (${session.filename}).`)
      await loadSchema(session.fileId)
      setStatus(`Loaded previous session: ${formatSessionLabel(session)}`)
      appendLog(`Previous session loaded: ${session.fileId}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      setStatus(`Failed to load previous session: ${message}`)
      appendLog(`Failed to load previous session ${session.fileId}: ${message}`)
    }
  }

  async function handleUpload() {
    try {
      const file = fileInputRef.current?.files?.[0]
      if (!file) {
        setStatus("Please pick a file first.")
        appendLog("Ingest blocked: no file selected.")
        return
      }

      setIsUploading(true)
      setUploadProgress(0)
      setStatus("Uploading and ingesting...")
      appendLog(`Ingest started for ${file.name}.`)

      const ingestResult = await uploadFile(file, setUploadProgress)
      setUploadProgress(100)

      setCurrentFileId(ingestResult.file_id)
      setOptions(emptyOptions)
      setSelected(emptyOptions)
      setCanTransform(true)
      setCanQuery(false)

      const refreshedSessions = await loadSessionHistory()
      const matchingSession = refreshedSessions.find((session) => session.fileId === ingestResult.file_id)
      if (matchingSession) {
        setSelectedSessionId(matchingSession.id)
      }

      setStatus(
        `Ingest complete for ${ingestResult.filename}. Loaded ${ingestResult.rows_loaded}/${ingestResult.rows_read}, rejected ${ingestResult.rows_rejected}. Run dbt transform before querying.`
      )
      appendLog(
        `Ingest complete for ${ingestResult.filename}. Loaded=${ingestResult.rows_loaded}, rejected=${ingestResult.rows_rejected}.`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      setUploadProgress(0)
      setStatus(`Ingest failed: ${message}`)
      appendLog(`Ingest failed: ${message}`)
    } finally {
      setIsUploading(false)
    }
  }

  async function handleTransform() {
    if (!currentFileId) return

    try {
      setIsTransforming(true)
      setStatus("Running dbt transform...")
      appendLog(`Transform started for file ${currentFileId}.`)
      await runTransform(currentFileId)
      await loadSchema(currentFileId)
      appendLog(`Transform completed for file ${currentFileId}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      setStatus(`Transform failed: ${message}`)
      appendLog(`Transform failed: ${message}`)
    } finally {
      setIsTransforming(false)
    }
  }

  async function handleQuery() {
    if (!currentFileId) return

    if (!canQuery) {
      const message = "Query blocked: file is not transformed yet. Run dbt transform first."
      setStatus(message)
      appendLog(message)
      return
    }

    try {
      setIsQuerying(true)
      setStatus("Querying...")
      appendLog("Query started with current filters.")
      setChartMessage("Running query...")
      setAnomalyPoints([])
      setAnomalyThresholdMs(null)
      setAnomalyCount(0)
      setAnomalyReasonCounts(emptyReasonCounts())
      setAnalysisError(null)

      const request = {
        file_id: currentFileId,
        partition_filter: selected,
        limit: 200000,
      }

      const result = await runQuery(request)
      if (result.data.length === 0 && hasActiveFilters(selected)) {
        appendLog("Query returned no rows with current filters. Retrying once without filters.")
        const unfiltered = await runQuery({
          ...request,
          partition_filter: { dates: [], domains: [], requests: [], endpoints: [] },
        })

        if (unfiltered.data.length > 0) {
          setSelected({ dates: [], domains: [], requests: [], endpoints: [] })
          setQueryRows(unfiltered.data)
          setChartMessage("")
          setStatus("No rows matched filters. Filters were reset and unfiltered data is now shown.")
          appendLog(`Fallback query succeeded. Rendered ${unfiltered.data.length} unfiltered rows.`)
          return
        }
      }

      if (result.data.length === 0) {
        setQueryRows([])
        setCurrentPage(1)
        setChartMessage("No data found for the current filters. Try clearing filters.")
        setStatus("Query complete: no rows returned.")
        appendLog("Query complete: no rows returned.")
        return
      }

      setQueryRows(result.data)
      setCurrentPage(1)
      setChartMessage("")
      setStatus("Query complete.")
      appendLog(`Query complete. Rendered ${result.data.length} rows.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      if (message.includes("file is not transformed yet")) {
        const blockedMessage = "Query blocked: file is not transformed yet. Run dbt transform first."
        setCanQuery(false)
        setStatus(blockedMessage)
        appendLog(blockedMessage)
      } else {
        setQueryRows([])
        setStatus(`Query failed: ${message}`)
        appendLog(`Query failed: ${message}`)
        setChartMessage(`Query failed: ${message}`)
      }
    } finally {
      setIsQuerying(false)
    }
  }

  function handleAnalyze() {
    setIsAnalyzing(true)
    setAnalysisError(null)

    try {
      const result = analyzeLatencyRows(queryRows, analysisControls)
      setAnomalyPoints(result.points)
      setAnomalyThresholdMs(result.thresholdMs)
      setAnomalyCount(result.anomalyCount)
      setAnomalyReasonCounts(result.reasonCounts)

      if (result.points.length === 0) {
        const message = "Analyze complete: no latency values were available to evaluate."
        setStatus(message)
        appendLog(message)
      } else {
        const thresholdLabel = result.thresholdMs == null ? "n/a" : `${result.thresholdMs.toFixed(2)}ms`
        const message = `Analyze complete: ${result.anomalyCount} anomalies found (latency: ${result.reasonCounts.latency}, high volume IP: ${result.reasonCounts.high_volume_ip}, burst IP: ${result.reasonCounts.burst_ip}, EWMA bursts: ${result.reasonCounts.ewma_burst}, CUSUM shifts: ${result.reasonCounts.cusum_shift}, latency threshold ${thresholdLabel}).`
        setStatus(message)
        appendLog(message)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      setAnalysisError(message)
      setStatus(`Analyze failed: ${message}`)
      appendLog(`Analyze failed: ${message}`)
    } finally {
      setIsAnalyzing(false)
    }
  }

  function applyAnalysisPreset() {
    setAnalysisControls(ANALYSIS_PRESETS[selectedAnalysisPreset])
    appendLog(`Applied anomaly preset: ${selectedAnalysisPreset}.`)
    setStatus(`Applied anomaly preset: ${selectedAnalysisPreset}.`)
  }

  const queryColumns = queryRows.length === 0
    ? []
    : Object.keys(queryRows[0]).filter((column) => column !== "partition_endpoint" && column !== "partition_date" && column !== "event_id").sort((left, right) => {
        const order: Record<string, number> = {
          timestamp: 1,
          partition_domain: 2,
          partition_request: 3,
          request_method: 4,
          request_label: 5,
          response_status: 6,
          response_time_ms: 7,
          request_size_bytes: 8,
          response_size_bytes: 9,
          ip_address: 10,
        }

        return (order[left] ?? 50) - (order[right] ?? 50)
      })

  const sortedQueryRows = [...queryRows].sort((leftRow, rightRow) => compareRows(leftRow, rightRow, sortColumn, sortDirection))
  const totalPages = Math.max(1, Math.ceil(sortedQueryRows.length / rowsPerPage))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const startIndex = (safeCurrentPage - 1) * rowsPerPage
  const pagedQueryRows = sortedQueryRows.slice(startIndex, startIndex + rowsPerPage)

  function handleSort(column: string) {
    if (sortColumn === column) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
      return
    }

    setSortColumn(column)
    setSortDirection(column === "timestamp" ? "desc" : "asc")
  }

  function handleRowsPerPageChange(value: number) {
    const nextValue = Math.max(10, Math.min(500, Math.floor(value)))
    setRowsPerPage(nextValue)
    setCurrentPage(1)
  }

  return (
    <>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Sanity Log Explorer</CardTitle>
          <CardDescription>
            Upload a large NDJSON log file, run dbt transforms, and explore partitions by date, domain, request, and endpoint.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="mb-4">
        <CardContent className="grid gap-4 pt-4">
          <label className="grid gap-2 text-sm font-medium">
            NDJSON file
            <input
              ref={fileInputRef}
              type="file"
              accept=".ndjson,.jsonl,.json,.log"
              className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
            />
          </label>

          <div className="grid gap-2 text-sm font-medium">
            <span>Load previous session</span>
            <div className="flex flex-wrap gap-2">
              <select
                className="h-9 min-w-80 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={selectedSessionId}
                onChange={(event) => setSelectedSessionId(event.target.value)}
              >
                <option value="">Select a previous import session</option>
                {sessionHistory.map((session) => (
                  <option key={session.id} value={session.id}>
                    {formatSessionLabel(session)}
                  </option>
                ))}
              </select>

              <Button variant="secondary" onClick={handleLoadPreviousSession} disabled={!selectedSessionId}>
                Load Previous Session
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleUpload} disabled={isUploading}>
              Upload + Ingest
            </Button>
            <Button variant="secondary" onClick={handleTransform} disabled={!canTransform || isTransforming}>
              Transform (dbt)
            </Button>
            <Button variant="destructive" onClick={clearData} disabled={isClearing}>
              Clear Data
            </Button>
          </div>

          <div className="space-y-1.5">
            <Progress value={progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} />
            <p className="text-sm text-muted-foreground">{progressText}</p>
          </div>

          <div className="text-sm text-muted-foreground">{status}</div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-xl">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium">
              Date
              <select
                multiple
                size={6}
                className="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={selected.dates}
                onChange={(event) => setSelected((prev) => ({ ...prev, dates: getSelectedValues(event) }))}
              >
                {options.dates.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Domain
              <select
                multiple
                size={6}
                className="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={selected.domains}
                onChange={(event) => setSelected((prev) => ({ ...prev, domains: getSelectedValues(event) }))}
              >
                {options.domains.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Request
              <select
                multiple
                size={6}
                className="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={selected.requests}
                onChange={(event) => setSelected((prev) => ({ ...prev, requests: getSelectedValues(event) }))}
              >
                {options.requests.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

          </div>

          <p className="text-sm text-muted-foreground">
            Query returns raw rows that match your selected filters.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleQuery} disabled={!canQuery || isQuerying}>
              Run Query
            </Button>
            <Button variant="outline" onClick={resetFilters}>
              Reset Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-xl">Results Table ({queryRows.length} rows)</CardTitle>
        </CardHeader>
        <CardContent>
          {queryRows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    {queryColumns.map((column) => (
                      <th key={column} className="px-3 py-2 font-medium text-foreground">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-left hover:text-foreground"
                          onClick={() => handleSort(column)}
                          aria-label={`Sort by ${columnLabel(column)} ${sortColumn === column && sortDirection === "asc" ? "descending" : "ascending"}`}
                        >
                          <span>{columnLabel(column)}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {sortColumn === column ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-background">
                  {pagedQueryRows.map((row, index) => (
                    <tr key={`${index}-${String(row.event_id ?? row.timestamp ?? "")}`}>
                      {queryColumns.map((column) => (
                        <td key={`${index}-${column}`} className="px-3 py-2 text-muted-foreground">
                          {formatCellValue(column, row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {queryRows.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <div>
                Showing {startIndex + 1}-{Math.min(startIndex + rowsPerPage, sortedQueryRows.length)} of {sortedQueryRows.length} rows
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2">
                  Rows per page
                  <select
                    className="h-8 rounded-md border border-input bg-transparent px-2"
                    value={rowsPerPage}
                    onChange={(event) => handleRowsPerPageChange(Number(event.target.value))}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={250}>250</option>
                  </select>
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={safeCurrentPage <= 1}
                >
                  Previous
                </Button>
                <span>
                  Page {safeCurrentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={safeCurrentPage >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
          {chartMessage ? <p className="mt-3 text-sm text-muted-foreground">{chartMessage}</p> : null}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-xl">Anomalies ({anomalyCount} anomalies)</CardTitle>
          <CardDescription>
            Highlights latency, high-volume IP, and burst traffic anomalies from the current query results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
            <label className="grid gap-1 text-sm font-medium">
              Anomaly preset
              <select
                className="h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={selectedAnalysisPreset}
                onChange={(event) => setSelectedAnalysisPreset(event.target.value as AnalysisPresetName)}
              >
                <option value="Conservative">Conservative</option>
                <option value="Balanced">Balanced</option>
                <option value="Aggressive">Aggressive</option>
              </select>
            </label>
            <Button variant="outline" onClick={applyAnalysisPreset}>
              Apply Preset
            </Button>
          </div>
          <div className="mb-3 grid grid-cols-1 gap-3 rounded-md border border-border p-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-1 text-sm font-medium">
              Latency sensitivity (IQR)
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                className="h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={analysisControls.latencyIqrMultiplier}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setAnalysisControls((prev) => ({
                    ...prev,
                    latencyIqrMultiplier: Number.isFinite(value) ? Math.max(0.1, value) : prev.latencyIqrMultiplier,
                  }))
                }}
              />
            </label>

            <label className="grid gap-1 text-sm font-medium">
              IP volume sensitivity (IQR)
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                className="h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={analysisControls.ipVolumeIqrMultiplier}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setAnalysisControls((prev) => ({
                    ...prev,
                    ipVolumeIqrMultiplier: Number.isFinite(value) ? Math.max(0.1, value) : prev.ipVolumeIqrMultiplier,
                  }))
                }}
              />
            </label>

            <label className="grid gap-1 text-sm font-medium">
              Burst sensitivity (IQR)
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                className="h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={analysisControls.burstIqrMultiplier}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setAnalysisControls((prev) => ({
                    ...prev,
                    burstIqrMultiplier: Number.isFinite(value) ? Math.max(0.1, value) : prev.burstIqrMultiplier,
                  }))
                }}
              />
            </label>

            <label className="grid gap-1 text-sm font-medium">
              Burst window (minutes)
              <input
                type="number"
                min={1}
                max={60}
                step={1}
                className="h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={analysisControls.burstWindowMinutes}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setAnalysisControls((prev) => ({
                    ...prev,
                    burstWindowMinutes: Number.isFinite(value) ? Math.max(1, Math.floor(value)) : prev.burstWindowMinutes,
                  }))
                }}
              />
            </label>

            <label className="grid gap-1 text-sm font-medium">
              Min requests for high-volume IP
              <input
                type="number"
                min={2}
                max={100000}
                step={1}
                className="h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={analysisControls.minIpVolumeCount}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setAnalysisControls((prev) => ({
                    ...prev,
                    minIpVolumeCount: Number.isFinite(value) ? Math.max(2, Math.floor(value)) : prev.minIpVolumeCount,
                  }))
                }}
              />
            </label>

            <label className="grid gap-1 text-sm font-medium">
              Min requests for burst bucket
              <input
                type="number"
                min={2}
                max={100000}
                step={1}
                className="h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={analysisControls.minBurstCount}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setAnalysisControls((prev) => ({
                    ...prev,
                    minBurstCount: Number.isFinite(value) ? Math.max(2, Math.floor(value)) : prev.minBurstCount,
                  }))
                }}
              />
            </label>

            <label className="grid gap-1 text-sm font-medium">
              EWMA alpha
              <input
                type="number"
                min={0.05}
                max={0.95}
                step={0.05}
                className="h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={analysisControls.ewmaAlpha}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setAnalysisControls((prev) => ({
                    ...prev,
                    ewmaAlpha: Number.isFinite(value) ? Math.min(0.95, Math.max(0.05, value)) : prev.ewmaAlpha,
                  }))
                }}
              />
            </label>

            <label className="grid gap-1 text-sm font-medium">
              EWMA residual threshold (sigma)
              <input
                type="number"
                min={0.5}
                max={10}
                step={0.1}
                className="h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={analysisControls.ewmaStdDevMultiplier}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setAnalysisControls((prev) => ({
                    ...prev,
                    ewmaStdDevMultiplier: Number.isFinite(value)
                      ? Math.max(0.5, value)
                      : prev.ewmaStdDevMultiplier,
                  }))
                }}
              />
            </label>

            <label className="grid gap-1 text-sm font-medium">
              CUSUM drift
              <input
                type="number"
                min={0}
                max={1000}
                step={0.1}
                className="h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={analysisControls.cusumDrift}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setAnalysisControls((prev) => ({
                    ...prev,
                    cusumDrift: Number.isFinite(value) ? Math.max(0, value) : prev.cusumDrift,
                  }))
                }}
              />
            </label>

            <label className="grid gap-1 text-sm font-medium">
              CUSUM threshold
              <input
                type="number"
                min={0.5}
                max={1000}
                step={0.5}
                className="h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={analysisControls.cusumThreshold}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setAnalysisControls((prev) => ({
                    ...prev,
                    cusumThreshold: Number.isFinite(value) ? Math.max(0.5, value) : prev.cusumThreshold,
                  }))
                }}
              />
            </label>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={handleAnalyze}
              disabled={!canQuery || queryRows.length === 0 || isAnalyzing}
            >
              Analyze
            </Button>
          </div>
          {analysisError ? <p className="mb-3 text-sm text-destructive">Analyze failed: {analysisError}</p> : null}
          {anomalyPoints.length > 0 ? (
            <p className="mb-3 text-sm text-muted-foreground">
              Breakdown: latency {anomalyReasonCounts.latency}, high volume IP {anomalyReasonCounts.high_volume_ip}, burst IP {anomalyReasonCounts.burst_ip}, EWMA bursts {anomalyReasonCounts.ewma_burst}, CUSUM shifts {anomalyReasonCounts.cusum_shift}.
            </p>
          ) : null}
          {anomalyPoints.length > 0 ? (
            <AnomalyChart points={anomalyPoints} bucketMinutes={analysisControls.burstWindowMinutes} />
          ) : (
            <p className="text-sm text-muted-foreground">Run Analyze after querying to render anomaly highlights.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Process Log</CardTitle>
          <CardDescription>Latest workflow events are shown below the results table.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-muted/20 p-3 font-mono text-xs text-muted-foreground">
            {processLog.map((entry, index) => (
              <p key={`${entry}-${index}`} className="m-0 py-0.5">
                {entry}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  )
}
