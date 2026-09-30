"use client";

import { createCache, extractStyle, StyleProvider } from "@ant-design/cssinjs";
import { useServerInsertedHTML } from "next/navigation";
import { useState, type ReactNode } from "react";

// @project-doc docs/architecture/data_and_security.md#credential_encryption
export function StyleRegistry({
  children,
  nonce,
  insertServerStyles = true,
}: {
  children: ReactNode;
  nonce?: string;
  insertServerStyles?: boolean;
}) {
  const [cache] = useState(() => createCache());
  const [documentNonce] = useState(nonce);
  useServerInsertedHTML(() => {
    if (!insertServerStyles) return null;
    const css = extractStyle(cache, { plain: true, once: true });
    if (css.includes('.data-ant-cssinjs-cache-path{content:"";}')) return null;
    return (
      <style
        nonce={documentNonce}
        data-rc-order="prepend"
        data-rc-priority="-1000"
        dangerouslySetInnerHTML={{ __html: css }}
      />
    );
  });
  return <StyleProvider cache={cache}>{children}</StyleProvider>;
}
