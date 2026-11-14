import type { Platform } from '../shared/types';
import type { InboxCandidate, InboxKind } from '../shared/inbox';

export const inboxUrls: Partial<Record<Platform, Partial<Record<InboxKind, string>>>> = {
  douyin: { comment: 'https://creator.douyin.com/creator-micro/interactive/comment', private: 'https://creator.douyin.com/creator-micro/data/following/chat' },
  kuaishou: { comment: 'https://cp.kuaishou.com/article/comment' },
  xiaohongshu: { comment: 'https://www.xiaohongshu.com/notification', private: 'https://www.xiaohongshu.com/chat' },
  weixin: { comment: 'https://channels.weixin.qq.com/platform/interaction/comment', private: 'https://channels.weixin.qq.com/platform/private_msg' },
  baijiahao: { comment: 'https://baijiahao.baidu.com/builder/rc/commentmanage/comment/all', private: 'https://baijiahao.baidu.com/builder/rc/fans' },
};
export function validInboxUrl(platform: Platform, raw: string) {
  try { const url = new URL(raw); return url.protocol === 'https:' && Object.values(inboxUrls[platform] || {}).some(value => new URL(value).hostname === url.hostname); } catch { return false; }
}
export interface InboxResponse { path: string; data: any; query?: Record<string, string>; at: number }
export function matchesInboxReply(path: string, method: string, postData: string, text: string, targetIds: string[]) {
  if (method !== 'POST' || !/comment|\/im\/|private.msg/i.test(path) || !/send|publish|reply|add|\/post(?:\/|$)/i.test(path) || /\/(get|list|read|query|search|log|report)[_\/-]/i.test(path)) return false;
  let data: any; try { data=JSON.parse(postData); } catch { data=Object.fromEntries(new URLSearchParams(postData)); }
  const values: string[]=[];
  const visit=(v:any,depth=0)=>{if(depth>8)return;if(v&&typeof v==='object')for(const child of Object.values(v))visit(child,depth+1);else if(v!==null&&v!==undefined){values.push(String(v));if(typeof v==='string'&&v.startsWith('{'))try{visit(JSON.parse(v),depth+1)}catch{}}};
  visit(data);
  return values.includes(text) && targetIds.filter(Boolean).some(id=>values.includes(id));
}
/** Capture only known read responses. Authentication headers and cookies are never persisted. */
export function isInboxReadResponse(path: string) {
  return /\/comment\/(list|commentList|home|message)(?:\/|$)|\/comment\/read\/.*\/list\/|\/you\/mentions$|\/im\/web\/(v3\/chats|chats\/group|chat\/get_unread)$|\/fetch_sessions_client$|\/private-msg\/(get-history-msg|get-new-msg|get-session-info)$/.test(path);
}
const str = (value: any) => value === null || value === undefined ? '' : String(value);
const ms = (value: any) => { const n = Number(value); return n > 0 && Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : undefined; };
function content(value: any) { if (value && typeof value === 'object') return str(value.text || value.content || value.desc); try { const parsed = JSON.parse(value); return str(parsed.text || parsed.content || parsed.desc || value); } catch { return str(value); } }

