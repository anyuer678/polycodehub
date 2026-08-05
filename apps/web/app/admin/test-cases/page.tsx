"use client";

import { FormEvent, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { EmptyState, LoadingButton, Spinner } from '../../components/ui';
import AuthGate from '../../components/AuthGate';
import AdminPage from '../../components/AdminPage';

type TestCase = {
  id: number;
  problem_id: number;
  input_data: string;
  expected_output: string;
  is_sample: boolean;
};

export default function AdminTestCasesPage() {
  return (
    <AuthGate staff>
      <AdminTestCasesInner />
    </AuthGate>
  );
}

function AdminTestCasesInner() {
  const { isAdmin } = useAuth();

  const [problemId, setProblemId] = useState('1');
  const [inputData, setInputData] = useState('');
  const [expectedOutput, setExpectedOutput] = useState('');
  const [isSample, setIsSample] = useState(true);
  const [bulkJson, setBulkJson] = useState('[\n  {"input_data":"1 2","expected_output":"3","is_sample":true}\n]');
  const [message, setMessage] = useState('');
  const [items, setItems] = useState<TestCase[]>([]);

  const [editId, setEditId] = useState<number | null>(null);
  const [editInput, setEditInput] = useState('');
  const [editOutput, setEditOutput] = useState('');
  const [editSample, setEditSample] = useState(false);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    // 竞态防护：卸载或切换题目后丢弃过期响应
    const cancelledRef = { cancelled: false };
    void loadCases(problemId, cancelledRef);
    return () => { cancelledRef.cancelled = true; };
  }, []);
  async function loadCases(pid: string, cancelledRef?: { cancelled: boolean }) {
    setLoading(true);
    try {
      const payload = await apiGet<{ items: TestCase[] }>(`/api/problems/${pid}/test-cases`);
      if (cancelledRef?.cancelled) return;
      setItems(payload.data?.items || []);
      setMessage('');
    } catch (err: unknown) {
      if (cancelledRef?.cancelled) return;
      const e = err as Error;
      setMessage(e.message || '加载测试用例失败');
    } finally {
      if (!cancelledRef?.cancelled) setLoading(false);
    }
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    await loadCases(problemId);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy('create');
    try {
      const payload = await apiPost(`/api/admin/problems/${problemId}/test-cases`, {
        input_data: inputData,
        expected_output: expectedOutput,
        is_sample: isSample
      });
      if (payload?.code !== 0 && payload?.code !== undefined) {
        throw new Error(payload?.message || '创建测试用例失败');
      }
      setInputData('');
      setExpectedOutput('');
      setIsSample(true);
      setMessage('创建测试用例成功');
      await loadCases(problemId);
    } catch (err: unknown) {
      const e = err as Error;
      setMessage(e.message || '创建测试用例失败');
    } finally {
      setBusy(null);
    }
  }

  async function onBulkImport(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy('bulk');
    try {
      const parsed = JSON.parse(bulkJson);
      const importItems = Array.isArray(parsed) ? parsed : parsed?.items;
      if (!Array.isArray(importItems)) {
        throw new Error('JSON 必须是数组，或包含 items 数组');
      }

      const payload = await apiPost<{ inserted_count: number }>(`/api/admin/problems/${problemId}/test-cases/bulk`, {
        items: importItems
      });
      if (payload.code !== 0) {
        throw new Error(payload.message || '批量导入失败');
      }

      setMessage(`批量导入成功，新增 ${payload.data?.inserted_count ?? 0} 条`);
      await loadCases(problemId);
    } catch (err: unknown) {
      const e = err as Error;
      setMessage(e.message || '批量导入失败');
    } finally {
      setBusy(null);
    }
  }

  function openEdit(item: TestCase) {
    setEditId(item.id);
    setEditInput(item.input_data);
    setEditOutput(item.expected_output);
    setEditSample(item.is_sample);
  }

  async function onSaveEdit() {
    if (!editId || !isAdmin) return;
    setBusy('edit');
    try {
      const payload = await apiPut(`/api/admin/test-cases/${editId}`, {
        input_data: editInput,
        expected_output: editOutput,
        is_sample: editSample
      });
      if (payload?.code !== 0 && payload?.code !== undefined) {
        throw new Error(payload?.message || '更新测试用例失败');
      }

      setEditId(null);
      setMessage('更新测试用例成功');
      await loadCases(problemId);
    } catch (err: unknown) {
      const e = err as Error;
      setMessage(e.message || '更新测试用例失败');
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(testCaseId: number) {
    if (!isAdmin) return;
    if (!window.confirm(`确认删除测试用例 #${testCaseId} 吗？`)) return;
    setBusy(`del-${testCaseId}`);
    try {
      const payload = await apiDelete(`/api/admin/test-cases/${testCaseId}`);
      if (payload?.code !== 0 && payload?.code !== undefined) {
        throw new Error(payload?.message || '删除测试用例失败');
      }

      setMessage('删除测试用例成功');
      await loadCases(problemId);
    } catch (err: unknown) {
      const e = err as Error;
      setMessage(e.message || '删除测试用例失败');
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminPage title="测试用例管理（管理员）">

      <form className="card" onSubmit={onSearch}>
        <h3>按题目查询测试用例</h3>
        <p>
          <label>题目 ID</label><br />
          <input value={problemId} onChange={(e) => setProblemId(e.target.value)} />
        </p>
        <LoadingButton loading={loading}>加载测试用例</LoadingButton>
      </form>

      <form className="card" onSubmit={onCreate}>
        <h3>创建测试用例</h3>
        <p>
          <label>输入</label><br />
          <textarea value={inputData} onChange={(e) => setInputData(e.target.value)} rows={4} style={{ width: '100%' }} required />
        </p>
        <p>
          <label>预期输出</label><br />
          <textarea value={expectedOutput} onChange={(e) => setExpectedOutput(e.target.value)} rows={3} style={{ width: '100%' }} required />
        </p>
        <p>
          <label>
            <input type="checkbox" checked={isSample} onChange={(e) => setIsSample(e.target.checked)} /> 样例用例
          </label>
        </p>
        <LoadingButton loading={busy === 'create'}>创建</LoadingButton>
      </form>

      <form className="card" onSubmit={onBulkImport}>
        <h3>批量导入测试用例（JSON）</h3>
        <p>
          <label>JSON 内容（数组或 {`{"items":[]}` }）</label><br />
          <textarea value={bulkJson} onChange={(e) => setBulkJson(e.target.value)} rows={10} style={{ width: '100%' }} />
        </p>
        <LoadingButton loading={busy === 'bulk'}>批量导入</LoadingButton>
      </form>

      <section className="card">
        <h3>测试用例列表</h3>
        {loading ? (
          <Spinner label="加载中..." />
        ) : items.length === 0 ? (
          <EmptyState text="暂无测试用例，先在上方创建或导入" />
        ) : (
          items.map((item) => (
            <div key={item.id} style={{ borderBottom: '1px solid #d8dee4', padding: '10px 0' }}>
              <p><b>#{item.id}</b> problem={item.problem_id} {item.is_sample ? '[sample]' : ''}</p>
              <p>input: {item.input_data}</p>
              <p>expected: {item.expected_output}</p>
              <button className="btn" type="button" onClick={() => openEdit(item)} style={{ marginRight: 8 }}>
                编辑
              </button>
              <LoadingButton
                loading={busy === `del-${item.id}`}
                type="button"
                className="btn"
                style={{ background: 'var(--danger, #e5484d)', marginLeft: 8 }}
                onClick={() => onDelete(item.id)}
              >
                删除
              </LoadingButton>
            </div>
          ))
        )}
      </section>

      {editId && (
        <section className="card">
          <h3>编辑测试用例 #{editId}</h3>
          <p>
            <label>输入</label><br />
            <textarea value={editInput} onChange={(e) => setEditInput(e.target.value)} rows={4} style={{ width: '100%' }} />
          </p>
          <p>
            <label>预期输出</label><br />
            <textarea value={editOutput} onChange={(e) => setEditOutput(e.target.value)} rows={3} style={{ width: '100%' }} />
          </p>
          <p>
            <label>
              <input type="checkbox" checked={editSample} onChange={(e) => setEditSample(e.target.checked)} /> 样例用例
            </label>
          </p>
          <LoadingButton loading={busy === 'edit'} type="button" style={{ marginRight: 8 }} onClick={onSaveEdit}>
            保存
          </LoadingButton>
          <button className="btn" type="button" onClick={() => setEditId(null)}>
            取消
          </button>
        </section>
      )}

      {message && <p>{message}</p>}
    </AdminPage>
  );
}
