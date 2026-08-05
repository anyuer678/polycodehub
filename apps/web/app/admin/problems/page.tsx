"use client";

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, DIFFICULTIES, getErrorMessage } from '../../lib/api';
import type { Problem, ListResponse } from '../../lib/types';
import { DifficultyBadge, EmptyState, Spinner, LoadingButton } from '../../components/ui';
import AdminPage from '../../components/AdminPage';

const PAGE_SIZE = 10;

export default function AdminProblemsPage() {
  return <AdminProblemsInner />;
}

function AdminProblemsInner() {
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState('EASY');
  const [description, setDescription] = useState('');
  const [createTags, setCreateTags] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error' | 'success'>('info');

  const [items, setItems] = useState<Problem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDifficulty, setEditDifficulty] = useState('EASY');
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState('');

  const [loadingList, setLoadingList] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkJson, setBulkJson] = useState('');
  const [bulkResult, setBulkResult] = useState('');

  const BULK_TEMPLATE = `[
  {
    "title": "两数之和",
    "difficulty": "EASY",
    "description": "题目描述（支持 \\n 换行）",
    "tags": ["数组", "哈希表"],
    "test_cases": [
      { "input_data": "[3,2,4]\\n6", "expected_output": "[1,2]", "is_sample": true },
      { "input_data": "[1,2]\\n3", "expected_output": "[0,1]", "is_sample": false }
    ]
  }
]`;

  function parseTags(input: string): string[] {
    return input.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 10);
  }

  const loadProblems = useCallback(async () => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (search) params.set('search', search);
      const payload = await apiGet<ListResponse<Problem>>(`/api/problems?${params}`);
      setItems(payload.data.items);
      setTotal(payload.data.total);
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '加载失败'));
      setMessageType('error');
    } finally {
      setLoadingList(false);
    }
  }, [page, search]);

  useEffect(() => {
    void loadProblems();
  }, [loadProblems]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(keyword.trim());
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy('create');
    try {
      const tags = parseTags(createTags);
      const payload = await apiPost<Problem>('/api/admin/problems', { title, difficulty, description, tags });
      setMessage(`创建成功，题目ID=${payload.data.id}`);
      setMessageType('success');
      setTitle('');
      setDifficulty('EASY');
      setDescription('');
      setCreateTags('');
      await loadProblems();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '创建失败'));
      setMessageType('error');
    } finally {
      setBusy(null);
    }
  }

  function openEdit(problem: Problem) {
    setEditId(problem.id);
    setEditTitle(problem.title);
    setEditDifficulty(problem.difficulty);
    setEditDescription(problem.description);
    setEditTags((problem.tags || []).join('，'));
  }

  async function onSaveEdit() {
    if (!editId) return;
    setBusy('edit');
    try {
      const tags = parseTags(editTags);
      await apiPut<Problem>(`/api/admin/problems/${editId}`, {
        title: editTitle,
        difficulty: editDifficulty,
        description: editDescription,
        tags
      });
      setMessage(`更新成功，题目ID=${editId}`);
      setMessageType('success');
      setEditId(null);
      await loadProblems();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '更新失败'));
      setMessageType('error');
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(problemId: number) {
    if (!window.confirm(`确认删除题目 #${problemId} 吗？删除将同时移除其测试用例与提交记录。`)) return;
    setBusy(`del-${problemId}`);
    try {
      await apiDelete(`/api/admin/problems/${problemId}`);
      setMessage(`删除成功，题目ID=${problemId}`);
      setMessageType('success');
      await loadProblems();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '删除失败'));
      setMessageType('error');
    } finally {
      setBusy(null);
    }
  }

  async function onBulkImport() {
    setBusy('bulk');
    setBulkResult('');
    try {
      const parsed = JSON.parse(bulkJson);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setMessage('请粘贴一个非空的 JSON 数组');
        setMessageType('error');
        return;
      }
      const payload = await apiPost<{ inserted_count: number; test_case_count: number }>('/api/admin/problems/bulk', {
        items: parsed
      });
      setBulkResult(`成功导入 ${payload.data.inserted_count} 道题、${payload.data.test_case_count} 个测试用例`);
      setBulkJson('');
      setBulkOpen(false);
      setMessage(`批量导入成功：${payload.data.inserted_count} 道题`);
      setMessageType('success');
      await loadProblems();
    } catch (err: unknown) {
      setMessage(getErrorMessage(err, '批量导入失败，请检查 JSON 格式'));
      setMessageType('error');
    } finally {
      setBusy(null);
    }
  }

  const messageStyle =
    messageType === 'error'
      ? { color: '#cf222e' }
      : messageType === 'success'
        ? { color: '#1a7f37' }
        : { color: '#656d76' };

  return (
    <AdminPage title="题目管理" subtitle={`共 ${total} 道题`}>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <form onSubmit={onSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索题目标题..."
            style={{ width: 200 }}
            aria-label="搜索题目"
          />
          <button type="submit" className="btn btn-secondary">搜索</button>
        </form>
        <button type="button" className="btn btn-secondary" onClick={() => setBulkOpen(!bulkOpen)}>
          {bulkOpen ? '收起批量导入' : '批量导入题目'}
        </button>
      </div>

      {bulkOpen && (
        <section className="card fade-in" style={{ marginBottom: 16 }}>
          <h3>批量导入（JSON 数组，题目 + 测试用例）</h3>
          <p style={{ color: '#656d76', fontSize: 13 }}>
            格式：数组，每项含 title / difficulty / description / tags（可选）/ test_cases（1-100 个）。导入为事务，全部成功或全部回滚。
          </p>
          <textarea
            className="textarea-full"
            value={bulkJson}
            onChange={(e) => setBulkJson(e.target.value)}
            rows={12}
            style={{ fontFamily: 'Consolas, monospace', fontSize: 12 }}
            placeholder={BULK_TEMPLATE}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <LoadingButton loading={busy === 'bulk'} type="button" onClick={() => void onBulkImport()}>
              开始导入
            </LoadingButton>
            <button className="btn" type="button" onClick={() => setBulkOpen(false)}>取消</button>
          </div>
          {bulkResult && <p style={{ color: '#1a7f37', marginTop: 8 }}>{bulkResult}</p>}
        </section>
      )}

      <form className="card" onSubmit={onCreate}>
        <h3>创建题目</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
          <p>
            <label>标题</label><br />
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={255} />
          </p>
          <p>
            <label>难度</label><br />
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={{ width: '100%' }}>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </p>
          <p>
            <label>标签（逗号分隔，可选）</label><br />
            <input value={createTags} onChange={(e) => setCreateTags(e.target.value)} placeholder="数组, 哈希表" />
          </p>
        </div>
        <p>
          <label>描述</label><br />
          <textarea className="textarea-full" value={description} onChange={(e) => setDescription(e.target.value)} rows={8} required />
        </p>
        <LoadingButton loading={busy === 'create'} type="submit">创建题目</LoadingButton>
      </form>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap" style={{ border: 'none' }}>
          {loadingList ? (
            <div style={{ padding: 24 }}><Spinner label="加载题目中..." /></div>
          ) : items.length === 0 ? (
            <EmptyState text="暂无题目" />
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 56 }}>#</th>
                  <th>题目</th>
                  <th style={{ width: 100 }}>难度</th>
                  <th style={{ width: 200 }}>标签</th>
                  <th style={{ width: 130, textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((problem) => (
                  <tr key={problem.id}>
                    <td style={{ color: '#656d76', fontFamily: 'Consolas, monospace' }}>{problem.id}</td>
                    <td>
                      <b>{problem.title}</b>
                      <div style={{ fontSize: 12, color: '#656d76' }}>{problem.description.slice(0, 60)}...</div>
                    </td>
                    <td><DifficultyBadge difficulty={problem.difficulty} /></td>
                    <td style={{ fontSize: 12, color: '#0969da' }}>
                      {(problem.tags || []).join(' · ') || <span style={{ color: '#9a6700' }}>未设置</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" type="button" onClick={() => openEdit(problem)} style={{ marginRight: 6 }}>
                        编辑
                      </button>
                      <LoadingButton
                        loading={busy === `del-${problem.id}`}
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => void onDelete(problem.id)}
                      >
                        删除
                      </LoadingButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span style={{ alignSelf: 'center', fontSize: 13, color: '#656d76' }}>
            第 {page} / {Math.ceil(total / PAGE_SIZE)} 页
          </span>
          <button className="btn btn-secondary btn-sm" type="button" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>
            下一页
          </button>
        </div>
      )}

      {editId && (
        <section className="card fade-in">
          <h3>编辑题目 #{editId}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 12 }}>
            <p>
              <label>标题</label><br />
              <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </p>
            <p>
              <label>难度</label><br />
              <select value={editDifficulty} onChange={(e) => setEditDifficulty(e.target.value)} style={{ width: '100%' }}>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </p>
          </div>
          <p>
            <label>标签（逗号分隔，可选）</label><br />
            <input value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="数组, 哈希表" />
          </p>
          <p>
            <label>描述</label><br />
            <textarea className="textarea-full" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={8} />
          </p>
          <LoadingButton loading={busy === 'edit'} type="button" style={{ marginRight: 8 }} onClick={() => void onSaveEdit()}>
            保存
          </LoadingButton>
          <button className="btn" type="button" onClick={() => setEditId(null)}>
            取消
          </button>
        </section>
      )}

      {message && <p style={{ marginTop: 12, ...messageStyle }}>{message}</p>}
    </AdminPage>
  );
}
