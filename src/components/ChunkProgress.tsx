"use client";

import { useState, useEffect, useCallback } from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { ChunkJobStatus } from "@/types";

interface ChunkProgressProps {
  jobId: string;
  onComplete: (output: string) => void;
  onCancel: () => void;
}

export function ChunkProgress({ jobId, onComplete, onCancel }: ChunkProgressProps) {
  const [status, setStatus] = useState<ChunkJobStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const connect = useCallback(() => {
    const eventSource = new EventSource(
      `/api/chunk-process/${jobId}/stream`
    );

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.done) {
        eventSource.close();
        return;
      }
      if (data.error) {
        eventSource.close();
        return;
      }
      setStatus(data);
      if (
        (data.status === "completed" || data.status === "failed") &&
        data.stitchedOutput
      ) {
        onComplete(data.stitchedOutput);
      }
      if (data.status === "cancelled") {
        eventSource.close();
        onCancel();
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return eventSource;
  }, [jobId, onComplete, onCancel]);

  useEffect(() => {
    const es = connect();
    return () => es.close();
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

  if (!status) {
    return (
      <div className="mx-4 mb-4 p-4 rounded-xl bg-muted shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm">Starting processing...</p>
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

  const failedChunks = status.chunks.filter((c) => c.status === "failed");
  const isActive = status.status === "processing";
  const isCancelled = status.status === "cancelled";

  return (
    <div className="mx-4 mb-4 p-4 rounded-xl border bg-muted/50 space-y-3 shrink-0">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">
          {isCancelled ? "Processing Cancelled" : "Processing Chunks"}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {status.completedChunks}/{status.totalChunks} ({percentage}%)
          </span>
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

      <Progress value={percentage} className="h-2" />

      {/* Chunk status dots */}
      <div className="flex flex-wrap gap-1">
        {status.chunks.map((chunk) => (
          <div
            key={chunk.index}
            className={`w-3 h-3 rounded-full transition-colors ${
              chunk.status === "completed"
                ? "bg-green-500"
                : chunk.status === "processing"
                ? "bg-blue-500 animate-pulse"
                : chunk.status === "failed"
                ? "bg-red-500"
                : chunk.status === "cancelled"
                ? "bg-yellow-500"
                : "bg-muted-foreground/30"
            }`}
            title={`Chunk ${chunk.index + 1}: ${chunk.status}${
              chunk.error ? ` - ${chunk.error}` : ""
            }`}
          />
        ))}
      </div>

      {/* Cancelled notice */}
      {isCancelled && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Processing was stopped. {status.completedChunks} of {status.totalChunks} chunks completed.
        </p>
      )}

      {/* Failed chunks + retry */}
      {failedChunks.length > 0 && !isActive && !isCancelled && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-destructive">
            {failedChunks.length} chunk(s) failed
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
      {(status.status === "completed" || isCancelled) && status.stitchedOutput && (
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
