import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Badge,
  Button,
  Card,
  Empty,
  Input,
  List,
  Select,
  Spin,
  Tabs,
  TabPane,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { Headphones, Send, RefreshCw, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess, isAdmin } from '../../helpers';

const { Text, Title } = Typography;

const POLL_INTERVAL = 5000;
const MAX_LEN = 4000;

const formatTime = (ts) => {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleString();
};

/**
 * 消息气泡列表。用户视角 own=user，客服视角 own=admin。
 */
const MessageList = ({ messages, own, loading, emptyHint }) => {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  if (loading && messages.length === 0) {
    return (
      <div className='flex justify-center py-10'>
        <Spin />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className='py-10'>
        <Empty description={emptyHint} />
      </div>
    );
  }

  return (
    <div
      className='flex flex-col gap-3 overflow-y-auto px-1'
      style={{ maxHeight: 420, minHeight: 240 }}
      role='log'
      aria-live='polite'
      aria-label='对话消息'
    >
      {messages.map((m) => {
        const mine = m.sender_role === own;
        return (
          <div
            key={m.id}
            className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
          >
            <div className='max-w-[78%]'>
              <div
                className={`text-xs mb-1 ${mine ? 'text-right' : 'text-left'}`}
              >
                <Text type='tertiary'>
                  {m.sender_role === 'admin' ? '客服' : m.sender_name || '用户'}
                  {' · '}
                  {formatTime(m.created_at)}
                </Text>
              </div>
              <div
                className='rounded-lg px-3 py-2 whitespace-pre-wrap break-words'
                style={{
                  background: mine
                    ? 'var(--semi-color-primary-light-default)'
                    : 'var(--semi-color-fill-0)',
                }}
              >
                {m.content}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
};
/**
 * 用户侧：只有一个会话，进来直接聊。
 */
const UserChat = () => {
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const lastIdRef = useRef(0);

  const load = useCallback(async (incremental) => {
    try {
      const afterId = incremental ? lastIdRef.current : 0;
      const res = await API.get(
        `/api/support/conversation?after_id=${afterId}`,
      );
      const { success, message, data } = res.data;
      if (!success) {
        if (!incremental) showError(message);
        return;
      }
      const list = data.messages || [];
      if (incremental) {
        if (list.length > 0) {
          setMessages((prev) => [...prev, ...list]);
          lastIdRef.current = list[list.length - 1].id;
        }
      } else {
        setMessages(list);
        if (list.length > 0) lastIdRef.current = list[list.length - 1].id;
      }
    } catch (err) {
      if (!incremental) showError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const timer = setInterval(() => load(true), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [load]);

  const send = async () => {
    const text = content.trim();
    if (!text) return;
    if (text.length > MAX_LEN) {
      showError(t('消息内容过长'));
      return;
    }
    setSending(true);
    try {
      const res = await API.post('/api/support/message', { content: text });
      const { success, message, data } = res.data;
      if (!success) {
        showError(message);
        return;
      }
      setContent('');
      setMessages((prev) => [...prev, data]);
      lastIdRef.current = data.id;
    } catch (err) {
      showError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <div className='flex items-center gap-2 mb-3'>
        <Headphones size={18} />
        <Title heading={5} className='!mb-0'>
          {t('在线客服')}
        </Title>
        <Text type='tertiary' size='small'>
          {t('工作时间内通常几分钟内回复')}
        </Text>
      </div>
      <MessageList
        messages={messages}
        own='user'
        loading={loading}
        emptyHint={t('还没有消息，说明下你遇到的问题吧')}
      />
      <div className='mt-3 flex flex-col gap-2'>
        <Input
          value={content}
          onChange={setContent}
          placeholder={t('输入消息，回车发送')}
          maxLength={MAX_LEN}
          onEnterPress={send}
          disabled={sending}
          aria-label={t('消息输入框')}
        />
        <div className='flex justify-end'>
          <Button
            theme='solid'
            icon={<Send size={14} />}
            loading={sending}
            onClick={send}
            disabled={!content.trim()}
          >
            {t('发送')}
          </Button>
        </div>
      </div>
    </Card>
  );
};
/**
 * 客服侧：左边会话列表，右边对话窗口。
 */
const AdminConsole = () => {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState([]);
  const [status, setStatus] = useState('open');
  const [keyword, setKeyword] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const lastIdRef = useRef(0);
  const activeIdRef = useRef(null);

  activeIdRef.current = activeId;

  const loadList = useCallback(async () => {
    try {
      const params = new URLSearchParams({ p: '1', page_size: '50' });
      if (status) params.set('status', status);
      if (keyword.trim()) params.set('keyword', keyword.trim());
      const res = await API.get(`/api/support/admin/conversations?${params}`);
      const { success, message, data } = res.data;
      if (!success) {
        showError(message);
        return;
      }
      setConversations(data.items || []);
    } catch (err) {
      showError(err.message);
    } finally {
      setListLoading(false);
    }
  }, [status, keyword]);

  const loadMessages = useCallback(async (convId, incremental) => {
    if (!convId) return;
    if (!incremental) setMsgLoading(true);
    try {
      const afterId = incremental ? lastIdRef.current : 0;
      const res = await API.get(
        `/api/support/admin/conversations/${convId}?after_id=${afterId}`,
      );
      const { success, data } = res.data;
      if (!success) return;
      // 轮询期间用户可能切了会话，丢弃过期响应
      if (activeIdRef.current !== convId) return;
      const list = data.messages || [];
      if (incremental) {
        if (list.length > 0) {
          setMessages((prev) => [...prev, ...list]);
          lastIdRef.current = list[list.length - 1].id;
        }
      } else {
        setMessages(list);
        lastIdRef.current = list.length ? list[list.length - 1].id : 0;
      }
    } catch (err) {
      if (!incremental) showError(err.message);
    } finally {
      if (!incremental) setMsgLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (!activeId) return;
    loadMessages(activeId, false);
  }, [activeId, loadMessages]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadList();
      if (activeIdRef.current) loadMessages(activeIdRef.current, true);
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [loadList, loadMessages]);

  const send = async () => {
    const text = content.trim();
    if (!text || !activeId) return;
    setSending(true);
    try {
      const res = await API.post(
        `/api/support/admin/conversations/${activeId}/message`,
        { content: text },
      );
      const { success, message, data } = res.data;
      if (!success) {
        showError(message);
        return;
      }
      setContent('');
      setMessages((prev) => [...prev, data]);
      lastIdRef.current = data.id;
      loadList();
    } catch (err) {
      showError(err.message);
    } finally {
      setSending(false);
    }
  };

  const toggleStatus = async (next) => {
    if (!activeId) return;
    try {
      const res = await API.put(
        `/api/support/admin/conversations/${activeId}/status`,
        { status: next },
      );
      if (!res.data.success) {
        showError(res.data.message);
        return;
      }
      showSuccess(next === 'closed' ? t('会话已关闭') : t('会话已重开'));
      loadList();
    } catch (err) {
      showError(err.message);
    }
  };

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId),
    [conversations, activeId],
  );

  return (
    <div className='flex flex-col md:flex-row gap-4'>
      <Card className='md:w-[320px] md:shrink-0'>
        <div className='flex flex-col gap-2 mb-3'>
          <div className='flex items-center gap-2'>
            <Select
              value={status}
              onChange={setStatus}
              className='flex-1'
              aria-label={t('会话状态筛选')}
            >
              <Select.Option value='open'>{t('进行中')}</Select.Option>
              <Select.Option value='closed'>{t('已关闭')}</Select.Option>
              <Select.Option value=''>{t('全部')}</Select.Option>
            </Select>
            <Button
              icon={<RefreshCw size={14} />}
              onClick={loadList}
              aria-label={t('刷新列表')}
            />
          </div>
          <Input
            value={keyword}
            onChange={setKeyword}
            placeholder={t('搜索用户名')}
            showClear
            aria-label={t('搜索用户名')}
          />
        </div>
        {listLoading ? (
          <div className='flex justify-center py-6'>
            <Spin />
          </div>
        ) : conversations.length === 0 ? (
          <Empty description={t('暂无会话')} />
        ) : (
          <List
            dataSource={conversations}
            style={{ maxHeight: 480, overflowY: 'auto' }}
            renderItem={(item) => (
              <List.Item
                onClick={() => setActiveId(item.id)}
                className='cursor-pointer'
                style={{
                  background:
                    item.id === activeId
                      ? 'var(--semi-color-primary-light-default)'
                      : undefined,
                  borderRadius: 6,
                }}
              >
                <div className='w-full'>
                  <div className='flex items-center justify-between gap-2'>
                    <div className='flex items-center gap-1 min-w-0'>
                      <User size={14} />
                      <Text strong ellipsis>
                        {item.username || `#${item.user_id}`}
                      </Text>
                    </div>
                    {item.unread_admin > 0 && (
                      <Badge count={item.unread_admin} type='danger' />
                    )}
                  </div>
                  <Text
                    type='tertiary'
                    size='small'
                    ellipsis={{ showTooltip: false }}
                    className='block'
                  >
                    {item.last_message || t('（无消息）')}
                  </Text>
                  <Text type='quaternary' size='small'>
                    {formatTime(item.last_message_at)}
                  </Text>
                </div>
              </List.Item>
            )}
          />
        )}
      </Card>

      <Card className='flex-1 min-w-0'>
        {!activeId ? (
          <div className='py-16'>
            <Empty description={t('从左侧选择一个会话')} />
          </div>
        ) : (
          <>
            <div className='flex items-center justify-between gap-2 mb-3 flex-wrap'>
              <div className='flex items-center gap-2'>
                <Text strong>{active?.username || `#${active?.user_id}`}</Text>
                <Tag color={active?.status === 'closed' ? 'grey' : 'green'}>
                  {active?.status === 'closed' ? t('已关闭') : t('进行中')}
                </Tag>
              </div>
              <Button
                size='small'
                onClick={() =>
                  toggleStatus(active?.status === 'closed' ? 'open' : 'closed')
                }
              >
                {active?.status === 'closed' ? t('重开会话') : t('关闭会话')}
              </Button>
            </div>
            <MessageList
              messages={messages}
              own='admin'
              loading={msgLoading}
              emptyHint={t('该用户还没有发言')}
            />
            <div className='mt-3 flex flex-col gap-2'>
              <Input
                value={content}
                onChange={setContent}
                placeholder={t('输入回复，回车发送')}
                maxLength={MAX_LEN}
                onEnterPress={send}
                disabled={sending}
                aria-label={t('回复输入框')}
              />
              <div className='flex justify-end'>
                <Button
                  theme='solid'
                  icon={<Send size={14} />}
                  loading={sending}
                  onClick={send}
                  disabled={!content.trim()}
                >
                  {t('发送')}
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

const Support = () => {
  const { t } = useTranslation();
  const admin = isAdmin();

  if (!admin) {
    return (
      <div className='mt-[64px] px-2 pb-6'>
        <div className='mx-auto max-w-3xl pt-6'>
          <UserChat />
        </div>
      </div>
    );
  }

  return (
    <div className='mt-[64px] px-2 pb-6'>
      <div className='mx-auto max-w-6xl pt-6'>
        <Tabs type='line'>
          <TabPane tab={t('客服工作台')} itemKey='admin'>
            <div className='pt-3'>
              <AdminConsole />
            </div>
          </TabPane>
          <TabPane tab={t('我的咨询')} itemKey='mine'>
            <div className='pt-3 max-w-3xl'>
              <UserChat />
            </div>
          </TabPane>
        </Tabs>
      </div>
    </div>
  );
};

export default Support;
