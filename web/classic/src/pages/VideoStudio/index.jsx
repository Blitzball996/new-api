/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Empty,
  Input,
  Select,
  Spin,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { Clapperboard } from 'lucide-react';
import { API, showError, showSuccess } from '../../helpers';

const { Text, Title } = Typography;

const TOKEN_STORAGE_KEY = 'videostudio_token';
const POLL_INTERVAL_MS = 5000;
const TERMINAL_STATUSES = ['SUCCESS', 'FAILURE'];

const SIZE_OPTIONS = [
  { label: '720x1280 (竖屏)', value: '720x1280' },
  { label: '1280x720 (横屏)', value: '1280x720' },
  { label: '1024x1024 (方形)', value: '1024x1024' },
];

const DURATION_OPTIONS = [
  { label: '4 秒', value: 4 },
  { label: '5 秒', value: 5 },
  { label: '8 秒', value: 8 },
  { label: '10 秒', value: 10 },
];

const VideoStudio = () => {
  const { t } = useTranslation();

  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_STORAGE_KEY) || '',
  );
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('720x1280');
  const [duration, setDuration] = useState(5);

  const [submitting, setSubmitting] = useState(false);
  const [task, setTask] = useState(null);
  const pollTimerRef = useRef(null);

  const authHeaders = useCallback(() => {
    const key = token.trim();
    return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  }, [token]);

  // 令牌变化时持久化，方便下次直接使用
  useEffect(() => {
    if (token.trim()) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
    }
  }, [token]);

  // 使用用户填写的令牌拉取该令牌可用的模型列表
  const loadModels = useCallback(async () => {
    if (!token.trim()) {
      showError(t('请先填写令牌'));
      return;
    }
    try {
      const res = await API.get('/v1/models', { headers: authHeaders() });
      const list = res?.data?.data;
      if (!Array.isArray(list)) {
        showError(t('加载模型失败'));
        return;
      }
      const options = list
        .map((item) => item?.id)
        .filter(Boolean)
        .sort()
        .map((id) => ({ label: id, value: id }));
      setModels(options);
      if (options.length === 0) {
        showError(t('该令牌下没有可用模型'));
        return;
      }
      setModel((current) =>
        options.some((o) => o.value === current) ? current : options[0].value,
      );
      showSuccess(t('模型列表已更新'));
    } catch (error) {
      showError(error?.response?.data?.error?.message || t('加载模型失败'));
    }
  }, [token, authHeaders, t]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // 轮询任务状态，直到任务结束
  const startPolling = useCallback(
    (taskId) => {
      stopPolling();
      pollTimerRef.current = setInterval(async () => {
        try {
          const res = await API.get(`/v1/video/generations/${taskId}`, {
            headers: authHeaders(),
          });
          // 接口返回 { code: 'success', data: TaskDto }
          const data = res?.data?.data;
          if (!data) return;
          setTask((prev) => ({ ...prev, ...data }));
          if (TERMINAL_STATUSES.includes(data.status)) {
            stopPolling();
            if (data.status === 'SUCCESS') {
              showSuccess(t('视频生成完成'));
            } else {
              showError(data.fail_reason || t('视频生成失败'));
            }
          }
        } catch (error) {
          stopPolling();
          showError(
            error?.response?.data?.error?.message || t('查询任务状态失败'),
          );
        }
      }, POLL_INTERVAL_MS);
    },
    [authHeaders, stopPolling, t],
  );

  const handleSubmit = async () => {
    if (!token.trim()) {
      showError(t('请先填写令牌'));
      return;
    }
    if (!model) {
      showError(t('请选择视频模型'));
      return;
    }
    if (!prompt.trim()) {
      showError(t('请输入视频描述'));
      return;
    }

    setSubmitting(true);
    stopPolling();
    try {
      const res = await API.post(
        '/v1/video/generations',
        { model, prompt: prompt.trim(), size, seconds: String(duration) },
        { headers: authHeaders() },
      );
      const data = res?.data;
      const taskId = data?.task_id || data?.id;
      if (!taskId) {
        showError(data?.message || t('提交失败，未返回任务 ID'));
        return;
      }
      setTask({ task_id: taskId, status: data?.status || 'SUBMITTED' });
      showSuccess(t('任务已提交，正在生成'));
      startPolling(taskId);
    } catch (error) {
      showError(error?.response?.data?.error?.message || t('提交失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const videoUrl = task?.result_url || task?.url || '';
  const isRunning = task && !TERMINAL_STATUSES.includes(task.status);

  return (
    <div className='p-4'>
      <Card>
        <div className='flex items-center gap-2 mb-4'>
          <Clapperboard size={20} />
          <Title heading={4} className='!mb-0'>
            {t('0帧起手')}
          </Title>
        </div>
        <Text type='tertiary'>
          {t('输入你的令牌，选择视频模型，描述你想要的画面即可生成视频。')}
        </Text>

        <div className='mt-4 flex flex-col gap-4'>
          <div>
            <Text strong>{t('令牌')}</Text>
            <div className='mt-1 flex gap-2'>
              <Input
                mode='password'
                value={token}
                onChange={setToken}
                placeholder='sk-...'
                className='flex-1'
              />
              <Button onClick={loadModels}>{t('加载模型')}</Button>
            </div>
          </div>

          <div>
            <Text strong>{t('视频模型')}</Text>
            <Select
              value={model}
              onChange={setModel}
              optionList={models}
              filter
              placeholder={t('请先加载模型')}
              className='mt-1 w-full'
            />
          </div>

          <div className='flex gap-4'>
            <div className='flex-1'>
              <Text strong>{t('分辨率')}</Text>
              <Select
                value={size}
                onChange={setSize}
                optionList={SIZE_OPTIONS}
                className='mt-1 w-full'
              />
            </div>
            <div className='flex-1'>
              <Text strong>{t('时长')}</Text>
              <Select
                value={duration}
                onChange={setDuration}
                optionList={DURATION_OPTIONS}
                className='mt-1 w-full'
              />
            </div>
          </div>

          <div>
            <Text strong>{t('视频描述')}</Text>
            <TextArea
              value={prompt}
              onChange={setPrompt}
              rows={4}
              maxCount={2000}
              placeholder={t('描述你想生成的画面，例如：一只猫在雪地里奔跑')}
              className='mt-1'
            />
          </div>

          <Button
            theme='solid'
            size='large'
            loading={submitting}
            disabled={isRunning}
            onClick={handleSubmit}
          >
            {isRunning ? t('生成中...') : t('开始生成')}
          </Button>
        </div>
      </Card>

      <Card className='mt-4' title={t('生成结果')}>
        {!task && <Empty description={t('还没有生成任务')} />}
        {task && (
          <div className='flex flex-col gap-3'>
            <Text type='tertiary'>
              {t('任务 ID')}: {task.task_id}
            </Text>
            <Text>
              {t('状态')}: {task.status}
              {task.progress ? ` (${task.progress})` : ''}
            </Text>
            {task.fail_reason && (
              <Text type='danger'>
                {t('失败原因')}: {task.fail_reason}
              </Text>
            )}
            {isRunning && (
              <div className='flex items-center gap-2'>
                <Spin />
                <Text type='tertiary'>{t('正在生成，请稍候')}</Text>
              </div>
            )}
            {videoUrl && (
              <>
                <video src={videoUrl} controls className='w-full rounded-lg' />
                <Button
                  onClick={() => window.open(videoUrl, '_blank')}
                  className='self-start'
                >
                  {t('在新窗口打开')}
                </Button>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default VideoStudio;
