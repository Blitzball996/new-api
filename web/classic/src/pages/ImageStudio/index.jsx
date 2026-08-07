/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/

import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, Empty, Input, Select, Spin, TextArea, Typography, Upload, Tag, Tooltip,
} from '@douyinfe/semi-ui';
import { ImageIcon, Download, Clock } from 'lucide-react';
import { UserContext } from '../../context/User';
import { API, showError, showSuccess, processGroupsData } from '../../helpers';

const { Text, Title } = Typography;

const TOKEN_STORAGE_KEY = 'imagestudio_token';
const HISTORY_STORAGE_KEY = 'imagestudio_history';
const MAX_HISTORY = 50;
const MAX_REF_IMAGES = 6;
const POLL_INTERVAL_MS = 3000;
const TERMINAL_STATUSES = ['SUCCESS', 'FAILURE'];

const SIZE_OPTIONS = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '1:1',  value: '1:1'  },
  { label: '4:3',  value: '4:3'  },
  { label: '3:4',  value: '3:4'  },
];

const RESOLUTION_OPTIONS = [
  { label: '标准 (1K)', value: '1K' },
  { label: '2K',        value: '2K' },
  { label: '4K',        value: '4K' },
];

const COUNT_OPTIONS = [1, 2, 3, 4].map((n) => ({ label: String(n), value: n }));

const IMAGE_MODEL_KEYWORDS = [
  'image', 'gpt-image', 'dall-e', 'flux', 'stable', 'sdxl',
  'midjourney', 'imagine', 'draw', 'paint', 'art',
];
const isImageModel = (id) => {
  const lower = id.toLowerCase();
  return IMAGE_MODEL_KEYWORDS.some((kw) => lower.includes(kw));
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const loadHistory = () => {
  try { return JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]'); }
  catch { return []; }
};
const saveHistory = (history) => {
  try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY))); }
  catch {}
};

