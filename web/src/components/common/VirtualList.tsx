import React, { useEffect, useRef, useState } from 'react';

interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  overscan?: number;
  className?: string;
  style?: React.CSSProperties;
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => React.ReactNode;
}

export function VirtualList<T>({
  items,
  rowHeight,
  overscan = 8,
  className,
  style,
  getKey,
  renderRow,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    let frameId: number | undefined;
    const update = () => {
      if (frameId !== undefined) return;
      frameId = window.requestAnimationFrame(() => {
        const nextHeight = el.clientHeight;
        setViewportHeight(current => current === nextHeight ? current : nextHeight);
        frameId = undefined;
      });
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    };
  }, []);

  const totalHeight = items.length * rowHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil((viewportHeight || rowHeight) / rowHeight) + overscan * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);
  const offsetY = startIndex * rowHeight;

  return (
    <div
      ref={parentRef}
      className={className}
      style={{ overflowY: 'auto', ...style }}
      onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {items.slice(startIndex, endIndex).map((item, sliceIndex) => {
            const index = startIndex + sliceIndex;
            return (
              <div key={getKey(item, index)} style={{ height: rowHeight }}>
                {renderRow(item, index)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
