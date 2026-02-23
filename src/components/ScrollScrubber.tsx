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

const TRACK_WIDTH = 18;
const THUMB_WIDTH = 28;
const THUMB_HEIGHT = 56;
const TICK_WIDTH = 24;
const TOOLTIP_GAP = 12;
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
  const scrubberRight = 4; // px from right edge of viewport area
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
          left: scrubberLeft - TICK_WIDTH - 4,
          width: TRACK_WIDTH + TICK_WIDTH + THUMB_WIDTH,
          height: containerBounds.height,
          opacity: isActive ? 1 : 0.85,
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
          className="absolute rounded-full"
          style={{
            top: TRACK_PADDING_Y,
            right: (THUMB_WIDTH - TRACK_WIDTH) / 2,
            width: TRACK_WIDTH,
            height: containerBounds.height - TRACK_PADDING_Y * 2,
            backgroundColor: "hsl(var(--muted-foreground) / 0.2)",
            border: "1px solid hsl(var(--muted-foreground) / 0.15)",
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
                top: tickTop - 1.5,
                right: (THUMB_WIDTH - TRACK_WIDTH) / 2 + TRACK_WIDTH - 2,
                width: TICK_WIDTH,
                height: 3,
                backgroundColor: isActive
                  ? "hsl(var(--primary) / 0.8)"
                  : "hsl(var(--primary) / 0.5)",
                borderRadius: 1.5,
                transition: "background-color 150ms",
              }}
              onMouseEnter={(e) => handleTickHover(marker, e.clientY)}
              onMouseLeave={() => {
                if (!isDragging) handleTickHover(null);
              }}
            />
          );
        })}

        {/* Draggable thumb — WHITE on dark, BLACK on light. Impossible to miss. */}
        <div
          className="absolute rounded-lg flex items-center justify-center bg-black dark:bg-white"
          style={{
            top: thumbTop - containerBounds.top,
            right: 0,
            width: THUMB_WIDTH,
            height: THUMB_HEIGHT,
            cursor: isDragging ? "grabbing" : "grab",
            transition: "box-shadow 150ms",
            boxShadow: isDragging
              ? "0 0 16px rgba(255,255,255,0.7), 0 2px 8px rgba(0,0,0,0.4)"
              : "0 2px 8px rgba(0,0,0,0.4), 0 0 4px rgba(255,255,255,0.2)",
            border: "2px solid rgba(128,128,128,0.3)",
          }}
        >
          {/* Grip lines */}
          <div className="flex flex-col gap-[4px] items-center">
            <div className="bg-white dark:bg-black" style={{ width: 12, height: 2, borderRadius: 1, opacity: 0.7 }} />
            <div className="bg-white dark:bg-black" style={{ width: 12, height: 2, borderRadius: 1, opacity: 0.7 }} />
            <div className="bg-white dark:bg-black" style={{ width: 12, height: 2, borderRadius: 1, opacity: 0.7 }} />
          </div>
        </div>
      </div>

      {/* Tooltip — shows section label on hover/drag */}
      {tooltipMarker && isActive && (
        <div
          className="fixed z-[60] pointer-events-none px-3 py-1.5 rounded-md text-xs font-medium bg-popover text-popover-foreground shadow-lg border border-border truncate"
          style={{
            top: tooltipY - 16,
            right:
              window.innerWidth -
              scrubberLeft +
              TICK_WIDTH +
              TOOLTIP_GAP,
            maxWidth: 240,
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