const ImageStudio = () => {
  const { t } = useTranslation();
  const [userState] = useContext(UserContext);

  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) || '');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState('');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('16:9');
  const [resolution, setResolution] = useState('1K');
  const [count, setCount] = useState(1);
  const [refImages, setRefImages] = useState([]);

  const [submitting, setSubmitting] = useState(false);
  const [task, setTask] = useState(null);
  const [history, setHistory] = useState(() => loadHistory());
  const [showHistory, setShowHistory] = useState(false);
  const pollTimerRef = useRef(null);

  const authHeaders = useCallback(() => {
    let key = token.trim();
    if (key && !key.startsWith('sk-')) key = `sk-${key}`;
    return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  }, [token]);

  useEffect(() => {
    if (token.trim()) localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
  }, [token]);

  const loadModels = useCallback(async () => {
    if (!token.trim()) { showError(t('请先填写令牌')); return; }
    try {
      const res = await API.get('/v1/models', { headers: authHeaders(), skipErrorHandler: true });
      const list = res?.data?.data;
      if (!Array.isArray(list)) { showError(t('加载模型失败')); return; }
      const ids = list.map((item) => item?.id).filter(Boolean);
      const imgIds = ids.filter(isImageModel).sort();
      const otherIds = ids.filter((id) => !isImageModel(id)).sort();
      const options = [...imgIds, ...otherIds].map((id) => ({ label: id, value: id }));
      setModels(options);
      if (!options.length) { showError(t('该令牌下没有可用模型')); return; }
      setModel((cur) => cur || imgIds[0] || options[0].value);
      showSuccess(t('模型列表已更新'));
    } catch (e) {
      showError(e?.response?.data?.error?.message || t('加载模型失败，请检查令牌'));
    }
  }, [token, authHeaders, t]);

  const loadGroups = useCallback(async () => {
    try {
      const res = await API.get('/api/user/self/groups');
      const { success, data } = res.data;
      if (!success) return;
      const userGroup = userState?.user?.group || JSON.parse(localStorage.getItem('user') || '{}')?.group;
      setGroups(processGroupsData(data, userGroup));
    } catch {}
  }, [userState]);

  useEffect(() => {
    loadGroups();
    if (token.trim()) loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback((taskId, pendingEntry) => {
    stopPolling();
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await API.get(`/v1/image/generations/${taskId}`, {
          headers: authHeaders(),
          skipErrorHandler: true,
        });
        const data = res?.data?.data;
        if (!data) return;
        setTask((prev) => ({ ...prev, ...data }));
        if (TERMINAL_STATUSES.includes(data.status)) {
          stopPolling();
          if (data.status === 'SUCCESS') {
            showSuccess(t('图片生成完成'));
            const entry = { ...pendingEntry, result_url: data.result_url || data.url };
            const newHistory = [entry, ...history];
            setHistory(newHistory);
            saveHistory(newHistory);
          } else {
            showError(data.fail_reason || t('图片生成失败'));
          }
        }
      } catch {}
    }, POLL_INTERVAL_MS);
  }, [authHeaders, stopPolling, t, history]);

  const handleRefImageChange = useCallback(async ({ fileList }) => {
    const results = [];
    for (const item of fileList) {
      const rawFile = item.fileInstance;
      if (!rawFile) continue;
      if (results.length >= MAX_REF_IMAGES) break;
      try {
        const dataUrl = await fileToBase64(rawFile);
        results.push({ dataUrl, name: rawFile.name || 'image' });
      } catch { showError(t('图片读取失败：') + (rawFile.name || '')); }
    }
    setRefImages(results);
  }, [t]);

  const handleSubmit = async () => {
    if (!token.trim()) { showError(t('请先填写令牌')); return; }
    if (!model?.trim()) { showError(t('请选择或输入图片模型')); return; }
    if (!prompt.trim()) { showError(t('请输入图片描述')); return; }

    setSubmitting(true);
    stopPolling();
    setTask(null);
    try {
      const payload = {
        model: model.trim(),
        prompt: prompt.trim(),
        size: resolution,
        n: count,
      };
      if (group) payload.group = group;
      if (refImages.length > 0) payload.image = refImages.map((r) => r.dataUrl);

      const res = await API.post('/v1/image/generations', payload, {
        headers: authHeaders(),
        skipErrorHandler: true,
      });
      const data = res?.data;
      const taskId = data?.task_id || data?.id;
      if (!taskId) {
        showError(data?.message || t('提交失败，未返回任务 ID'));
        return;
      }
      const pendingEntry = {
        id: taskId,
        ts: new Date().toLocaleString(),
        prompt: prompt.trim(),
        model: model.trim(),
        size,
        resolution,
        result_url: null,
      };
      setTask({ task_id: taskId, status: data?.status || 'SUBMITTED' });
      showSuccess(t('任务已提交，正在生成'));
      startPolling(taskId, pendingEntry);
    } catch (e) {
      showError(
        e?.response?.data?.message ||
        e?.response?.data?.error?.message ||
        t('提交失败'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearHistory = () => { setHistory([]); saveHistory([]); };

  const handleDownload = (url, idx) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `image-studio-${Date.now()}-${idx + 1}.png`;
    a.target = '_blank';
    a.click();
  };

  const isRunning = task && !TERMINAL_STATUSES.includes(task.status);
  const resultUrl = task?.result_url || task?.url || '';


  return (
    <div className='mt-[60px] px-2 pb-6'>
      <div className='mx-auto max-w-3xl flex flex-col gap-4 pt-4'>

        {/* 生成表单 */}
        <Card>
          <div className='flex items-center gap-2 mb-2'>
            <ImageIcon size={20} />
            <Title heading={4} className='!mb-0'>{t('0帧生图')}</Title>
          </div>
          <Text type='tertiary'>{t('输入令牌，选择模型，描述画面，可上传最多 6 张参考图，费用从该令牌扣除。')}</Text>

          <div className='mt-4 flex flex-col gap-4'>
            {/* 令牌 */}
            <div>
              <Text strong>{t('令牌')}</Text>
              <div className='mt-1 flex gap-2'>
                <Input mode='password' value={token} onChange={setToken} placeholder='sk-...' className='flex-1' />
                <Button onClick={loadModels}>{t('加载模型')}</Button>
              </div>
            </div>

            {/* 模型 + 分组 */}
            <div className='flex flex-col sm:flex-row gap-4'>
              <div className='flex-1'>
                <Text strong>{t('图片模型')}</Text>
                <Select value={model} onChange={setModel} optionList={models} filter allowCreate placeholder={t('选择或输入模型名称')} className='mt-1 w-full' />
              </div>
              <div className='flex-1'>
                <Text strong>{t('分组（可选）')}</Text>
                <Select value={group} onChange={setGroup} optionList={groups} filter showClear placeholder={t('默认使用令牌分组')} className='mt-1 w-full' />
              </div>
            </div>

            {/* 比例 + 分辨率 + 数量 */}
            <div className='flex flex-col sm:flex-row gap-4'>
              <div className='flex-1'>
                <Text strong>{t('画面比例')}</Text>
                <Select value={size} onChange={setSize} optionList={SIZE_OPTIONS} filter allowCreate className='mt-1 w-full' />
              </div>
              <div className='flex-1'>
                <Text strong>{t('分辨率')}</Text>
                <Select value={resolution} onChange={setResolution} optionList={RESOLUTION_OPTIONS} className='mt-1 w-full' />
              </div>
              <div className='flex-1'>
                <Text strong>{t('生成数量')}</Text>
                <Select value={count} onChange={setCount} optionList={COUNT_OPTIONS} className='mt-1 w-full' />
              </div>
            </div>

            {/* 提示词 */}
            <div>
              <Text strong>{t('画面描述')}</Text>
              <TextArea value={prompt} onChange={setPrompt} rows={4} maxCount={2000} placeholder={t('描述你想生成的画面')} className='mt-1' />
            </div>

            {/* 参考图 */}
            <div>
              <Text strong>{t('参考图（最多 6 张，可选）')}</Text>
              <Upload
                accept='image/*'
                multiple
                limit={MAX_REF_IMAGES}
                action=''
                beforeUpload={() => false}
                onChange={handleRefImageChange}
                listType='picture'
                className='mt-1'
              >
                <Button>{t('+ 添加参考图')}</Button>
              </Upload>
            </div>

            <Button theme='solid' size='large' loading={submitting || isRunning} onClick={handleSubmit} disabled={isRunning}>
              {isRunning ? t('生成中...') : submitting ? t('提交中...') : t('开始生成')}
            </Button>
          </div>
        </Card>

        {/* 当次结果 */}
        <Card title={t('生成结果')}>
          {!task && <Empty description={t('还没有生成任务')} />}
          {task && !TERMINAL_STATUSES.includes(task.status) && (
            <div className='flex items-center gap-2 py-4'>
              <Spin />
              <Text type='tertiary'>{t('正在生成，请稍候...')} ({task.status})</Text>
            </div>
          )}
          {task && task.status === 'SUCCESS' && (
            <div className='flex flex-col gap-3'>
              <div className='flex flex-wrap gap-2 items-center'>
                <Tag>{task.model || model}</Tag>
                <Tag>{size}</Tag>
                <Tag>{resolution}</Tag>
              </div>
              {resultUrl && (
                <div className='relative group inline-block'>
                  <img src={resultUrl} alt='result' className='rounded-lg max-h-[500px] object-contain border border-gray-100' />
                  <div className='absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity'>
                    <Tooltip content={t('下载')}>
                      <button
                        className='bg-black bg-opacity-50 rounded-full p-1.5 text-white hover:bg-opacity-80'
                        onClick={() => handleDownload(resultUrl, 0)}
                      >
                        <Download size={14} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              )}
            </div>
          )}
          {task && task.status === 'FAILURE' && (
            <Text type='danger'>{t('生成失败：')}{task.fail_reason || t('未知错误')}</Text>
          )}
        </Card>

        {/* 历史记录 */}
        <Card
          title={
            <div className='flex items-center justify-between w-full'>
              <div className='flex items-center gap-2'>
                <Clock size={16} />
                <span>{t('历史记录')}（{history.length}）</span>
              </div>
              <div className='flex gap-2'>
                <Button size='small' onClick={() => setShowHistory((v) => !v)}>
                  {showHistory ? t('收起') : t('展开')}
                </Button>
                {history.length > 0 && (
                  <Button size='small' type='danger' onClick={handleClearHistory}>{t('清空')}</Button>
                )}
              </div>
            </div>
          }
        >
          {!showHistory && <Text type='tertiary'>{t('点击「展开」查看历史生成记录')}</Text>}
          {showHistory && history.length === 0 && <Empty description={t('暂无历史记录')} />}
          {showHistory && history.length > 0 && (
            <div className='flex flex-col gap-6'>
              {history.map((entry) => (
                <div key={entry.id} className='border-b border-gray-100 pb-4 last:border-0 last:pb-0'>
                  <div className='flex flex-wrap gap-2 mb-2 items-center'>
                    <Tag>{entry.model}</Tag>
                    <Tag>{entry.size}</Tag>
                    <Tag>{entry.resolution}</Tag>
                    <Text type='tertiary' size='small'>{entry.ts}</Text>
                  </div>
                  <Text type='tertiary' size='small' ellipsis={{ rows: 1 }} className='mb-2'>{entry.prompt}</Text>
                  {entry.result_url && (
                    <div className='relative group inline-block'>
                      <img
                        src={entry.result_url}
                        alt={entry.id}
                        className='rounded-lg h-28 w-28 object-cover border border-gray-100 cursor-pointer'
                        onClick={() => window.open(entry.result_url, '_blank')}
                      />
                      <div className='absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity'>
                        <button
                          className='bg-black bg-opacity-50 rounded-full p-1 text-white hover:bg-opacity-80'
                          onClick={(e) => { e.stopPropagation(); handleDownload(entry.result_url, 0); }}
                        >
                          <Download size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

      </div>
    </div>
  );
};

export default ImageStudio;
