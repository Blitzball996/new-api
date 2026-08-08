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
import { Clapperboard, Clock } from 'lucide-react';
import { UserContext } from '../../context/User';
import { API, showError, showSuccess, processGroupsData } from '../../helpers';

const { Text, Title } = Typography;

// 令牌与生图页共用：任一处填过就不用再填
const TOKEN_STORAGE_KEY = 'video_studio_token';
const IMAGE_TOKEN_STORAGE_KEY = 'imagestudio_token';
const HISTORY_STORAGE_KEY = 'video_studio_history';
const SETTINGS_STORAGE_KEY = 'video_studio_settings';
const MAX_HISTORY = 50;

const MAX_REF_IMAGES = 9;
const MAX_REF_VIDEOS = 3;
const MAX_REF_AUDIOS = 3;

const DURATION_MIN = 6;
const DURATION_MAX = 15;
// 画面比例走接口 size 字段
const ASPECT_OPTIONS = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '1:1', value: '1:1' },
  { label: '3:4', value: '3:4' },
  { label: '4:3', value: '4:3' },
  { label: '21:9', value: '21:9' },
];

// 清晰度不作为 model 写死项，改为写入 prompt 的提示信息
const RESOLUTION_OPTIONS = [
  { label: '不指定', value: '' },
  { label: '720p', value: '720p' },
  { label: '1080p', value: '1080p' },
  { label: '2K', value: '2k' },
  { label: '4K', value: '4k' },
];

// 视频模型识别关键字，用于把视频模型排到列表前面
const VIDEO_MODEL_KEYWORDS = [
  'video',
  'seedance',
  'sora',
  'kling',
  'hailuo',
  'vidu',
  'jimeng',
  'wan',
  'veo',
  'runway',
  'pika',
  'minimax',
];
const isVideoModel = (id) => {
  const lower = String(id).toLowerCase();
  return VIDEO_MODEL_KEYWORDS.some((kw) => lower.includes(kw));
};

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (e) {
    return fallback;
  }
};

