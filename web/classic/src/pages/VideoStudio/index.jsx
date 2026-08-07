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
*/

import React, { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Select,
  Spin,
  Tag,
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

const TOKEN_STORAGE_KEY = 'video_studio_token';
const HISTORY_STORAGE_KEY = 'video_studio_history';

// 清晰度由 model 名决定（接口文档），resolution 字段不改变实际清晰度
const RESOLUTION_OPTIONS = [
  { label: '720p', value: '720p' },
  { label: '1080p', value: '1080p' },
  { label: '2K', value: '2k' },
  { label: '4K', value: '4k' },
];

// 画面比例，独立于清晰度，对应接口 size 字段
const ASPECT_OPTIONS = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '1:1', value: '1:1' },
  { label: '3:4', value: '3:4' },
  { label: '4:3', value: '4:3' },
  { label: '21:9', value: '21:9' },
];

const VARIANT_OPTIONS = [
  { label: '标准版', value: 'standard' },
  { label: 'Fast（仅 720p，不支持参考视频/首尾帧）', value: 'fast' },
];

// 素材数量上限（接口文档建议值）
const MAX_REF_IMAGES = 9;
const MAX_REF_VIDEOS = 3;
const MAX_REF_AUDIOS = 3;

// 时长范围：低于 6 按 6 处理，高于 15 按 15 处理
const DURATION_MIN = 6;
const DURATION_MAX = 15;

// 依据清晰度 + 版本 + 是否使用参考视频拼出文档中的完整模型名
const buildModelName = (resolution, variant, useRefVideo) => {
  if (variant === 'fast') return 'doubao-seedance-2.0-fast-720p';
  return `doubao-seedance-2.0-${resolution}${useRefVideo ? '-video' : ''}`;
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// 参考图压缩：手机原图 base64 可达数 MB，多张会顶爆代理层请求体上限
const REF_MAX_EDGE = 2048;

const compressRefImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const maxEdge = Math.max(width, height);
      if (maxEdge > REF_MAX_EDGE) {
        const ratio = REF_MAX_EDGE / maxEdge;
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const isPng = (file.type || '').includes('png');
      resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      fileToBase64(file).then(resolve).catch(reject);
    };
    img.src = url;
  });

const loadHistory = () => {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
};

