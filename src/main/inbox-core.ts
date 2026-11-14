import { createHash } from 'node:crypto';
import type { Account } from '../shared/types';
import type { InboxCandidate, InboxData, InboxEntry, InboxKind } from '../shared/inbox';

export const newInbox = (): InboxData => ({
  schema: 1, entries: [], channels: [],
  settings: { enabled: true, notifications: true, intervalSeconds: 90, closeToTray: true },
});
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const inboxId = (accountId: string, kind: InboxKind, remoteId: string) => hash([accountId, kind, remoteId]);
export const inboxChannelId = (accountId: string, kind: InboxKind) => accountId + ':' + kind;
export function parseInbox(value: unknown): InboxData {
  const data = value as InboxData;
  if (!data || data.schema !== 1 || !Array.isArray(data.entries) || !Array.isArray(data.channels) || !data.settings) throw new Error('消息记录格式无效');
  for (const item of data.entries) {
    if (!item || !['comment', 'private'].includes(item.kind) || !['none','sending','sent','uncertain'].includes(item.replyStatus) || !Array.isArray(item.replies) ||
      !['id','accountId','remoteId','threadId','authorId','author','text','sourceUrl','fingerprint'].every(k => typeof item[k as keyof InboxEntry] === 'string')) throw new Error('消息条目格式无效');
  }
  if (typeof data.settings.enabled !== 'boolean' || typeof data.settings.notifications !== 'boolean' || typeof data.settings.closeToTray !== 'boolean' || !Number.isFinite(data.settings.intervalSeconds)) throw new Error('消息设置无效');
  data.settings.intervalSeconds = Math.min(600, Math.max(60, data.settings.intervalSeconds));
  return data;
}

/** Merge a complete or partial poll without deleting older messages. First sync is silent. */
export function mergeInbox(data: InboxData, account: Account, kind: InboxKind, candidates: InboxCandidate[], now = Date.now()) {
  let channel = data.channels.find(c => c.accountId === account.id && c.kind === kind);
  if (!channel) { channel = { accountId: account.id, kind, status: 'waiting', detail: '' }; data.channels.push(channel); }
  const first = !channel.initialized;
  const index = new Map(data.entries.map(item => [item.id, item]));
  const notifications: string[] = [];
  for (const raw of candidates) {
    if (!raw.remoteId || !raw.threadId || !raw.text || typeof raw.remoteId !== 'string') continue;
    const id = inboxId(account.id, kind, raw.remoteId);
    // Relative labels ("1 分钟前") must not generate a new message on every poll.
    const fingerprint = hash([raw.text, raw.timestamp || 0]);
    const existing = index.get(id);
    if (existing) {
      const changed = existing.fingerprint !== fingerprint;
      // Some official inboxes omit message direction. Detect changed conversations,
      // excluding a recent reply that this app itself just sent.
      const ownReply = kind === 'private' && raw.direction !== 'incoming' && existing.replies.some(reply =>
        reply.text === raw.text && Math.abs((raw.timestamp || now) - reply.at) < 5 * 60 * 1000);
      const incoming = kind === 'comment' || (raw.direction !== 'outgoing' && !ownReply);
      Object.assign(existing, raw, { fingerprint, updatedAt: changed ? now : existing.updatedAt });
      if (changed && incoming) {
        existing.unread = true;
        if (kind === 'private' && !['sending','uncertain'].includes(existing.replyStatus)) existing.replyStatus = 'none';
        if (!first) notifications.push(id);
      }
      continue;
    }
    const incoming = raw.direction !== 'outgoing';
    const unread = incoming && (first ? raw.sourceUnread === true : true);
    const item: InboxEntry = { ...raw, id, accountId: account.id, platform: account.platform, kind, fingerprint, unread,
      receivedAt: now, updatedAt: now, replyStatus: 'none', replies: [] };
    data.entries.push(item); index.set(id, item);
    if (!first && incoming) notifications.push(id);
  }
  channel.initialized = true; channel.lastSuccess = now; channel.lastAttempt = now;
  channel.status = 'ready'; channel.detail = '';
  return notifications;
}

export function beginReply(data: InboxData, id: string, text: string) {
  const item = data.entries.find(e => e.id === id);
  if (!item) throw new Error('消息不存在，请刷新列表');
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('请输入 1～2000 字的回复');
  if (item.replyStatus === 'sending') throw new Error('该条回复正在发送，请稍候');
  if (item.replyStatus === 'uncertain') throw new Error('上一条回复结果待核对，请先在平台会话中核对，避免重复发送');
  item.replyStatus = 'sending'; item.replyDraft = text;
  return item;
}
export function finishReply(data: InboxData, id: string, text: string, status: 'sent' | 'uncertain', now = Date.now()) {
  const item = data.entries.find(e => e.id === id); if (!item) return;
  item.replyStatus = status;
  item.replies.push({ text, at: now, status });
  if (status === 'sent') { item.unread = false; item.replyDraft = ''; }
}
export function recoverReplies(data: InboxData) {
  for (const item of data.entries) if (item.replyStatus === 'sending') item.replyStatus = 'uncertain';
}