const loadHistory = () => {
  const parsed = readJson(HISTORY_STORAGE_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
};

const loadSettings = () => {
  const parsed = readJson(SETTINGS_STORAGE_KEY, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
};

const loadToken = () =>
  localStorage.getItem(TOKEN_STORAGE_KEY) ||
  localStorage.getItem(IMAGE_TOKEN_STORAGE_KEY) ||
  '';

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

// 视频地址读取优先级（接口文档第 9 节）
const extractVideoUrl = (data) => {
  if (!data) return '';
  return (
    data.result_url ||
    data.video_url ||
    data.url ||
    data?.data?.video_url ||
    data?.data?.url ||
    data?.data?.output?.video_url ||
    data?.output?.video_url ||
    ''
  );
};

// 清晰度/比例等约束以提示词形式追加，不改写 model
const buildPromptSuffix = (resolution, aspect, extraJson) => {
  const parts = [];
  if (resolution) parts.push(`分辨率 ${resolution}`);
  if (aspect) parts.push(`画面比例 ${aspect}`);
  if (extraJson.trim()) parts.push(extraJson.trim());
  return parts;
};
const VideoStudio = () => {
  const { t } = useTranslation();
  const [userState] = useContext(UserContext);
  const saved = loadSettings();

  const [token, setToken] = useState(loadToken);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(saved.model || '');
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState(saved.group || '');
  const [prompt, setPrompt] = useState('');

  const [resolution, setResolution] = useState(saved.resolution ?? '1080p');
  const [aspect, setAspect] = useState(saved.aspect || '16:9');
  const [duration, setDuration] = useState(saved.duration || 6);
  // 额外 JSON / 提示片段，会拼进 prompt
  const [extraJson, setExtraJson] = useState(saved.extraJson || '');

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
  const [showHistory, setShowHistory] = useState(true);

  const authHeaders = useCallback(() => {
    let key = token.trim();
    if (key && !key.startsWith('sk-')) key = `sk-${key}`;
    return key
      ? { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }, [token]);

  // 令牌只填一次：写入本地并与生图页共用
  useEffect(() => {
    const key = token.trim();
    if (!key) return;
    localStorage.setItem(TOKEN_STORAGE_KEY, key);
    if (!localStorage.getItem(IMAGE_TOKEN_STORAGE_KEY)) {
      localStorage.setItem(IMAGE_TOKEN_STORAGE_KEY, key);
    }
  }, [token]);

  // 记住表单选择，刷新后不用重填
  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          model,
          group,
          resolution,
          aspect,
          duration,
          extraJson,
        }),
      );
    } catch (e) {
      // 存储配额不足时忽略
    }
  }, [model, group, resolution, aspect, duration, extraJson]);

  const loadModels = useCallback(
    async (silent = false) => {
      if (!token.trim()) {
        if (!silent) showError(t('请先填写令牌'));
        return;
      }
      try {
        const res = await API.get('/v1/models', {
          headers: authHeaders(),
          skipErrorHandler: true,
        });
        const list = res?.data?.data;
        if (!Array.isArray(list)) {
          if (!silent) showError(t('加载模型失败'));
          return;
        }
        const ids = list.map((item) => item?.id).filter(Boolean);
        const videoIds = ids.filter(isVideoModel).sort();
        const otherIds = ids.filter((id) => !isVideoModel(id)).sort();
        const options = [...videoIds, ...otherIds].map((id) => ({
          label: id,
          value: id,
        }));
        setModels(options);
        if (!options.length) {
          if (!silent) showError(t('该令牌下没有可用模型'));
          return;
        }
        setModel((cur) => cur || videoIds[0] || options[0].value);
        if (!silent) showSuccess(t('模型列表已更新'));
      } catch (e) {
        if (!silent) {
          showError(
            e?.response?.data?.error?.message || t('加载模型失败，请检查令牌'),
          );
        }
      }
    },
    [token, authHeaders, t],
  );

  const loadGroups = useCallback(async () => {
    try {
      const res = await API.get('/api/user/self/groups');
      const { success, data } = res.data;
      if (!success) return;
      const userGroup =
        userState?.user?.group ||
        JSON.parse(localStorage.getItem('user') || '{}')?.group;
      // 显示分组名称而不是分组注释
      const options = processGroupsData(data, userGroup).map((item) => ({
        ...item,
        label: item.value || item.label,
      }));
      setGroups(options);
      setGroup((cur) => {
        if (cur) return cur;
        const preferred = options.find((g) => /video/i.test(g.value || ''));
        return preferred ? preferred.value : cur;
      });
    } catch (error) {
      // 分组加载失败不阻塞主流程
    }
  }, [userState]);

  useEffect(() => {
    loadGroups();
    if (token.trim()) loadModels(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persistHistory = useCallback((next) => {
    const trimmed = next.slice(0, MAX_HISTORY);
    setHistory(trimmed);
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      // 超出存储配额时忽略
    }
  }, []);

  const clearHistory = useCallback(() => persistHistory([]), [persistHistory]);

  const setterFor = (kind) =>
    kind === 'image'
      ? setRefImages
      : kind === 'video'
        ? setRefVideos
        : setRefAudios;

  const maxFor = (kind) =>
    kind === 'image'
      ? MAX_REF_IMAGES
      : kind === 'video'
        ? MAX_REF_VIDEOS
        : MAX_REF_AUDIOS;

  const addFiles = useCallback(
    async (files, kind) => {
      const list = Array.from(files || []);
      if (!list.length) return;
      const setter = setterFor(kind);
      const max = maxFor(kind);
      try {
        const encoded = await Promise.all(
          list.map((f) =>
            kind === 'image' ? compressRefImage(f) : fileToBase64(f),
          ),
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
        kind === 'image'
          ? '参考图'
          : kind === 'video'
            ? '参考视频'
            : '参考音频';
      const url = window.prompt(t('请输入{{label}}链接', { label }));
      if (!url || !url.trim()) return;
      const setter = setterFor(kind);
      const max = maxFor(kind);
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
    setterFor(kind)((prev) => prev.filter((_, i) => i !== index));
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
        const status = String(
          data?.status || data?.data?.status || '',
        ).toUpperCase();
        if (data?.progress) setProgress(String(data.progress));

        if (
          status === 'SUCCESS' ||
          status === 'SUCCEEDED' ||
          status === 'COMPLETED'
        ) {
          const url = extractVideoUrl(data);
          if (url) return [url];
          const msg = t('任务成功但未返回视频地址');
          setErrorMsg(msg);
          showError(msg);
          return null;
        }
        if (status === 'FAILURE' || status === 'FAILED') {
          const msg =
            data?.fail_reason ||
            data?.error?.message ||
            data?.error ||
            t('任务执行失败');
          setErrorMsg(String(msg));
          showError(String(msg));
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
    if (!model.trim()) {
      showError(t('请选择或输入视频模型'));
      return;
    }
    if (!prompt.trim()) {
      showError(t('请输入提示词'));
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setProgress('');
    setVideos([]);
    try {
      const safeDuration = Math.min(
        DURATION_MAX,
        Math.max(DURATION_MIN, Number(duration) || DURATION_MIN),
      );
      const basePrompt = prompt.trim();
      // 分辨率、比例、附加 JSON 都写进 prompt，不改写 model
      const suffix = buildPromptSuffix(resolution, aspect, extraJson).filter(
        (part) => !basePrompt.includes(part),
      );
      const finalPrompt = suffix.length
        ? `${basePrompt}，${suffix.join('，')}`
        : basePrompt;

      const usingModel = model.trim();
      const payload = {
        model: usingModel,
        prompt: finalPrompt,
        size: aspect,
        duration: safeDuration,
      };
      if (group) payload.group = group;
      if (refImages.length) payload.referenceImages = refImages;
      if (refVideos.length) payload.referenceVideos = refVideos;
      if (refAudios.length) payload.referenceAudios = refAudios;
      if (firstImage) payload.first_image = firstImage;
      if (lastImage) payload.last_image = lastImage;

      // 视频是异步任务：先提交拿 task_id，再轮询任务状态
      const submitRes = await API.post('/v1/video/generations', payload, {
        headers: authHeaders(),
        skipErrorHandler: true,
        timeout: 120000,
      });
      const submitData = submitRes?.data;
      const taskId =
        submitData?.task_id ||
        submitData?.data?.task_id ||
        submitData?.id ||
        '';
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
      persistHistory([
        {
          id: `${taskId}-${Date.now()}`,
          ts: new Date().toLocaleString(),
          prompt: basePrompt,
          model: usingModel,
          resolution,
          aspect,
          duration: safeDuration,
          urls: finalUrls,
        },
        ...history,
      ]);
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
    token,
    model,
    prompt,
    resolution,
    aspect,
    duration,
    extraJson,
    group,
    refImages,
    refVideos,
    refAudios,
    firstImage,
    lastImage,
    authHeaders,
    history,
    persistHistory,
    pollTask,
    t,
  ]);

  const renderMaterialRow = (kind, label, items, max, hint) => (
    <div>
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
            disabled={items.length >= max}
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
            disabled={items.length >= max}
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
            color={
              kind === 'image' ? 'blue' : kind === 'video' ? 'violet' : 'green'
            }
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
    <div className='mt-[64px] px-2 pb-6'>
      <div className='mx-auto max-w-3xl flex flex-col gap-4 pt-6'>
        {/* 生成表单 */}
        <Card>
          <div className='flex items-center gap-2 mb-2'>
            <Clapperboard size={20} />
            <Title heading={4} className='!mb-0'>
              {t('0 帧起手 · 视频生成')}
            </Title>
          </div>
          <Text type='tertiary'>
            {t(
              '输入令牌，选择模型，描述画面，费用从该令牌扣除。分辨率与比例会写进提示词，不会改写模型名。',
            )}
          </Text>

          <div className='mt-4 flex flex-col gap-4'>
            {/* 令牌 */}
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
                <Button onClick={() => loadModels(false)}>
                  {t('加载模型')}
                </Button>
              </div>
              <Text type='tertiary' size='small'>
                {t('令牌已保存在本地，下次进入无需重填')}
              </Text>
            </div>

            {/* 模型 + 分组 */}
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

            {/* 分辨率 + 比例 + 时长 */}
            <div className='flex flex-col sm:flex-row gap-4'>
              <div className='flex-1'>
                <Text strong>{t('分辨率')}</Text>
                <Select
                  value={resolution}
                  onChange={setResolution}
                  optionList={RESOLUTION_OPTIONS}
                  className='mt-1 w-full'
                />
              </div>
              <div className='flex-1'>
                <Text strong>{t('画面比例')}</Text>
                <Select
                  value={aspect}
                  onChange={setAspect}
                  optionList={ASPECT_OPTIONS}
                  filter
                  allowCreate
                  className='mt-1 w-full'
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
                  className='mt-1 w-full'
                />
              </div>
            </div>

            {/* 提示词 */}
            <div>
              <Text strong>{t('提示词')}</Text>
              <TextArea
                value={prompt}
                onChange={setPrompt}
                autosize={{ minRows: 4, maxRows: 20 }}
                placeholder={t('描述主体、动作、场景、镜头、光线、风格和节奏')}
                className='mt-1'
              />
            </div>

            {/* 附加提示词 / JSON */}
            <div>
              <Text strong>{t('附加提示词 / JSON（可选）')}</Text>
              <TextArea
                value={extraJson}
                onChange={setExtraJson}
                autosize={{ minRows: 2, maxRows: 10 }}
                placeholder={t('例如镜头脚本 JSON，会追加到提示词末尾')}
                className='mt-1'
              />
            </div>

            {renderMaterialRow(
              'image',
              '参考图',
              refImages,
              MAX_REF_IMAGES,
              '支持上传本地图片或添加链接',
            )}
            {renderMaterialRow(
              'video',
              '参考视频',
              refVideos,
              MAX_REF_VIDEOS,
              '部分模型需要使用对应的参考视频模型名',
            )}
            {renderMaterialRow(
              'audio',
              '参考音频',
              refAudios,
              MAX_REF_AUDIOS,
              '支持上传本地音频或添加链接',
            )}

            {/* 首尾帧 */}
            <div>
              <Text strong>{t('首尾帧（可选）')}</Text>
              <div className='mb-2'>
                <Text type='tertiary' size='small'>
                  {t('建议首帧和尾帧同时传入，是否生效取决于所选模型')}
                </Text>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button size='small' onClick={() => pickFrame('first')}>
                  {firstImage ? t('首帧已选择') : t('选择首帧')}
                </Button>
                {firstImage && (
                  <Button
                    size='small'
                    theme='borderless'
                    type='danger'
                    onClick={() => setFirstImage('')}
                  >
                    {t('清除首帧')}
                  </Button>
                )}
                <Button size='small' onClick={() => pickFrame('last')}>
                  {lastImage ? t('尾帧已选择') : t('选择尾帧')}
                </Button>
                {lastImage && (
                  <Button
                    size='small'
                    theme='borderless'
                    type='danger'
                    onClick={() => setLastImage('')}
                  >
                    {t('清除尾帧')}
                  </Button>
                )}
              </div>
            </div>

            <Button
              theme='solid'
              size='large'
              block
              loading={loading}
              disabled={loading}
              onClick={handleGenerate}
            >
              {loading ? t('生成中，请稍候') : t('生成视频')}
            </Button>
          </div>
        </Card>
        {/* 当次结果 */}
        <Card title={t('生成结果')}>
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
              <div className='flex flex-wrap gap-2 items-center'>
                <Tag>{model}</Tag>
                {resolution && <Tag>{resolution}</Tag>}
                <Tag>{aspect}</Tag>
                <Tag>{duration}s</Tag>
              </div>
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
        </Card>

        {/* 历史记录 */}
        <Card
          title={
            <div className='flex items-center justify-between w-full'>
              <div className='flex items-center gap-2'>
                <Clock size={16} />
                <span>
                  {t('历史记录')}（{history.length}）
                </span>
              </div>
              <div className='flex gap-2'>
                <Button size='small' onClick={() => setShowHistory((v) => !v)}>
                  {showHistory ? t('收起') : t('展开')}
                </Button>
                {history.length > 0 && (
                  <Button size='small' type='danger' onClick={clearHistory}>
                    {t('清空')}
                  </Button>
                )}
              </div>
            </div>
          }
        >
          {!showHistory && (
            <Text type='tertiary'>{t('点击「展开」查看历史生成记录')}</Text>
          )}
          {showHistory && history.length === 0 && (
            <Empty description={t('暂无历史记录')} />
          )}
          {showHistory && history.length > 0 && (
            <div className='flex flex-col gap-6'>
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className='border-b border-gray-100 pb-4 last:border-0 last:pb-0'
                >
                  <div className='flex flex-wrap gap-2 mb-2 items-center'>
                    <Tag>{entry.model}</Tag>
                    {entry.resolution && <Tag>{entry.resolution}</Tag>}
                    {entry.aspect && <Tag>{entry.aspect}</Tag>}
                    {entry.duration && <Tag>{entry.duration}s</Tag>}
                    {entry.ts && (
                      <Text type='tertiary' size='small'>
                        {entry.ts}
                      </Text>
                    )}
                  </div>
                  <Text
                    type='tertiary'
                    size='small'
                    ellipsis={{ rows: 2 }}
                    className='mb-2'
                  >
                    {entry.prompt}
                  </Text>
                  <div className='flex flex-wrap gap-3'>
                    {(entry.urls || []).map((url, idx) => (
                      <video
                        key={`${entry.id}-${idx}`}
                        src={url}
                        controls
                        className='rounded'
                        style={{
                          maxHeight: 200,
                          maxWidth: '100%',
                          background: '#000',
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default VideoStudio;
