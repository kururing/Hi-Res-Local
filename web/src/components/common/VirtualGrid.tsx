import React, { useLayoutEffect, useRef, useState } from 'react';

interface VirtualGridProps<T> {
  items: T[];
  /** Minimum card width in px; the column count is derived from it. */
  minColumnWidth: number;
  /** Gap between cards in px (both axes). */
  gap: number;
  /**
   * Card height in px for a given column width (cards usually have a square
   * artwork plus a fixed text block, so height depends on the column width).
   */
  getRowHeight: (columnWidth: number) => number;
  overscan?: number;
  className?: string;
  style?: React.CSSProperties;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
}

/**
 * Row-virtualized responsive card grid: only the rows near the viewport are
 * mounted, so thousands of album/artist cards stay cheap to render.
 */
export function VirtualGrid<T>({
  items,
  minColumnWidth,
  gap,
  getRowHeight,
  overscan = 3,
  className,
  style,
  getKey,
  renderItem,
}: VirtualGridProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    let frameId: number | undefined;
    const update = () => {
      if (frameId !== undefined) return;
      frameId = window.requestAnimationFrame(() => {
        const width = el.clientWidth;
        const height = el.clientHeight;
        setViewport(current => (
          current.width === width && current.height === height ? current : { width, height }
        ));
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
  }, [items.length > 200]);

  // Typical music libraries contain a few dozen or a few hundred cards. A
  // native CSS grid gives those lists their final column count immediately,
  // avoiding the first-frame two-column fallback while remaining inexpensive.
  if (items.length <= 200) {
    return (
      <div
        ref={parentRef}
        className={['overflow-y-auto overscroll-contain', className].filter(Boolean).join(' ')}
        style={style}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnWidth}px, 1fr))`,
            gap,
          }}
        >
          {items.map((item, index) => (
            <div key={getKey(item, index)}>{renderItem(item, index)}</div>
          ))}
        </div>
      </div>
    );
  }

  const width = viewport.width || minColumnWidth * 2 + gap;
  const columns = Math.max(2, Math.floor((width + gap) / (minColumnWidth + gap)));
  const columnWidth = (width - gap * (columns - 1)) / columns;
  const rowHeight = getRowHeight(columnWidth) + gap;
  const rowCount = Math.ceil(items.length / columns);

  const totalHeight = rowCount * rowHeight;
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleRows = Math.ceil((viewport.height || rowHeight) / rowHeight) + overscan * 2;
  const endRow = Math.min(rowCount, startRow + visibleRows);
  const offsetY = startRow * rowHeight;

  const rows: React.ReactNode[] = [];
  for (let rowIdx = startRow; rowIdx < endRow; rowIdx++) {
    const rowItems: React.ReactNode[] = [];
    for (let col = 0; col < columns; col++) {
      const index = rowIdx * columns + col;
      if (index >= items.length) break;
      const item = items[index];
      rowItems.push(
        <div key={getKey(item, index)} style={{ width: columnWidth }}>
          {renderItem(item, index)}
        </div>
      );
    }
    rows.push(
      <div
        key={`row-${rowIdx}`}
        style={{ height: rowHeight, display: 'flex', gap, alignItems: 'flex-start' }}
      >
        {rowItems}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={['overflow-y-auto overscroll-contain', className].filter(Boolean).join(' ')}
      style={style}
      onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>{rows}</div>
      </div>
    </div>
  );
}
