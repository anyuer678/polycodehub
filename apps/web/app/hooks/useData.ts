"use client";

import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '../lib/api';
import { useAuth } from './useAuth';

export function useRequireAuth(): boolean {
  return useAuth().isLoggedIn;
}

export function useRequireAdmin(): boolean {
  const { isLoggedIn, isAdmin } = useAuth();
  return isLoggedIn && isAdmin;
}

export interface PaginatedState<T> {
  items: T[];
  page: number;
  totalPages: number;
  loading: boolean;
  error: string;
  setPage: (page: number) => void;
  reload: () => void;
}

export function usePaginatedList<T>(
  fetcher: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>,
  pageSize: number
): PaginatedState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      setError('');
      try {
        const data = await fetcher(targetPage, pageSize);
        setItems(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(getErrorMessage(err, '加载失败'));
      } finally {
        setLoading(false);
      }
    },
    [fetcher, pageSize]
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  return {
    items,
    page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    loading,
    error,
    setPage,
    reload: () => void load(page)
  };
}
