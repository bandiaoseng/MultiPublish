import type { Platform } from './types';

export type InboxKind = 'comment' | 'private';
export type InboxConnection = 'waiting' | 'syncing' | 'ready' | 'login_required' | 'unavailable' | 'error';
export interface InboxEntry {
  id: string;
  accountId: string;
  platform: Platform;
  kind: InboxKind;
  remoteId: string;
  threadId: string;
  authorId: string;
  author: string;
  text: string;
  context: string;
  postId?: string;
  sourceUrl: string;
  timestamp?: number;
  timeLabel?: string;
  fingerprint: string;
  unread: boolean;
  receivedAt: number;
  updatedAt: number;
  replyStatus: 'none' | 'sending' | 'sent' | 'uncertain';
  replies: Array<{ text: string; at: number; status: 'sent' | 'uncertain' }>;
  replyDraft?: string;
  sourceUnread?: boolean;
  direction?: 'incoming' | 'outgoing' | 'unknown';
}
export type InboxCandidate = Pick<InboxEntry, 'remoteId' | 'threadId' | 'authorId' | 'author' | 'text' | 'context' | 'sourceUrl'> &
  Partial<Pick<InboxEntry, 'postId' | 'timestamp' | 'timeLabel' | 'sourceUnread' | 'direction'>>;
export interface InboxChannel {
  accountId: string;
  kind: InboxKind;
  status: InboxConnection;
  detail: string;
  lastAttempt?: number;
  lastSuccess?: number;
  initialized?: boolean;
}
export interface InboxData {
  schema: 1;
  entries: InboxEntry[];
  channels: InboxChannel[];
  settings: { enabled: boolean; notifications: boolean; intervalSeconds: number; closeToTray: boolean };
}
export interface InboxReplyResult { status: 'sent' | 'uncertain'; message: string }
export interface InboxOpenResult { located: boolean; message: string }
