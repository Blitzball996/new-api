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

import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Select,
  Spin,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { Clapperboard } from 'lucide-react';
import { UserContext } from '../../context/User';
import {
  API,
  showError,
  showSuccess,
  processGroupsData,
} from '../../helpers';

const { Text, Title } = Typography;

const TOKEN_STORAGE_KEY = 'videostudio_token';
const POLL_INTERVAL_MS = 5000;
const TERMINAL_STATUSES = ['SUCCESS', 'FAILURE'];
const MAX_DURATION_SECONDS = 15;

// 画面比例，参考即梦/Seedance 支持的档位
const SIZE_OPTIONS = [
  { label: '16:9 (横屏)', value: '16:9' },
  { label: '9:16 (竖屏)', value: '9:16' },
  { label: '1:1 (方形)', value: '1:1' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '21:9 (超宽)', value: '21:9' },
  { label: '720x1280 (Sora 竖屏)', value: '720x1280' },
  { label: '1280x720 (Sora 横屏)', value: '1280x720' },
  { label: '1792x1024 (Sora Pro 横屏)', value: '1792x1024' },
  { label: '1024x1792 (Sora Pro 竖屏)', value: '1024x1792' },
];

// 常见视频模型关键字，用于从全部模型中筛出视频模型放在前面
const VIDEO_MODEL_KEYWORDS = [
  'video',
  'seedance',
  'sora',
  'kling',
  'jimeng',
  'vidu',
  'hailuo',
  'veo',
  'wan',
  'cogvideo',
  'hunyuan-video',
  'minimax-video',
  'pixverse',
  'runway',
  'luma',
];

const isVideoModel = (id) => {
  const lower = id.toLowerCase();
  return VIDEO_MODEL_KEYWORDS.some((kw) => lower.includes(kw));
};

