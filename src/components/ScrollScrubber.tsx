"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  useScrollScrubber,
  type SectionMarker,
} from "@/hooks/use-scroll-scrubber";

interface ScrollScrubberProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onDraggingChange?: (isDragging: boolean) => void;
}

const TRACK_WIDTH = 8;
const THUMB_HEIGHT = 40;
const TICK_WIDTH = 14;
const TOOLTIP_GAP = 8;
const TRACK_PADDING_Y = 8;

export const ScrollScrubber = React.memo(function ScrollScrubber({
  scrollRef,
  contentRef,
  onDraggingChange,
}: ScrollScrubberProps) {
  const {
    scrollRatio,
    isVisible,
    sectionMarkers,
    scrollToRatio,
    isDragging,
    setIsDragging,
    containerBounds,
  } = useScrollScrubber(scrollRef, contentRef);

  const [isHovering, setIsHovering] = useState(false);
  const [tooltipMarker, setTooltipMarker] = useState<SectionMarker | null>(
    null
  );
  const [tooltipY, setTooltipY] = useState(0);
  const [mounted, setMounted] = useState(false);

  const trackElRef = useRef<HTMLDivElement>(null);
  const onDraggingChangeRef = useRef(onDraggingChange);

  useEffect(() => {
    onDraggingChangeRef.current = onDraggingChange;
  }, [onDraggingChange]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Notify parent when dragging state changes
  useEffect(() => {
    onDraggingChangeRef.current?.(isDragging);
  }, [isDragging]);

  // --- Pointer event handlers for drag ---
  const ratioFromPointerY = useCallback(
    (clientY: number): number => {
      if (!containerBounds) return 0;
      const trackTop = containerBounds.top + TRACK_PADDING_Y;
      const usableHeight =
        containerBounds.height - TRACK_PADDING_Y * 2 - THUMB_HEIGHT;
      if (usableHeight <= 0) return 0;
      return Math.max(
        0,
        Math.min(1, (clientY - trackTop - THUMB_HEIGHT / 2) / usableHeight)
      );
    },
    [containerBounds]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      // Capture on the track container so pointermove/up are always received
      trackElRef.current?.setPointerCapture(e.pointerId);

      const ratio = ratioFromPointerY(e.clientY);
      scrollToRatio(ratio);
    },
    [ratioFromPointerY, scrollToRatio, setIsDragging]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      const ratio = ratioFromPointerY(e.clientY);
      scrollToRatio(ratio);

      // Find nearest marker for tooltip during drag
      if (sectionMarkers.length > 0) {
        let nearest: SectionMarker | null = null;
        let minDist = Infinity;
        for (const m of sectionMarkers) {
          const dist = Math.abs(m.position - ratio);
          if (dist < minDist) {
            minDist = dist;
            nearest = m;
          }
        }
        if (nearest && minDist < 0.05) {
          setTooltipMarker(nearest);
          setTooltipY(e.clientY);
        } else {
          setTooltipMarker(null);
        }
      }
    },
    [isDragging, ratioFromPointerY, scrollToRatio, sectionMarkers]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isDragging) {
        setIsDragging(false);
        trackElRef.current?.releasePointerCapture(e.pointerId);
        setTooltipMarker(null);
      }
    },
    [isDragging, setIsDragging]
  );

  // --- Tick hover handler ---
  const handleTickHover = useCallback(
    (marker: SectionMarker | null, clientY?: number) => {
      setTooltipMarker(marker);
      if (clientY !== undefined) setTooltipY(clientY);
    },
    []
  );

  // Don't render if not enough content to scroll or not yet mounted (SSR safety)
  if (!isVisible || !containerBounds || !mounted) return null;

  const usableHeight =
    containerBounds.height - TRACK_PADDING_Y * 2 - THUMB_HEIGHT;
  const thumbTop =
    containerBounds.top + TRACK_PADDING_Y + scrollRatio * usableHeight;
  const scrubberRight = 6; // px from right edge of viewport area
  const scrubberLeft =
    containerBounds.right - TRACK_WIDTH - scrubberRight;

  const isActive = isHovering || isDragging;

  const scrubberUI = (
    <>
      {/* Scrubber track — fixed to right edge of scroll container */}
      <div
        ref={trackElRef}
        className="fixed z-50 select-none transition-opacity duration-200"
        style={{
          top: containerBounds.top,
          left: scrubberLeft - TICK_WIDTH,
          width: TRACK_WIDTH + TICK_WIDTH + 4,
          height: containerBounds.height,
          opacity: isActive ? 1 : 0.35,
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => {
          setIsHovering(false);
          if (!isDragging) setTooltipMarker(null);
        }}
      >
        {/* Track background line */}
        <div
          className="absolute rounded-full bg-muted-foreground/20 dark:bg-muted-foreground/15"
          style={{
            top: TRACK_PADDING_Y,
            right: 0,
            width: TRACK_WIDTH,
            height: containerBounds.height - TRACK_PADDING_Y * 2,
          }}
        />

        {/* Section tick marks */}
        {sectionMarkers.map((marker, i) => {
          const tickTop =
            TRACK_PADDING_Y +
            marker.position * usableHeight +
            THUMB_HEIGHT / 2;
          return (
            <div
              key={i}
              className="absolute"
              style={{
                top: tickTop - 1,
                right: TRACK_WIDTH - 1,
                width: TICK_WIDTH,
                height: 2,
                backgroundColor: isActive
                  ? "hsl(var(--primary) / 0.5)"
                  : "hsl(var(--primary) / 0.2)",
                borderRadius: 1,
                transition: "background-color 150ms",
              }}
              onMouseEnter={(e) => handleTickHover(marker, e.clientY)}
              onMouseLeave={() => {
                if (!isDragging) handleTickHover(null);
              }}
            />
          );
        })}

        {/* Draggable thumb */}
        <div
          className="absolute rounded-full"
          style={{
            top: thumbTop - containerBounds.top,
            right: 0,
            width: TRACK_WIDTH,
            height: THUMB_HEIGHT,
            backgroundColor: isDragging
              ? "hsl(var(--primary))"
              : isHovering
              ? "hsl(var(--muted-foreground) / 0.6)"
              : "hsl(var(--muted-foreground) / 0.35)",
            cursor: isDragging ? "grabbing" : "grab",
            transition: "background-color 150ms",
          }}
        />
      </div>

      {/* Tooltip — shows section label on hover/drag */}
      {tooltipMarker && isActive && (
        <div
          className="fixed z-[60] pointer-events-none px-2.5 py-1 rounded-md text-xs font-medium bg-popover text-popover-foreground shadow-md border border-border/50 truncate"
          style={{
            top: tooltipY - 14,
            right:
              window.innerWidth -
              scrubberLeft +
              TICK_WIDTH +
              TOOLTIP_GAP,
            maxWidth: 220,
            whiteSpace: "nowrap",
          }}
        >
          {tooltipMarker.label}
        </div>
      )}
    </>
  );

  // Render via portal to avoid parent transform/overflow clipping issues
  return createPortal(scrubberUI, document.body);
});
