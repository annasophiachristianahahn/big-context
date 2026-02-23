"use client";

import { useState, useEffect, useRef } from "react";
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
  const [resuming, setResuming] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [autoResumeAttempted, setAutoResumeAttempted] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [startTime] = useState(() => Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const completedRef = useRef(false);

  // Use refs for callbacks to avoid re-creating EventSource when callbacks change
  // This is CRITICAL — without it, React Query invalidation triggers refreshChat change,
  // which changes onComplete/onCancel, which re-creates the useCallback, which re-runs
  // the connect effect, which closes and reopens EventSource unnecessarily.
  const onCompleteRef = useRef(onComplete);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  // Elapsed time ticker
  useEffect(() => {
    const interval = setInterval(() => {
      if (!completedRef.current) {
        setElapsedMs(Date.now() - startTime);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Single stable connect function — no callback deps
  useEffect(() => {
    function connect() {
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

        // --- Staleness detection ---
        // If the SSE reports the job is stale (no progress for 3+ min),
        // auto-resume it once. This handles server redeployments.
        if (data.isStale) {
          setIsStale(true);
        } else {
          setIsStale(false);
        }

        // Completion: check status, NOT stitchedOutput truthiness
        // (empty string "" is falsy but is a valid completion — e.g., all chunks failed)
        if (data.status === "completed" || data.status === "failed") {
          completedRef.current = true;
          // Use stitchedOutput if present, otherwise empty string
          onCompleteRef.current(data.stitchedOutput ?? "");
        }

        if (data.status === "cancelled") {
          completedRef.current = true;
          eventSource.close();
          onCancelRef.current();
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
    }

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [jobId]); // Only depend on jobId — callbacks via refs

  // Auto-resume stale jobs once
  useEffect(() => {
    if (isStale && !autoResumeAttempted && !resuming) {
      setAutoResumeAttempted(true);
      console.log(`[BigContext] Job ${jobId} is stale — auto-resuming...`);
      handleResume();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStale, autoResumeAttempted]);

  async function handleResume() {
    setResuming(true);
    try {
      const res = await fetch(`/api/chunk-process/${jobId}/resume`, {
        method: "POST",
      });
      if (res.ok) {
        setIsStale(false);
        // The SSE stream will pick up the resumed processing automatically
        console.log(`[BigContext] Job ${jobId} resumed successfully`);
      } else {
        console.error(`[BigContext] Resume failed:`, await res.text());
      }
    } catch (error) {
      console.error("Resume failed:", error);
    } finally {
      setResuming(false);
    }
  }

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
        // Reconnect will happen via the effect when needed
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
  const processingCount = status.chunks.filter((c) => c.status === "processing").length;
  const isStitching = status.status === "stitching";
  const isActive = status.status === "processing" || isStitching;
  const isCancelled = status.status === "cancelled";
  const isCompleted = status.status === "completed";
  const isDone = isCompleted || status.status === "failed" || isCancelled;

  // Show when chunks are processing but none have completed yet (API calls in flight)
  const isWaitingForApi = isActive && !isStitching && status.completedChunks === 0 && processingCount > 0;

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
            : isStitching
            ? "Stitching Results..."
            : "Processing Chunks"}
        </h3>
        <div className="flex items-center gap-2">
          {isActive && !isStitching && (
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

      {/* Stitching indicator */}
      {isStitching && (
        <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          All {status.totalChunks} chunks processed. Stitching outputs into a cohesive result...
        </div>
      )}

      {/* Stale/orphaned job indicator */}
      {isStale && (
        <div className="flex items-center gap-2 text-sm text-orange-600 dark:text-orange-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span>
            {resuming
              ? "Resuming processing..."
              : autoResumeAttempted
              ? "Job appears stuck — auto-resume attempted. If still stuck:"
              : "Job appears stuck (server may have restarted)"}
          </span>
          {!resuming && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResume}
              className="h-6 text-xs ml-2"
            >
              Resume
            </Button>
          )}
        </div>
      )}

      {/* Waiting for API indicator — shows when chunks are sent but none have returned yet */}
      {isWaitingForApi && (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>
            {processingCount} chunk{processingCount > 1 ? "s" : ""} sent to {status.model?.split("/").pop() ?? "model"} — waiting for responses...
            {elapsedMs > 60000 && <span className="text-muted-foreground ml-1">(large documents can take 2-5 min per chunk)</span>}
          </span>
        </div>
      )}

      {/* Progress stats bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {status.completedChunks}/{status.totalChunks} chunks ({percentage}%)
        </span>
        <div className="flex items-center gap-3">
          <span>Elapsed: {formatDuration(elapsedMs)}</span>
          {status.status === "processing" && estimatedRemaining !== null && (
            <span>~{formatDuration(estimatedRemaining)} remaining</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <Progress value={isStitching ? 100 : percentage} className="h-2" />

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
