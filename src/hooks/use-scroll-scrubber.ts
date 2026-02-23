"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface SectionMarker {
  label: string;
  position: number; // 0–1 ratio within scrollable height
}

export interface UseScrollScrubberReturn {
  scrollRatio: number;
  isVisible: boolean;
  sectionMarkers: SectionMarker[];
  scrollToRatio: (ratio: number) => void;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  containerBounds: { top: number; height: number; right: number } | null;
}

export function useScrollScrubber(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  contentRef: React.RefObject<HTMLDivElement | null>
): UseScrollScrubberReturn {
  const [scrollRatio, setScrollRatio] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [sectionMarkers, setSectionMarkers] = useState<SectionMarker[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [containerBounds, setContainerBounds] = useState<{
    top: number;
    height: number;
    right: number;
  } | null>(null);

  const rafRef = useRef<number | null>(null);
  const markerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Scroll ratio tracking (rAF-throttled) ---
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      if (rafRef.current) return; // already scheduled
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (maxScroll <= 0) {
          setScrollRatio(0);
          setIsVisible(false);
          return;
        }
        setScrollRatio(el.scrollTop / maxScroll);
        // Also update visibility on scroll — content may have grown
        if (!isVisible && el.scrollHeight > el.clientHeight * 1.5) {
          setIsVisible(true);
        }
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scrollRef, isVisible]);

  // --- Visibility + bounds via ResizeObserver + MutationObserver ---
  // We need to detect when content loads asynchronously (e.g. messages from DB).
  // ResizeObserver on the scroll container won't fire because its own viewport
  // size doesn't change — only scrollHeight changes. So we also observe the
  // content element (which physically grows) and use a MutationObserver as
  // a fallback for DOM changes that don't trigger resize.
  useEffect(() => {
    const el = scrollRef.current;
    const contentEl = contentRef.current;
    if (!el) return;

    const update = () => {
      const visible = el.scrollHeight > el.clientHeight * 1.5;
      setIsVisible(visible);
      const rect = el.getBoundingClientRect();
      setContainerBounds((prev) => {
        if (
          prev &&
          prev.top === rect.top &&
          prev.height === rect.height &&
          prev.right === rect.right
        )
          return prev;
        return { top: rect.top, height: rect.height, right: rect.right };
      });
    };

    update();

    // Observe both scroll container and content element for size changes
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (contentEl) ro.observe(contentEl);

    // MutationObserver catches DOM changes (new messages added) that cause
    // scrollHeight to grow even when no resize event fires
    const mo = new MutationObserver(() => {
      // Debounce slightly to batch rapid DOM changes
      requestAnimationFrame(update);
    });
    if (contentEl) {
      mo.observe(contentEl, { childList: true, subtree: true });
    }

    // Periodic fallback: check every 2s in case observers miss something
    // (e.g. images loading, lazy content, etc.)
    const interval = setInterval(update, 2000);

    return () => {
      ro.disconnect();
      mo.disconnect();
      clearInterval(interval);
    };
  }, [scrollRef, contentRef]);

  // --- Section marker extraction (debounced, MutationObserver) ---
  const extractMarkers = useCallback(() => {
    const contentEl = contentRef.current;
    const scrollEl = scrollRef.current;
    if (!contentEl || !scrollEl) return;

    const scrollHeight = scrollEl.scrollHeight;
    if (scrollHeight <= 0) return;

    // Find headings
    const headings = contentEl.querySelectorAll("h1, h2, h3, h4");
    // Find bold "Verse N" elements
    const bolds = contentEl.querySelectorAll("strong");
    const versePattern = /^Verse\s+\d+/i;

    const markers: SectionMarker[] = [];

    headings.forEach((el) => {
      const text = el.textContent?.trim();
      if (!text) return;
      const htmlEl = el as HTMLElement;
      // Get offset relative to scroll container
      const offset = htmlEl.offsetTop;
      markers.push({
        label: text.slice(0, 60),
        position: offset / scrollHeight,
      });
    });

    bolds.forEach((el) => {
      const text = el.textContent?.trim();
      if (!text || !versePattern.test(text)) return;
      const htmlEl = el as HTMLElement;
      // Walk up to find the offset relative to scroll container content
      let offset = 0;
      let current: HTMLElement | null = htmlEl;
      while (current && current !== scrollEl) {
        offset += current.offsetTop;
        current = current.offsetParent as HTMLElement | null;
      }
      markers.push({
        label: text.slice(0, 40),
        position: offset / scrollHeight,
      });
    });

    // Sort by position, deduplicate nearby markers (within 0.5% of each other)
    markers.sort((a, b) => a.position - b.position);
    const deduped: SectionMarker[] = [];
    for (const m of markers) {
      const last = deduped[deduped.length - 1];
      if (last && Math.abs(last.position - m.position) < 0.005) continue;
      deduped.push(m);
    }

    setSectionMarkers(deduped);
  }, [contentRef, scrollRef]);

  const debouncedExtract = useCallback(() => {
    if (markerDebounceRef.current) clearTimeout(markerDebounceRef.current);
    markerDebounceRef.current = setTimeout(extractMarkers, 300);
  }, [extractMarkers]);

  // Extract markers on content changes via MutationObserver
  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    // Initial extraction
    debouncedExtract();

    const mo = new MutationObserver(debouncedExtract);
    mo.observe(contentEl, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      if (markerDebounceRef.current) clearTimeout(markerDebounceRef.current);
    };
  }, [contentRef, debouncedExtract]);

  // --- scrollToRatio: direct DOM manipulation for instant scroll ---
  const scrollToRatio = useCallback(
    (ratio: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(1, ratio));
      const maxScroll = el.scrollHeight - el.clientHeight;
      el.scrollTop = clamped * maxScroll;
    },
    [scrollRef]
  );

  return {
    scrollRatio,
    isVisible,
    sectionMarkers,
    scrollToRatio,
    isDragging,
    setIsDragging,
    containerBounds,
  };
}
