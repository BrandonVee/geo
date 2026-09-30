"use client";

import { Select, type SelectProps } from "antd";
import type { RefSelectProps } from "antd/es/select";
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

// Ant Design's Form adds aria-required to both the decorative Select wrapper
// and its combobox. Keep the state on the interactive element only.
export const AccessibleSelect = forwardRef<RefSelectProps, SelectProps>(
  function AccessibleSelect(props, forwardedRef) {
    const ref = useRef<RefSelectProps>(null);
    useImperativeHandle(forwardedRef, () => ref.current!, []);
    useLayoutEffect(() => {
      ref.current?.nativeElement.removeAttribute("aria-required");
    });
    return <Select {...props} ref={ref} />;
  },
);