export function inboxFromResponses(platform: Platform, kind: InboxKind, records: InboxResponse[]): { recognized: boolean; items: InboxCandidate[] } {
  const byId = new Map<string, InboxCandidate>(); let recognized = false;
  const source = inboxUrls[platform]?.[kind] || '';
  const add = (item: InboxCandidate) => { if (item.remoteId && item.text) byId.set(item.remoteId, item); };
  for (const { path, data, query } of records) {
    if (platform === 'xiaohongshu' && kind === 'comment' && path.endsWith('/you/mentions') && data?.success === true && Array.isArray(data.data?.message_list)) {
      recognized = true;
      for (const row of data.data.message_list) {
        const c = row.comment_info, user = row.user_info || {}, post = row.item_info || {};
        if (!c?.id || (c.illegal_info?.illegal_status && c.illegal_info.illegal_status !== 'NORMAL') || (post.illegal_info?.illegal_status && post.illegal_info.illegal_status !== 'NORMAL')) continue;
        add({ remoteId: str(c.id), threadId: str(post.id || c.id), authorId: str(user.userid), author: str(user.nickname || '小红书用户'), text: str(c.content || '[图片或表情评论]'),
          context: str(post.content || row.title), postId: str(post.id), sourceUrl: source, timestamp: ms(row.time), direction: 'incoming' });
      }
    }
    if (platform === 'xiaohongshu' && kind === 'private' && /\/im\/web\/(v3\/chats|chats\/group)$/.test(path) && data?.success === true && Array.isArray(data.data?.chats)) {
      recognized = true;
      for (const row of data.data.chats) {
        const group = !!row.group_id, id = str(row.chat_user_id || row.group_id), info = row.info || {};
        add({ remoteId: (group ? 'group:' : 'user:') + id, threadId: id, authorId: id, author: str(info.nickname || info.user_name || info.group_name || '小红书用户'),
          text: str(row.last_msg_content || '[非文字消息]'), context: group ? '群聊' : '私信', timestamp: ms(row.last_msg_time), sourceUrl: source,
          sourceUnread: typeof row.unread_count === 'number' ? row.unread_count > 0 : undefined, direction: 'unknown' });
      }
    }
    if (platform === 'baijiahao' && kind === 'private' && path.endsWith('/fetch_sessions_client') && data?.error_code === 0 && Array.isArray(data.sessions)) {
      recognized = true;
      for (const row of data.sessions) {
        const id = str(row.contacter_uk || row.contacter_baidu_uk);
        add({ remoteId: id, threadId: id, authorId: id, author: str(row.contacter_nick_name || '百家号用户'), text: content(row.last_content) || str(row.desc) || '[非文字消息]',
          context: row.contacter_group_id ? '群聊' : '私信', sourceUrl: source, timestamp: ms(row.last_time), sourceUnread: Number(row.unread_num) > 0, direction: 'unknown' });
      }
    }
    if (platform === 'douyin' && kind === 'comment' && /\/comment\/.*list/.test(path) && data?.status_code === 0 && Array.isArray(data.comments)) {
      recognized = true;
      for (const c of data.comments) { const postId = str(c.aweme_id || query?.aweme_id);
        add({ remoteId: str(c.cid), threadId: str(c.reply_id && c.reply_id !== '0' ? c.reply_id : c.cid), authorId: str(c.user?.uid), author: str(c.user?.nickname || '抖音用户'),
          text: str(c.text || '[图片或表情评论]'), context: '视频评论', postId, sourceUrl: source + '?aweme_id=' + encodeURIComponent(postId), timestamp: ms(c.create_time), direction: 'incoming' });
      }
    }
    if (platform === 'kuaishou' && kind === 'comment' && path.endsWith('/comment/commentList') && data?.result === 1 && Array.isArray(data.data?.list)) {
      recognized = true;
      for (const c of data.data.list) { const postId = str(query?.photoId || c.photoId);
        add({ remoteId: str(c.commentId), threadId: str(c.replyToCommentId || c.commentId), authorId: str(c.authorId), author: str(c.authorName || '快手用户'),
          text: str(c.content || '[图片或表情评论]'), context: '视频评论', postId, sourceUrl: source + '?photoId=' + encodeURIComponent(postId), timestamp: ms(c.timestamp), direction: 'incoming' });
      }
    }
    if (platform === 'baijiahao' && kind === 'comment' && path.endsWith('/pcui/comment/list') && data?.errno === 0 && Array.isArray(data.data?.reply_list)) {
      recognized = true;
      for (const row of data.data.reply_list) {
        const c = row.reply_info || row.comment || row, user = c.user || c.user_info || row.user || {}, article = row.article || row.article_info || {};
        const id = str(c.comment_id || c.reply_id || c.id), postId = str(c.article_id || row.article_id || article.id);
        if (!id) continue;
        add({ remoteId: id, threadId: id, authorId: str(c.uid || c.uk || user.id), author: str(c.user_name || c.uname || user.name || user.nickname || '百家号用户'),
          text: str(c.content || c.text || c.comment_content), context: str(row.title || article.title || '作品评论'), postId, sourceUrl: source, timestamp: ms(c.ctime || c.create_time || c.time), direction: 'incoming' });
      }
      // Nonempty unknown schemas must not masquerade as an empty inbox.
      if (data.data.reply_list.length && !byId.size) throw new Error('百家号评论字段已变化，请在平台页面查看');
    }
  }
  return { recognized, items: [...byId.values()] };
}