const VideoStudio = () => {
  const { t } = useTranslation();
  const [userState] = useContext(UserContext);

  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_STORAGE_KEY) || '',
  );
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState('');
  const [prompt, setPrompt] = useState('');

  const [resolution, setResolution] = useState('1080p');
  const [variant, setVariant] = useState('standard');
  const [aspect, setAspect] = useState('16:9');
  const [duration, setDuration] = useState(6);

  // 参考素材：本地上传转 base64，或直接填链接
  const [refImages, setRefImages] = useState([]);
  const [refVideos, setRefVideos] = useState([]);
  const [refAudios, setRefAudios] = useState([]);
  const [firstImage, setFirstImage] = useState('');
  const [lastImage, setLastImage] = useState('');

  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState('');
  const [history, setHistory] = useState(loadHistory);

  const isFast = variant === 'fast';
  const useRefVideo = refVideos.length > 0;
  const effectiveResolution = isFast ? '720p' : resolution;
  const model = buildModelName(effectiveResolution, variant, useRefVideo);
  const supportsFrames = !isFast && !useRefVideo;

  const authHeaders = useCallback(() => {
    const key = token.trim();
    return key ? { Authorization: `Bearer ${key}` } : {};
  }, [token]);

  const loadGroups = useCallback(async () => {
    try {
      const res = await API.get('/api/user/self/groups');
      const { success, data } = res.data;
      if (!success) return;
      const userGroup =
        userState?.user?.group ||
        JSON.parse(localStorage.getItem('user') || '{}')?.group;
      const raw = processGroupsData(data, userGroup);
      // 显示分组名称而不是分组注释
      const options = raw.map((item) => ({
        ...item,
        label: item.value || item.label,
      }));
      setGroups(options);
    } catch (error) {
      // 分组加载失败不阻塞主流程
    }
  }, [userState]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }, [token]);

  // 默认选中含 Image / Video 的分组，其次令牌自身分组
  useEffect(() => {
    if (!groups.length || group) return;
    const preferred =
      groups.find((g) => /video/i.test(g.value || '')) ||
      groups.find((g) => /image/i.test(g.value || ''));
    setGroup(preferred ? preferred.value : groups[0].value);
  }, [groups, group]);

  // Fast 不支持参考视频与首尾帧，切换时清理掉已选素材
  useEffect(() => {
    if (!isFast) return;
    setRefVideos([]);
    setFirstImage('');
    setLastImage('');
  }, [isFast]);

  useEffect(() => {
    if (useRefVideo) {
      setFirstImage('');
      setLastImage('');
    }
  }, [useRefVideo]);

  const persistHistory = useCallback((next) => {
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      // 超出存储配额时忽略
    }
  }, []);

  const addFiles = useCallback(
    async (files, kind) => {
      const list = Array.from(files || []);
      if (!list.length) return;
      const setter =
        kind === 'image'
          ? setRefImages
          : kind === 'video'
            ? setRefVideos
            : setRefAudios;
      const max =
        kind === 'image'
          ? MAX_REF_IMAGES
          : kind === 'video'
            ? MAX_REF_VIDEOS
            : MAX_REF_AUDIOS;
      try {
        const encoded = await Promise.all(
          list.map((f) => (kind === 'image' ? compressRefImage(f) : fileToBase64(f))),
        );
        setter((prev) => {
          const merged = [...prev, ...encoded];
          if (merged.length > max) {
            showError(t('最多只能添加 {{n}} 个素材', { n: max }));
          }
          return merged.slice(0, max);
        });
      } catch (e) {
        showError(t('素材读取失败'));
      }
    },
    [t],
  );

  const addLink = useCallback(
    (kind) => {
      const label =
        kind === 'image' ? '参考图' : kind === 'video' ? '参考视频' : '参考音频';
      const url = window.prompt(t('请输入{{label}}链接', { label }));
      if (!url || !url.trim()) return;
      const setter =
        kind === 'image'
          ? setRefImages
          : kind === 'video'
            ? setRefVideos
            : setRefAudios;
      const max =
        kind === 'image'
          ? MAX_REF_IMAGES
          : kind === 'video'
            ? MAX_REF_VIDEOS
            : MAX_REF_AUDIOS;
      setter((prev) => {
        if (prev.length >= max) {
          showError(t('最多只能添加 {{n}} 个素材', { n: max }));
          return prev;
        }
        return [...prev, url.trim()];
      });
    },
    [t],
  );

  const removeAt = useCallback((kind, index) => {
    const setter =
      kind === 'image'
        ? setRefImages
        : kind === 'video'
          ? setRefVideos
          : setRefAudios;
    setter((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const pickFrame = useCallback(
    async (which) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const encoded = await compressRefImage(file);
          if (which === 'first') setFirstImage(encoded);
          else setLastImage(encoded);
        } catch (e) {
          showError(t('图片读取失败'));
        }
      };
      input.click();
    },
    [t],
  );

  // 轮询任务状态，最长约 10 分钟
  const pollTask = useCallback(
    async (taskId) => {
      const maxAttempts = 200;
      const intervalMs = 3000;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, intervalMs));
        let data;
        try {
          const res = await API.get(`/v1/video/generations/${taskId}`, {
            headers: authHeaders(),
            skipErrorHandler: true,
          });
          data = res?.data?.data || res?.data;
        } catch (e) {
          // 单次网络抖动不终止整体轮询
          continue;
        }
        const status = String(data?.status || '').toUpperCase();
        if (data?.progress) setProgress(String(data.progress));

        if (status === 'SUCCESS' || status === 'SUCCEEDED') {
          const url = data?.result_url || data?.url || '';
          if (url) return [url];
          const msg = t('任务成功但未返回视频地址');
          setErrorMsg(msg);
          showError(msg);
          return null;
        }
        if (status === 'FAILURE' || status === 'FAILED') {
          const msg = data?.fail_reason || t('任务执行失败');
          setErrorMsg(msg);
          showError(msg);
          return null;
        }
      }
      const msg = t('任务超时，请稍后到日志中查看结果');
      setErrorMsg(msg);
      showError(msg);
      return null;
    },
    [authHeaders, t],
  );

  const handleGenerate = useCallback(async () => {
    if (!token.trim()) {
      showError(t('请先填写令牌'));
      return;
    }
    if (!prompt.trim()) {
      showError(t('请输入提示词'));
      return;
    }
    // *-video 模型必须实际带参考视频，这里由 useRefVideo 推导，天然一致
    setLoading(true);
    setErrorMsg('');
    setProgress('');
    setVideos([]);
    try {
      const safeDuration = Math.min(
        DURATION_MAX,
        Math.max(DURATION_MIN, Number(duration) || DURATION_MIN),
      );
      const payload = {
        model,
        prompt: prompt.trim(),
        size: aspect,
        duration: safeDuration,
      };
      if (group) payload.group = group;
      if (refImages.length) payload.referenceImages = refImages;
      if (refVideos.length) payload.referenceVideos = refVideos;
      if (refAudios.length) payload.referenceAudios = refAudios;
      if (supportsFrames && firstImage) payload.first_image = firstImage;
      if (supportsFrames && lastImage) payload.last_image = lastImage;

      // 视频是异步任务：先提交拿 task_id，再轮询任务状态
      const submitRes = await API.post('/v1/video/generations', payload, {
        headers: authHeaders(),
        skipErrorHandler: true,
        timeout: 120000,
      });
      const submitData = submitRes?.data;
      const taskId =
        submitData?.task_id || submitData?.data?.task_id || submitData?.id || '';
      if (!taskId) {
        const msg =
          submitData?.error?.message ||
          submitData?.message ||
          t('提交任务失败，未返回任务 ID');
        setErrorMsg(msg);
        showError(msg);
        return;
      }

      const finalUrls = await pollTask(taskId);
      if (!finalUrls) return;
      setVideos(finalUrls);
      showSuccess(t('生成成功'));
      persistHistory(
        [
          {
            id: Date.now(),
            prompt: prompt.trim(),
            model,
            aspect,
            duration: safeDuration,
            urls: finalUrls,
          },
          ...history,
        ].slice(0, 20),
      );
    } catch (error) {
      const msg =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        t('生成失败');
      setErrorMsg(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  }, [
    token, prompt, model, aspect, duration, group, refImages, refVideos,
    refAudios, supportsFrames, firstImage, lastImage, authHeaders, history,
    persistHistory, pollTask, t,
  ]);

  const renderMaterialRow = (kind, label, items, max, disabled, hint) => (
    <div className='mb-4'>
      <div className='flex items-center justify-between mb-2'>
        <Text strong>
          {t(label)}{' '}
          <Text type='tertiary'>
            ({items.length}/{max})
          </Text>
        </Text>
        <div className='flex gap-2'>
          <Button
            size='small'
            disabled={disabled || items.length >= max}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.multiple = true;
              input.accept =
                kind === 'image'
                  ? 'image/*'
                  : kind === 'video'
                    ? 'video/*'
                    : 'audio/*';
              input.onchange = () => addFiles(input.files, kind);
              input.click();
            }}
          >
            {t('上传')}
          </Button>
          <Button
            size='small'
            theme='borderless'
            disabled={disabled || items.length >= max}
            onClick={() => addLink(kind)}
          >
            {t('添加链接')}
          </Button>
        </div>
      </div>
      {hint && (
        <div className='mb-2'>
          <Text type='tertiary' size='small'>
            {t(hint)}
          </Text>
        </div>
      )}
      <div className='flex flex-wrap gap-2'>
        {items.map((item, index) => (
          <Tag
            key={`${kind}-${index}`}
            closable
            onClose={() => removeAt(kind, index)}
            color={kind === 'image' ? 'blue' : kind === 'video' ? 'violet' : 'green'}
          >
            {item.startsWith('data:')
              ? `${t('本地文件')} ${index + 1}`
              : item.length > 28
                ? `${item.slice(0, 28)}...`
                : item}
          </Tag>
        ))}
      </div>
    </div>
  );

  return (
    <div className='p-4 md:p-6'>
      <div className='flex items-center gap-2 mb-4'>
        <Clapperboard size={22} />
        <Title heading={4} style={{ margin: 0 }}>
          {t('0 帧起手 · 视频生成')}
        </Title>
      </div>

      <div className='flex flex-col lg:flex-row gap-4'>
        <Card className='flex-1' title={t('生成参数')}>
          <div className='mb-4'>
            <Text strong>{t('令牌')}</Text>
            <Input
              value={token}
              onChange={setToken}
              mode='password'
              placeholder='sk-...'
              className='mt-1'
            />
          </div>

          <div className='mb-4'>
            <Text strong>{t('分组')}</Text>
            <Select
              value={group}
              onChange={setGroup}
              optionList={groups}
              placeholder={t('请选择分组')}
              className='mt-1'
              style={{ width: '100%' }}
            />
          </div>

          <div className='mb-4'>
            <Text strong>{t('提示词')}</Text>
            <TextArea
              value={prompt}
              onChange={setPrompt}
              autosize={{ minRows: 3, maxRows: 8 }}
              placeholder={t('描述主体、动作、场景、镜头、光线、风格和节奏')}
              className='mt-1'
            />
          </div>

          <div className='flex flex-col sm:flex-row gap-4 mb-4'>
            <div className='flex-1'>
              <Text strong>{t('版本')}</Text>
              <Select
                value={variant}
                onChange={setVariant}
                optionList={VARIANT_OPTIONS}
                className='mt-1'
                style={{ width: '100%' }}
              />
            </div>
            <div className='flex-1'>
              <Text strong>{t('画面清晰度')}</Text>
              <Select
                value={effectiveResolution}
                onChange={setResolution}
                optionList={RESOLUTION_OPTIONS}
                disabled={isFast}
                className='mt-1'
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div className='flex flex-col sm:flex-row gap-4 mb-4'>
            <div className='flex-1'>
              <Text strong>{t('画面比例')}</Text>
              <Select
                value={aspect}
                onChange={setAspect}
                optionList={ASPECT_OPTIONS}
                className='mt-1'
                style={{ width: '100%' }}
              />
            </div>
            <div className='flex-1'>
              <Text strong>{t('生成时长（秒）')}</Text>
              <InputNumber
                value={duration}
                onChange={setDuration}
                min={DURATION_MIN}
                max={DURATION_MAX}
                step={1}
                className='mt-1'
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div className='mb-4 p-2 rounded' style={{ background: 'var(--semi-color-fill-0)' }}>
            <Text type='tertiary' size='small'>
              {t('实际调用模型')}: <Text code>{model}</Text>
            </Text>
          </div>

          {renderMaterialRow(
            'image',
            '参考图',
            refImages,
            MAX_REF_IMAGES,
            false,
            '支持上传本地图片或添加链接',
          )}
          {renderMaterialRow(
            'video',
            '参考视频',
            refVideos,
            MAX_REF_VIDEOS,
            isFast,
            isFast
              ? 'Fast 版本不支持参考视频'
              : '添加参考视频后会自动切换到对应清晰度的 -video 模型',
          )}
          {renderMaterialRow(
            'audio',
            '参考音频',
            refAudios,
            MAX_REF_AUDIOS,
            false,
            '支持上传本地音频或添加链接',
          )}

          <div className='mb-4'>
            <Text strong>{t('首尾帧')}</Text>
            <div className='mb-2'>
              <Text type='tertiary' size='small'>
                {supportsFrames
                  ? t('仅标准版非参考视频模型支持，建议首帧和尾帧同时传入')
                  : t('当前模型不支持首尾帧（Fast 版本或使用了参考视频）')}
              </Text>
            </div>
            <div className='flex gap-2'>
              <Button
                size='small'
                disabled={!supportsFrames}
                onClick={() => pickFrame('first')}
              >
                {firstImage ? t('首帧已选择') : t('选择首帧')}
              </Button>
              {firstImage && (
                <Button
                  size='small'
                  theme='borderless'
                  type='danger'
                  onClick={() => setFirstImage('')}
                >
                  {t('清除')}
                </Button>
              )}
              <Button
                size='small'
                disabled={!supportsFrames}
                onClick={() => pickFrame('last')}
              >
                {lastImage ? t('尾帧已选择') : t('选择尾帧')}
              </Button>
              {lastImage && (
                <Button
                  size='small'
                  theme='borderless'
                  type='danger'
                  onClick={() => setLastImage('')}
                >
                  {t('清除')}
                </Button>
              )}
            </div>
          </div>

          <Button
            theme='solid'
            block
            loading={loading}
            onClick={handleGenerate}
          >
            {loading ? t('生成中，请稍候') : t('生成视频')}
          </Button>
        </Card>

        <Card className='flex-1' title={t('生成结果')}>
          {loading && (
            <div className='flex flex-col items-center justify-center py-12 gap-3'>
              <Spin size='large' />
              <Text type='tertiary'>
                {progress
                  ? `${t('生成进度')} ${progress}`
                  : t('视频生成通常需要数十秒到数分钟')}
              </Text>
            </div>
          )}

          {!loading && errorMsg && (
            <div className='py-8'>
              <Text type='danger'>{errorMsg}</Text>
            </div>
          )}

          {!loading && !errorMsg && !videos.length && (
            <Empty description={t('还没有生成结果')} />
          )}

          {!loading && videos.length > 0 && (
            <div className='flex flex-col gap-4'>
              {videos.map((url, index) => (
                <video
                  key={index}
                  src={url}
                  controls
                  className='w-full rounded'
                  style={{ maxHeight: 420, background: '#000' }}
                />
              ))}
            </div>
          )}

          {history.length > 0 && (
            <div className='mt-6'>
              <Text strong>{t('历史记录')}</Text>
              <div className='flex flex-col gap-2 mt-2'>
                {history.map((item) => (
                  <div
                    key={item.id}
                    className='p-2 rounded cursor-pointer'
                    style={{ background: 'var(--semi-color-fill-0)' }}
                    onClick={() => {
                      setVideos(item.urls || []);
                      setErrorMsg('');
                    }}
                  >
                    <Text ellipsis={{ showTooltip: true }} style={{ width: '100%' }}>
                      {item.prompt}
                    </Text>
                    <Text type='tertiary' size='small'>
                      {item.model} · {item.aspect} · {item.duration}s
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default VideoStudio;
