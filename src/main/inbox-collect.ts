import type { Platform } from '../shared/types';
import type { InboxCandidate, InboxKind } from '../shared/inbox';

// Official-page request shapes cross-checked with Social Harvest (Apache-2.0).
// Modified for Electron, bounded incremental reads, strict errors, and no credential export.
export async function collectInbox(platform: Platform, kind: InboxKind, known: string[] = []) {
  const page = window as any, items: InboxCandidate[] = [], seen = new Set(known), started = Date.now();
  let recognized = false, limited = false, workCount = 0;
  const str = (v: any) => v == null ? '' : String(v);
  const ms = (v: any) => { const n = Number(v); return n > 0 ? (n < 1e11 ? n * 1000 : n) : undefined; };
  const source = location.origin + location.pathname;
  const add = (item: InboxCandidate) => { if (item.remoteId && item.text) items.push(item); };
  const pause = () => new Promise(resolve => setTimeout(resolve, 120));
  const fetchJson = async (route: string, params: Record<string, any> = {}, post = false) => {
    const url = new URL(route, location.origin), headers: Record<string,string> = {};
    if (platform === 'douyin') { params = { aid: 2906, ...params }; headers['agw-js-conv'] = 'str'; }
    if (!post) for (const [k,v] of Object.entries(params)) url.searchParams.set(k, str(v));
    else headers['Content-Type'] = 'application/json;charset=UTF-8';
    const response = await fetch(url.href, { method: post ? 'POST' : 'GET', credentials: 'include', headers, body: post ? JSON.stringify(params) : undefined, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('消息接口请求失败（' + response.status + '）');
    const raw = await response.text();
    const data = (JSON.parse as any)(raw, (_key: string, value: any, context: any) => typeof value === 'number' && !Number.isSafeInteger(value) && context?.source ? context.source : value);
    const code = data.status_code ?? data.errno ?? data.errCode ?? data.errcode ?? data.base_resp?.ret;
    if (code !== undefined && Number(code) !== 0) throw new Error('平台消息接口未授权或返回错误：' + str(data.status_msg || data.errmsg || data.errMsg || code).slice(0,100));
    return data;
  };
  const bounded = () => { if (Date.now() - started > 55000) { limited = true; return false; } return true; };
  if (platform === 'douyin' && kind === 'comment') {
    let cursor = '0'; const works: any[] = [];
    for (let n = 0; n < 10 && bounded(); n++) {
      const body = await fetchJson('/aweme/v1/creator/item/list', { cursor, count: 50 });
      if (!Array.isArray(body.item_info_list)) throw new Error('抖音作品列表格式发生变化');
      recognized = true; works.push(...body.item_info_list);
      if (!body.has_more || !body.item_info_list.length) break;
      const next = str(body.cursor || body.next_cursor); if (!next || next === cursor) break; cursor = next;
      if (n === 9) limited = true;
    }
    for (const work of works) {
      if (!bounded()) break; workCount++;
      if (Number(work.comment_count) === 0) continue;
      const id = str(work.item_id_plain || work.aweme_id || work.item_id); let cursor = '0';
      for (let n = 0; n < 10 && bounded(); n++) {
        const result = await fetchJson('/web/api/third_party/aweme/api/comment/read/aweme/v1/web/comment/list/select/', { aweme_id: id, cursor, count: 50, comment_select_options: 0, sort_options: 0, channel_id: 618, app_id: 2906, device_platform: 'webapp' });
        if (!Array.isArray(result.comments)) throw new Error('抖音评论列表格式发生变化');
        for (const c of result.comments) add({ remoteId: str(c.cid), threadId: str(c.reply_id && c.reply_id !== '0' ? c.reply_id : c.cid), authorId: str(c.user?.uid), author: str(c.user?.nickname || '抖音用户'), text: str(c.text || '[非文字评论]'), context: str(work.title || work.item_title || work.desc || '视频评论'), postId: id,
          sourceUrl: source + '?item_id=' + encodeURIComponent(str(work.item_id || id)) + '&aweme_id=' + encodeURIComponent(id), timestamp: ms(c.create_time), direction: 'incoming' });
        if (!result.has_more || !result.comments.length || (n > 0 && result.comments.every((c: any) => seen.has(str(c.cid))))) break;
        const next = str(result.cursor); if (next === cursor) break; cursor = next; await pause(); if (n === 9) limited = true;
      }
    }
  }
  if (platform === 'kuaishou' && kind === 'comment') {
    if (typeof page.$http?.post !== 'function') throw new Error('快手消息页面尚未就绪');
    const request = async (route: string, body: any) => { const raw = await page.$http.post(route, body); const data = raw?.data?.result !== undefined ? raw.data : raw; if (data?.result !== 1) throw new Error('快手消息接口返回错误'); return data.data; };
    const end = new Date(); end.setHours(23,59,59,999); let cursor = str(end.getTime()), works: any[] = [];
    for (let n = 0; n < 15 && bounded(); n++) {
      const data = await request('/rest/cp/works/v2/video/pc/photo/list', { queryType: '0', cursor, startTime: end.getTime() - 365 * 86400000, endTime: end.getTime(), limit: 30, timeRangeType: 5, keyword: '' });
      if (!Array.isArray(data?.list)) throw new Error('快手作品列表格式发生变化');
      recognized = true; works.push(...data.list); const next = str(data.nextCursor);
      if (!data.list.length || !next || next === cursor) break; cursor = next; if (n === 14) limited = true;
    }
    for (const work of works) {
      if (!bounded()) break; workCount++;
      if (Number(work.commentCount) === 0) continue;
      const id = str(work.photoId || work.workId), data = await request('/rest/cp/creator/comment/commentList', { photoId: id, sortType: 0, commentListType: 'all' });
      if (!Array.isArray(data?.list)) throw new Error('快手评论列表格式发生变化');
      for (const c of data.list) add({ remoteId: str(c.commentId), threadId: str(c.replyToCommentId || c.commentId), authorId: str(c.authorId), author: str(c.authorName || '快手用户'), text: str(c.content || '[非文字评论]'), context: str(work.title || '视频评论'), postId: id, sourceUrl: source + '?photoId=' + encodeURIComponent(id), timestamp: ms(c.timestamp), direction: 'incoming' });
      await pause();
    }
  }
  if (platform === 'baijiahao' && kind === 'comment') {
    for (let n = 1; n <= 10 && bounded(); n++) {
      const data = await fetchJson('/pcui/comment/list', { reply_type: 0, relation_type: 0, size: 20, page: n });
      if (!Array.isArray(data.data?.reply_list)) throw new Error('百家号评论列表格式发生变化');
      recognized = true;
      // The read-response normalizer consumes these responses with the exact raw schema.
      if (data.data.reply_list.length < 20) break;
      if (n === 10) limited = true; await pause();
    }
  }
  if (platform === 'weixin') {
    const api = async (route: string, body: any, interaction = false) => (await fetchJson((interaction ? '/micro/interaction' : '') + '/cgi-bin/mmfinderassistant-bin' + route, body, true)).data;
    if (kind === 'private') {
      let cursor = '', messages: any[] = [];
      for (let n = 0; n < 15 && bounded(); n++) {
        const data = await api('/private-msg/get-history-msg', { cookie: cursor }, true);
        if (!Array.isArray(data?.msg)) throw new Error('视频号私信接口尚未就绪或登录已过期');
        recognized = true; messages.push(...data.msg); const next = str(data.cookie);
        if (!data.isContinue || !next || next === cursor) break; cursor = next; if (n === 14) limited = true;
      }
      const ids = [...new Set(messages.map(m => str(m.sessionId)).filter(Boolean))];
      for (let offset = 0; offset < ids.length && bounded(); offset += 30) {
        const data = await api('/private-msg/get-session-info', { sessionId: ids.slice(offset,offset+30) }, true);
        if (!Array.isArray(data?.sessionInfo)) throw new Error('视频号会话资料未读取成功');
        for (const thread of data.sessionInfo) {
          const id = str(thread.sessionId), list = messages.filter(m => str(m.sessionId) === id).sort((a,b) => Number(b.ts) - Number(a.ts)), last = list[0]; if (!last) continue;
          add({ remoteId: id, threadId: id, authorId: str(thread.username || id), author: str(thread.nickname || thread.nickName || thread.contact?.nickname || '视频号用户'), text: str(last.textMsg?.content || last.content || last.rawContent || '[非文字消息]'), context: '私信', sourceUrl: source, timestamp: ms(last.ts), sourceUnread: Number(thread.unreadCount) > 0, direction: 'unknown' });
        }
      }
    } else {
      const works: any[] = [];
      for (let currentPage = 1; currentPage <= 10 && bounded(); currentPage++) {
        const data = await api('/post/post_list', { currentPage, pageSize: 50, onlyUnread: false, needAllCommentCount: true, forMcn: false });
        if (!Array.isArray(data?.list)) throw new Error('视频号作品列表尚未就绪或登录已过期');
        recognized = true; works.push(...data.list); if (data.list.length < 50) break; if (currentPage === 10) limited = true;
      }
      for (const work of works) {
        if (!bounded()) break; workCount++;
        const id = str(work.objectId || work.exportId || work.id); let lastBuff = '';
        for (let n = 0; n < 10 && bounded(); n++) {
          const data = await api('/comment/comment_list', { exportId: id, lastBuff, pageSize: 50, commentSelection: false, forMcn: false });
          if (!Array.isArray(data?.comment)) throw new Error('视频号评论列表格式发生变化');
          for (const c of data.comment) add({ remoteId: str(c.commentId || c.id), threadId: str(c.rootCommentId || c.commentId || c.id), authorId: str(c.commentUsername || c.username), author: str(c.commentNickname || c.nickname || '视频号用户'), text: str(c.content || c.commentContent || '[非文字评论]'), context: str(work.desc?.description || work.title || '视频评论'), postId: id, sourceUrl: source + '?exportId=' + encodeURIComponent(id), timestamp: ms(c.commentCreatetime || c.createTime), direction: 'incoming' });
          const next = str(data.lastBuff || data.lastBuffer);
          if (data.comment.length < 50 || !next || next === lastBuff || (n > 0 && data.comment.every((c: any) => seen.has(str(c.commentId || c.id))))) break;
          lastBuff = next; if (n === 9) limited = true; await pause();
        }
      }
    }
  }
  return { recognized, items, workCount, limited };
}
