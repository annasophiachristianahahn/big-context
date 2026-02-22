"use client";

import type { CostEstimate } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CostEstimatorProps {
  estimate: CostEstimate;
  open: boolean;
  onConfirm: (enableStitch: boolean) => void;
  onCancel: () => void;
}

export function CostEstimator({
  estimate,
  open,
  onConfirm,
  onCancel,
}: CostEstimatorProps) {
  const isHighChunkCount = estimate.totalChunks > 20;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Big Context Processing</DialogTitle>
          <DialogDescription>
            Review the processing estimate before proceeding.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-4 text-sm">
          <div className="text-muted-foreground">Model</div>
          <div className="font-medium">{estimate.modelName}</div>

          <div className="text-muted-foreground">Chunks</div>
          <div className="font-mono">
            {estimate.totalChunks}
            {estimate.totalChunks > 1 && (
              <span className="text-muted-foreground font-sans text-xs ml-1">
                ({estimate.totalChunks} API calls)
              </span>
            )}
          </div>

          <div className="text-muted-foreground">Est. Input Tokens</div>
          <div className="font-mono">
            {estimate.estimatedInputTokens.toLocaleString()}
          </div>

          <div className="text-muted-foreground">Est. Output Tokens</div>
          <div className="font-mono">
            {estimate.estimatedOutputTokens.toLocaleString()}
          </div>

          <div className="text-muted-foreground font-medium">Est. Cost</div>
          <div className="font-mono font-semibold">
            ${estimate.estimatedCost.toFixed(4)}
          </div>
        </div>

        {/* High chunk count warning */}
        {isHighChunkCount && (
          <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 space-y-1">
            <p className="font-semibold">
              High chunk count ({estimate.totalChunks} chunks)
            </p>
            <p>
              This model has a limited max output per call, requiring many small chunks.
              Consider using a model with a larger output limit (e.g., Gemini Flash, Claude Sonnet)
              to reduce the number of API calls and improve quality.
            </p>
          </div>
        )}

        {estimate.estimatedCost > 1 && (
          <p className="text-sm text-destructive">
            This may be expensive. Review carefully before proceeding.
          </p>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(estimate.totalChunks > 1)}>
            Process ({estimate.totalChunks} chunk{estimate.totalChunks > 1 ? "s" : ""})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
