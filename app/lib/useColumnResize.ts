import { useEffect, useRef, useCallback } from "react";

/**
 * useColumnResize — adds drag-to-resize handles to all <th> elements
 * inside a plain HTML <table>. For tables not using TanStack Table.
 *
 * Usage:
 *   const tableRef = useColumnResize();
 *   <table ref={tableRef}>...</table>
 *
 * The hook injects resize handle divs and manages mouse/touch drag events.
 * Works with any table that has <th> elements in a <thead>.
 */
export function useColumnResize<T extends HTMLTableElement>() {
  const tableRef = useRef<T>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const setup = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;

    // Clean up previous handles
    cleanupRef.current?.();
    const handles: HTMLDivElement[] = [];

    const headers = table.querySelectorAll("thead th");
    headers.forEach((th) => {
      const header = th as HTMLElement;
      header.style.position = "relative";

      const handle = document.createElement("div");
      handle.className = "column-resizer";
      header.appendChild(handle);
      handles.push(handle);

      let startX = 0;
      let startWidth = 0;

      const onMouseMove = (e: MouseEvent) => {
        const diff = e.clientX - startX;
        const newWidth = Math.max(40, startWidth + diff);
        header.style.width = `${newWidth}px`;
      };

      const onMouseUp = () => {
        handle.classList.remove("column-resizer--resizing");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // Suppress the click event that follows mouseup to prevent sort toggle
        const suppressClick = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        table.addEventListener("click", suppressClick, {
          capture: true,
          once: true,
        });
      };

      const onMouseDown = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX;
        startWidth = header.offsetWidth;
        handle.classList.add("column-resizer--resizing");
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      };

      handle.addEventListener("mousedown", onMouseDown);

      // Touch support
      let touchStartX = 0;
      let touchStartWidth = 0;

      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 0) return;
        const diff = e.touches[0].clientX - touchStartX;
        const newWidth = Math.max(40, touchStartWidth + diff);
        header.style.width = `${newWidth}px`;
      };

      const onTouchEnd = () => {
        handle.classList.remove("column-resizer--resizing");
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend", onTouchEnd);
      };

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 0) return;
        e.stopPropagation();
        touchStartX = e.touches[0].clientX;
        touchStartWidth = header.offsetWidth;
        handle.classList.add("column-resizer--resizing");
        document.addEventListener("touchmove", onTouchMove);
        document.addEventListener("touchend", onTouchEnd);
      };

      handle.addEventListener("touchstart", onTouchStart);
    });

    // Set table-layout: fixed for resize to work
    table.style.tableLayout = "fixed";

    cleanupRef.current = () => {
      handles.forEach((h) => h.remove());
    };
  }, []);

  useEffect(() => {
    // Use a MutationObserver to re-setup when the table content changes
    const table = tableRef.current;
    if (!table) return;

    setup();

    const observer = new MutationObserver(() => {
      // Only re-setup if thead changed
      const existingHandles = table.querySelectorAll("thead .column-resizer");
      const headers = table.querySelectorAll("thead th");
      if (existingHandles.length !== headers.length) {
        setup();
      }
    });

    observer.observe(table, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      cleanupRef.current?.();
    };
  }, [setup]);

  return tableRef;
}
