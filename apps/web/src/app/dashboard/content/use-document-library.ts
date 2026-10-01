"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  readDocumentLibraryQuery,
  writeDocumentLibraryQuery,
  type DocumentLibraryQuery,
} from "./document-library-query";

type Scope = { organizationId: string; teamBindingId: string; brandId: string };
type DocumentPage<T> = {
  list: T[];
  total: number;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
    offset: number;
  };
};
function useLibraryRead<T>(url: string | null, refreshToken: string) {
  const [snapshot, setSnapshot] = useState<{ url: string; data: T }>();
  const [failure, setFailure] = useState<{ url: string; message: string }>();
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const read = useCallback(async () => {
    controllerRef.current?.abort();
    if (!url) {
      controllerRef.current = undefined;
      setLoading(false);
      setSnapshot(undefined);
      setFailure(undefined);
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setSnapshot(undefined);
    setFailure(undefined);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "读取失败，请重试");
      if (!controller.signal.aborted && controllerRef.current === controller)
        setSnapshot({ url, data: body.data });
    } catch (error) {
      if (!controller.signal.aborted && controllerRef.current === controller)
        setFailure({
          url,
          message: error instanceof Error ? error.message : "读取失败，请重试",
        });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setLoading(false);
      }
    }
  }, [url]);
  const latestRead = useRef(read);
  useEffect(() => {
    latestRead.current = read;
  }, [read]);
  const refresh = useCallback(() => latestRead.current(), []);
  useEffect(() => {
    void read();
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = undefined;
    };
  }, [read, refreshToken]);
  const error = failure?.url === url ? failure.message : undefined;
  return {
    data: !error && snapshot?.url === url ? snapshot.data : undefined,
    error,
    loading: Boolean(url) && loading,
    refresh,
  };
}

// @project-doc docs/domains/geo_operations.md#article_jobs
export function useDocumentLibrary<TDocument, TFolder>(
  scope: Scope,
  refreshToken: string,
) {
  const search = useSearchParams();
  const { query, invalid } = readDocumentLibraryQuery(search, scope);
  const change = useCallback(
    (patch: Partial<DocumentLibraryQuery>) => {
      const url = new URL(window.location.href);
      const current = readDocumentLibraryQuery(url.searchParams, scope).query;
      url.search = writeDocumentLibraryQuery(
        url.searchParams,
        scope,
        current,
        patch,
      ).toString();
      window.history.replaceState(null, "", url);
    },
    [scope],
  );
  const params = new URLSearchParams({
    ...scope,
    limit: "20",
    offset: String((query.page - 1) * 20),
  });
  if (query.q) params.set("q", query.q);
  if (query.folder === "unfiled") params.set("unfiled", "true");
  else if (query.folder !== "all") params.set("folderId", query.folder);
  if (query.status !== "active") params.set("status", query.status);
  if (query.source !== "all") params.set("source", query.source);
  const enabled = Boolean(
    scope.organizationId && scope.teamBindingId && scope.brandId,
  );
  const documents = useLibraryRead<DocumentPage<TDocument>>(
    enabled ? `/api/v1/content-documents?${params}` : null,
    refreshToken,
  );
  const folders = useLibraryRead<TFolder[]>(
    enabled ? `/api/v1/content-folders?${new URLSearchParams(scope)}` : null,
    refreshToken,
  );
  const page = documents.data?.pagination?.page ?? query.page;
  useEffect(() => {
    if (documents.data && page !== query.page) change({ page });
  }, [documents.data, page, query.page, change]);
  const refreshDocuments = documents.refresh;
  const refreshFolders = folders.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([refreshDocuments(), refreshFolders()]);
  }, [refreshDocuments, refreshFolders]);
  return { query, invalid, change, documents, folders, page, refresh };
}
