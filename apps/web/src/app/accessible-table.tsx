"use client";

import { Table, type TableProps } from "antd";
import { useLayoutEffect, useRef } from "react";

type AccessibleTableProps<RecordType extends object> =
  TableProps<RecordType> & {
    scrollRegionLabel: string;
  };

/**
 * Ant Design owns the horizontal scroll container internally, so Table does
 * not expose a prop for its tab index. Keep that generated region reachable
 * by keyboard whenever the table actually overflows.
 */
export function AccessibleTable<RecordType extends object>({
  scrollRegionLabel,
  ...props
}: AccessibleTableProps<RecordType>) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scrollRegion =
      rootRef.current?.querySelector<HTMLElement>(".ant-table-content");
    if (!scrollRegion) return;

    const synchronize = () => {
      const scrollable =
        scrollRegion.scrollWidth > scrollRegion.clientWidth + 1;
      if (scrollable) {
        scrollRegion.tabIndex = 0;
        scrollRegion.setAttribute("role", "region");
        scrollRegion.setAttribute("aria-label", scrollRegionLabel);
        scrollRegion.dataset.accessibleTableScroll = "true";
      } else {
        scrollRegion.removeAttribute("tabindex");
        scrollRegion.removeAttribute("role");
        scrollRegion.removeAttribute("aria-label");
        delete scrollRegion.dataset.accessibleTableScroll;
      }
    };

    synchronize();
    const resizeObserver = new ResizeObserver(synchronize);
    resizeObserver.observe(scrollRegion);

    return () => {
      resizeObserver.disconnect();
      scrollRegion.removeAttribute("tabindex");
      scrollRegion.removeAttribute("role");
      scrollRegion.removeAttribute("aria-label");
      delete scrollRegion.dataset.accessibleTableScroll;
    };
  });

  return (
    <div ref={rootRef}>
      <Table<RecordType> {...props} />
    </div>
  );
}