const VideoStudio = () => {
  const { t } = useTranslation();
  const [userState] = useContext(UserContext);

  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_STORAGE_KEY) || '',
  );
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState('');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('16:9');
  const [duration, setDuration] = useState(5);

  const [submitting, setSubmitting] = useState(false);
  const [task, setTask] = useState(null);
  const pollTimerRef = useRef(null);

  const authHeaders = useCallback(() => {
    let key = token.trim();
    if (key && !key.startsWith('sk-')) {
      key = `sk-${key}`;
    }
    return {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
  }, [token]);

  // 令牌变化时持久化，方便下次直接使用
  useEffect(() => {
    if (token.trim()) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
    }
  }, [token]);

  // 用用户的令牌拉取该令牌可用的模型列表（计费也归属该令牌）
  const loadModels = useCallback(async () => {
    if (!token.trim()) {
      showError(t('请先填写令牌'));
      return;
    }
    try {
      const res = await API.get('/v1/models', {
        headers: authHeaders(),
        skipErrorHandler: true,
      });
      const list = res?.data?.data;
      if (!Array.isArray(list)) {
        showError(t('加载模型失败'));
        return;
      }
      const ids = list.map((item) => item?.id).filter(Boolean);
      // 视频模型排前面，其余模型也保留，另外支持手动输入任意模型
      const videoIds = ids.filter(isVideoModel).sort();
      const otherIds = ids.filter((id) => !isVideoModel(id)).sort();
      const options = [...videoIds, ...otherIds].map((id) => ({
        label: id,
        value: id,
      }));
      setModels(options);
      if (options.length === 0) {
        showError(t('该令牌下没有可用模型'));
        return;
      }
      setModel((current) => current || videoIds[0] || options[0].value);
      showSuccess(t('模型列表已更新'));
    } catch (error) {
      showError(
        error?.response?.data?.error?.message || t('加载模型失败，请检查令牌'),
      );
    }
  }, [token, authHeaders, t]);

  // 分组列表来自登录会话（页面在控制台内，始终已登录）
  const loadGroups = useCallback(async () => {
    try {
      const res = await API.get('/api/user/self/groups');
      const { success, data } = res.data;
      if (!success) return;
      const userGroup =
        userState?.user?.group ||
        JSON.parse(localStorage.getItem('user') || '{}')?.group;
      const groupOptions = processGroupsData(data, userGroup);
      setGroups(groupOptions);
    } catch (error) {
      // 分组加载失败不阻塞主流程，默认使用令牌自身分组
    }
  }, [userState]);

  useEffect(() => {
    loadGroups();
    if (token.trim()) {
      loadModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // 用令牌轮询任务状态，直到任务结束
  const startPolling = useCallback(
    (taskId) => {
      stopPolling();
      pollTimerRef.current = setInterval(async () => {
        try {
          const res = await API.get(`/v1/video/generations/${taskId}`, {
            headers: authHeaders(),
            skipErrorHandler: true,
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
          // 轮询失败不中断，等待下一轮
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
    if (!model || !model.trim()) {
      showError(t('请选择或输入视频模型'));
      return;
    }
    if (!prompt.trim()) {
      showError(t('请输入视频描述'));
      return;
    }
    const seconds = Math.min(
      Math.max(Math.round(Number(duration) || 5), 1),
      MAX_DURATION_SECONDS,
    );

    setSubmitting(true);
    stopPolling();
    try {
      const payload = {
        model: model.trim(),
        prompt: prompt.trim(),
        size,
        seconds: String(seconds),
      };
      if (group) {
        payload.group = group;
      }
      const res = await API.post('/v1/video/generations', payload, {
        headers: authHeaders(),
        skipErrorHandler: true,
      });
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
      showError(
        error?.response?.data?.message ||
          error?.response?.data?.error?.message ||
          t('提交失败'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const videoUrl = task?.result_url || task?.url || '';
  const isRunning = task && !TERMINAL_STATUSES.includes(task.status);

  return (
    <div className='mt-[60px] px-2 pb-6'>
      <div className='mx-auto max-w-3xl flex flex-col gap-4 pt-4'>
        <Card>
          <div className='flex items-center gap-2 mb-2'>
            <Clapperboard size={20} />
            <Title heading={4} className='!mb-0'>
              {t('0帧起手')}
            </Title>
          </div>
          <Text type='tertiary'>
            {t('输入你的令牌，选择视频模型，描述你想要的画面即可生成视频，费用从该令牌扣除。')}
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

            <div className='flex flex-col sm:flex-row gap-4'>
              <div className='flex-1'>
                <Text strong>{t('视频模型')}</Text>
                <Select
                  value={model}
                  onChange={setModel}
                  optionList={models}
                  filter
                  allowCreate
                  placeholder={t('选择或输入模型名称')}
                  className='mt-1 w-full'
                />
              </div>
              <div className='flex-1'>
                <Text strong>{t('分组（可选）')}</Text>
                <Select
                  value={group}
                  onChange={setGroup}
                  optionList={groups}
                  filter
                  showClear
                  placeholder={t('默认使用令牌分组')}
                  className='mt-1 w-full'
                />
              </div>
            </div>

            <div className='flex flex-col sm:flex-row gap-4'>
              <div className='flex-1'>
                <Text strong>{t('画面比例 / 分辨率')}</Text>
                <Select
                  value={size}
                  onChange={setSize}
                  optionList={SIZE_OPTIONS}
                  filter
                  allowCreate
                  placeholder={t('选择或输入比例')}
                  className='mt-1 w-full'
                />
              </div>
              <div className='flex-1'>
                <Text strong>{t('时长（秒）')}</Text>
                <InputNumber
                  value={duration}
                  onChange={setDuration}
                  min={1}
                  max={MAX_DURATION_SECONDS}
                  step={1}
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

        <Card title={t('生成结果')}>
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
              {task.fail_reason && task.status === 'FAILURE' && (
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
    </div>
  );
};

export default VideoStudio;
