"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { ChunkJobStatus } from "@/types";

interface ChunkProgressProps {
  jobId: string;
  onComplete: (output: string) => void;
  onCancel: () => void;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function ChunkProgress({ jobId, onComplete, onCancel }: ChunkProgressProps) {
  const [status, setStatus] = useState<ChunkJobStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [startTime] = useState(() => Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const completedRef = useRef(false);

  // Elapsed time ticker
  useEffect(() => {
    const interval = setInterval(() => {
      if (!completedRef.current) {
        setElapsedMs(Date.now() - startTime);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const connect = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(
      `/api/chunk-process/${jobId}/stream`
    );
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.done) {
        completedRef.current = true;
        eventSource.close();
        return;
      }

      if (data.error) {
        eventSource.close();
        return;
      }

      // Reset reconnect counter on successful message
      reconnectAttemptRef.current = 0;

      setStatus(data);

      if (
        (data.status === "completed" || data.status === "failed") &&
        data.stitchedOutput
      ) {
        completedRef.current = true;
        setElapsedMs(Date.now() - startTime);
        onComplete(data.stitchedOutput);
      }

      if (data.status === "cancelled") {
        completedRef.current = true;
        setElapsedMs(Date.now() - startTime);
        eventSource.close();
        onCancel();
      }
    };

    eventSource.onerror = () => {
      eventSource.close();

      // Don't reconnect if completed
      if (completedRef.current) return;

      // Auto-reconnect with exponential backoff (max 10s)
      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      reconnectAttemptRef.current = attempt + 1;

      reconnectTimeoutRef.current = setTimeout(() => {
        if (!completedRef.current) {
          connect();
        }
      }, delay);
    };

    return eventSource;
  }, [jobId, onComplete, onCancel, startTime]);

  useEffect(() => {
    const es = connect();
    return () => {
      es.close();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  async function handleCancel() {
    setCancelling(true);
    try {
      await fetch(`/api/chunk-process/${jobId}/cancel`, {
        method: "POST",
      });
    } catch (error) {
      console.error("Cancel failed:", error);
    } finally {
      setCancelling(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/chunk-process/${jobId}/retry`, {
        method: "POST",
      });
      if (res.ok) {
        completedRef.current = false;
        connect();
      }
    } finally {
      setRetrying(false);
    }
  }

  function handleExport(format: "txt" | "md") {
    if (!status?.stitchedOutput) return;
    const blob = new Blob([status.stitchedOutput], {
      type: format === "md" ? "text/markdown" : "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `big-context-output.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Estimated time remaining
  const estimatedRemaining = status && status.completedChunks > 0
    ? Math.round(
        (elapsedMs / status.completedChunks) *
          (status.totalChunks - status.completedChunks)
      )
    : null;

  if (!status) {
    return (
      <div className="mx-4 mb-4 p-4 rounded-xl bg-muted shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm">Connecting to processing stream...</p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleCancel}
            disabled={cancelling}
            className="h-7 text-xs"
          >
            {cancelling ? "Cancelling..." : "Stop"}
          </Button>
        </div>
      </div>
    );
  }

  const percentage =
    status.totalChunks > 0
      ? Math.round((status.completedChunks / status.totalChunks) * 100)
      : 0;

  const failedCount = status.failedChunks ?? status.chunks.filter((c) => c.status === "failed").length;
  const isActive = status.status === "processing";
  const isCancelled = status.status === "cancelled";
  const isCompleted = status.status === "completed";
  const isDone = isCompleted || status.status === "failed" || isCancelled;

  return (
    <div className="mx-4 mb-4 p-4 rounded-xl border bg-muted/50 space-y-3 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">
          {isCancelled
            ? "Processing Cancelled"
            : isCompleted
            ? "Processing Complete"
            : status.status === "failed"
            ? "Processing Failed"
            : "Processing Chunks"}
        </h3>
        <div className="flex items-center gap-2">
          {isActive && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancel}
              disabled={cancelling}
              className="h-7 text-xs"
            >
              {cancelling ? "Cancelling..." : "Stop"}
            </Button>
          )}
        </div>
      </div>

      {/* Progress stats bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {status.completedChunks}/{status.totalChunks} chunks ({percentage}%)
        </span>
        <div className="flex items-center gap-3">
          <span>Elapsed: {formatDuration(elapsedMs)}</span>
          {isActive && estimatedRemaining !== null && (
            <span>~{formatDuration(estimatedRemaining)} remaining</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <Progress value={percentage} className="h-2" />

      {/* Chunk status dots - condensed for large counts */}
      {status.totalChunks <= 100 ? (
        <div className="flex flex-wrap gap-1">
          {status.chunks.map((chunk) => (
            <div
              key={chunk.index}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                chunk.status === "completed"
                  ? "bg-green-500"
                  : chunk.status === "processing"
                  ? "bg-blue-500 animate-pulse"
                  : chunk.status === "failed"
                  ? "bg-red-500"
                  : chunk.status === "cancelled"
                  ? "bg-yellow-500"
                  : "bg-muted-foreground/20"
              }`}
              title={`Chunk ${chunk.index + 1}: ${chunk.status}${
                chunk.error ? ` - ${chunk.error}` : ""
              }`}
            />
          ))}
        </div>
      ) : (
        // For >100 chunks, show a mini bar chart instead of individual dots
        <div className="flex gap-0.5 h-4 items-end">
          {(() => {
            const bucketCount = Math.min(status.totalChunks, 50);
            const bucketSize = Math.ceil(status.totalChunks / bucketCount);
            const buckets = [];
            for (let i = 0; i < bucketCount; i++) {
              const start = i * bucketSize;
              const end = Math.min(start + bucketSize, status.totalChunks);
              const bucketChunks = status.chunks.slice(start, end);
              const completed = bucketChunks.filter(c => c.status === "completed").length;
              const failed = bucketChunks.filter(c => c.status === "failed").length;
              const processing = bucketChunks.filter(c => c.status === "processing").length;
              const ratio = completed / bucketChunks.length;
              buckets.push(
                <div
                  key={i}
                  className={`flex-1 rounded-sm min-w-[3px] transition-all ${
                    failed > 0
                      ? "bg-red-500"
                      : processing > 0
                      ? "bg-blue-500 animate-pulse"
                      : ratio === 1
                      ? "bg-green-500"
                      : ratio > 0
                      ? "bg-green-500/50"
                      : "bg-muted-foreground/15"
                  }`}
                  style={{ height: `${Math.max(ratio * 100, 15)}%` }}
                  title={`Chunks ${start + 1}-${end}: ${completed}/${bucketChunks.length} completed`}
                />
              );
            }
            return buckets;
          })()}
        </div>
      )}

      {/* Live stats during processing */}
      {isActive && (status.totalTokens ?? 0) > 0 && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{(status.totalTokens ?? 0).toLocaleString()} tokens used</span>
          <span>${(status.totalCost ?? 0).toFixed(4)} cost so far</span>
        </div>
      )}

      {/* Cancelled notice */}
      {isCancelled && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Processing was stopped. {status.completedChunks} of {status.totalChunks} chunks completed.
        </p>
      )}

      {/* Processing summary on completion */}
      {isDone && !isCancelled && (
        <div className="border-t pt-3 mt-2">
          <h4 className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
            Processing Summary
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-lg font-semibold">{status.completedChunks - failedCount}</div>
              <div className="text-xs text-muted-foreground">Chunks OK</div>
            </div>
            {failedCount > 0 && (
              <div>
                <div className="text-lg font-semibold text-destructive">{failedCount}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
            )}
            <div>
              <div className="text-lg font-semibold">{(status.totalTokens ?? 0).toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Total Tokens</div>
            </div>
            <div>
              <div className="text-lg font-semibold">${(status.totalCost ?? 0).toFixed(4)}</div>
              <div className="text-xs text-muted-foreground">Total Cost</div>
            </div>
            <div>
              <div className="text-lg font-semibold">{formatDuration(elapsedMs)}</div>
              <div className="text-xs text-muted-foreground">Duration</div>
            </div>
          </div>
        </div>
      )}

      {/* Failed chunks + retry */}
      {failedCount > 0 && !isActive && !isCancelled && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-destructive">
            {failedCount} chunk(s) failed
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            disabled={retrying}
            className="h-7 text-xs"
          >
            {retrying ? "Retrying..." : "Retry Failed"}
          </Button>
        </div>
      )}

      {/* Export buttons */}
      {isDone && status.stitchedOutput && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("txt")}
            className="h-7 text-xs"
          >
            Export .txt
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("md")}
            className="h-7 text-xs"
          >
            Export .md
          </Button>
        </div>
      )}
    </div>
  );
}
