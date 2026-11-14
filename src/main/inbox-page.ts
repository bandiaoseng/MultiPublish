import type { InboxCandidate, InboxEntry, InboxKind } from '../shared/inbox';
import type { Platform } from '../shared/types';

/** Serialized into the account's official page. No Node or credential export. */
export async function inboxPage(action: 'read' | 'locate' | 'fill' | 'send' | 'history', platform: Platform, kind: InboxKind, hints: InboxCandidate[] = [], target?: InboxEntry, text = '') {
  hints = [...new Map(hints.map(item => [item.remoteId, item])).values()];
  const docs: Document[] = [document];
  for (let i = 0; i < docs.length && i < 8; i++) for (const frame of docs[i].querySelectorAll('iframe')) {
    try { if (frame.contentDocument && !docs.includes(frame.contentDocument)) docs.push(frame.contentDocument); } catch { /* cross-origin frames stay isolated */ }
  }
  const all = (selector: string) => docs.flatMap(doc => [...doc.querySelectorAll<HTMLElement>(selector)]);
  const visible = (e: HTMLElement) => !!e.getClientRects().length && e.ownerDocument.defaultView!.getComputedStyle(e).visibility !== 'hidden';
  const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const unref = (v: any) => v?.__v_isRef ? v.value : v;
  const str = (v: any) => v == null ? '' : String(v);
  const time = (v: any) => { const n = v instanceof Date ? v.getTime() : Number(v); return n > 0 && Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : undefined; };
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const props = (element: any): any[] => {
    const result: any[] = []; let fiber = element?.[Object.keys(element || {}).find(k => k.startsWith('__reactFiber')) || ''];
    for (let i = 0; fiber && i < 30; i++, fiber = fiber.return) if (fiber.memoizedProps && typeof fiber.memoizedProps === 'object') result.push(fiber.memoizedProps);
    for (let e = element, i = 0; e && i < 5; e = e.parentElement, i++) { if (e.__vue__?.$props) result.push(e.__vue__.$props); if (e.__vueParentComponent?.props) result.push(e.__vueParentComponent.props); }
    return result;
  };
  const items: InboxCandidate[] = []; let recognized = false;
  const bind = (element: HTMLElement | undefined, item: InboxCandidate) => { if (!item.remoteId || !item.text) return; if (element) element.dataset.mpInboxId = item.remoteId; items.push(item); };
  const source = location.origin + location.pathname;
  const body = docs.map(d => d.body?.innerText || '').join('\n');
  const login = /\/(login|passport)(?:\.|\/|\?|$)/i.test(location.href) || /登录后查看|请先登录|扫码登录/.test(body.slice(0,3500));
  if (login) return { recognized: false, login: true, items: [], message: '平台要求重新登录，请打开该账号完成验证' };

  if (platform === 'douyin' && kind === 'private') {
    for (const row of all('li.semi-list-item').filter(visible)) {
      const raw = props(row).map(p => p.item).find(v => v?.id && v?.content);
      if (!raw) continue;
      const last = raw.lastMessage || raw.lastMsg;
      bind(row, { remoteId: str(raw.id), threadId: str(raw.id), authorId: str(raw.id), author: clean(row.querySelector('[class*="item-header-name-"]')?.textContent) || str(raw.coreInfo?.name),
        text: clean(row.querySelector('[class*="item-content-"] [class*="text-"]')?.textContent) || str(raw.content?.text || '[非文字消息]'), context: raw.isGroupChat ? '群聊' : '私信',
        timestamp: time(last?.createdAt || last?.createTime), timeLabel: clean(row.querySelector('[class*="item-header-time-"]')?.textContent), sourceUrl: source,
        sourceUnread: !!row.querySelector('.semi-badge-dot,.semi-badge-count'), direction: raw.content?.isFromMe === true ? 'outgoing' : 'incoming' });
    }
    recognized = items.length > 0 || /暂无私信|暂无消息|没有私信/.test(body);
  }
  if (platform === 'douyin' && kind === 'comment') {
    for (const name of all('[class*="username-"]').filter(visible)) {
      const row = name.closest<HTMLElement>('[class*="container-"]'); if (!row) continue;
      const p = props(row).find(p => p.id || p.cid || p.commentId);
      const id = str(p?.id || p?.cid || p?.commentId);
      const hint = hints.find(h => h.remoteId === id);
      if (hint) { bind(row, hint); continue; }
      // Only bind a uniquely identified comment; a nickname alone is insufficient.
      const author = clean(name.textContent);
      const candidates = hints.filter(h => h.author === author && clean(row.innerText).includes(clean(h.text)));
      if (candidates.length === 1 && all('[class*="username-"]').filter(e => clean(e.textContent) === author).length === 1) bind(row, candidates[0]);
    }
  }
  if (platform === 'kuaishou' && kind === 'comment') {
    for (const row of all('.comment-item').filter(visible)) {
      const p = props(row).find(p => p.commentInfo), c = p?.commentInfo; if (!c?.commentId) continue;
      const post = str(p.selectedPhotoId || c.photoId);
      bind(row, { remoteId: str(c.commentId), threadId: str(c.replyToCommentId || c.commentId), authorId: str(c.authorId), author: str(c.authorName), text: str(c.content || '[非文字评论]'),
        context: clean(all('.comment__header')[0]?.innerText) || '视频评论', postId: post, sourceUrl: source + '?photoId=' + encodeURIComponent(post), timestamp: time(c.timestamp), direction: 'incoming' });
    }
  }
  if (platform === 'xiaohongshu' && kind === 'comment') {
    for (const doc of docs) {
      const state = (doc.defaultView as any)?.__INITIAL_STATE__?.notification;
      const map = unref(state?.notificationMap), rows = unref(map?.mentions)?.messageList;
      if (!Array.isArray(rows)) continue;
      recognized = true;
      const cards = [...doc.querySelectorAll<HTMLElement>('.tabs-content-container > .container')];
      rows.forEach((r: any, index: number) => {
        const c = r.commentInfo || r.comment_info, u = r.userInfo || r.user_info || {}, note = r.itemInfo || r.item_info || {};
        if (!c?.id || (c.illegalInfo?.illegalStatus && c.illegalInfo.illegalStatus !== 'NORMAL') || (c.illegal_info?.illegal_status && c.illegal_info.illegal_status !== 'NORMAL')) return;
        bind(cards[index], { remoteId: str(c.id), threadId: str(note.id || c.id), authorId: str(u.userid || u.userId), author: str(u.nickname), text: str(c.content || '[非文字评论]'),
          context: str(note.content || r.title), postId: str(note.id), sourceUrl: source, timestamp: time(r.time), direction: 'incoming' });
      });
    }
  }
  if (platform === 'xiaohongshu' && kind === 'private') {
    for (const row of all('.xhs-im-conv-item').filter(visible)) {
      const name = clean(row.querySelector('.xhs-im-conv-item__name')?.textContent);
      const p = props(row), data = p.flatMap(v => [v, v.chat, v.item, v.conversation, v.data]).find(v => v?.chat_user_id || v?.chatUserId || v?.group_id);
      const id = str(data?.chat_user_id || data?.chatUserId || data?.group_id);
      const matches = id ? hints.filter(h => h.threadId === id) : hints.filter(h => h.author === name);
      if (matches.length === 1 && (id || all('.xhs-im-conv-item__name').filter(e => clean(e.textContent) === name).length === 1)) bind(row, matches[0]);
    }
    recognized = items.length > 0 || /暂无聊天|暂无会话|暂无消息/.test(body);
  }
  if (platform === 'baijiahao' && kind === 'private') {
    const rows = all('.list-item-wraper[data-id]').filter(visible);
    const list = rows.flatMap(row => props(row).flatMap(p => Array.isArray(p.chatList) ? [p.chatList] : []))[0];
    if (list) {
      recognized = true;
      for (const r of list) {
        const id = str(r.contacter_uk || r.uk), content = typeof r.last_content === 'object' ? r.last_content : (() => { try { return JSON.parse(r.last_content || '{}'); } catch { return {}; } })();
        bind(rows.find(e => e.dataset.id === str(r.last_msgid || r.im_id)), { remoteId: id, threadId: id, authorId: id, author: str(r.remark || r.contacter_nick_name || '百家号用户'),
          text: str(content.text || r.desc || '[非文字消息]'), context: r.contacter_group_id ? '群聊' : '私信', sourceUrl: source, timestamp: time(r.last_time), sourceUnread: Number(r.unread_num) > 0, direction: 'unknown' });
      }
    }
  }
  if (platform === 'baijiahao' && kind === 'comment') {
    for (const hint of hints) {
      const matching = all('[class*="comment"]').filter(e => visible(e) && clean(e.innerText).includes(clean(hint.text)) && clean(e.innerText).includes(clean(hint.author)));
      matching.sort((a,b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      const exact = matching.find(e => props(e).some(p => [p, p.comment, p.commentInfo, p.item, p.data].some(v => v && str(v.comment_id || v.reply_id || v.id) === hint.remoteId)));
      if (exact) bind(exact, hint);
    }
  }
  if (platform === 'weixin') {
    // Current Channels UI lives in its same-origin interaction iframe.
    for (const hint of hints) {
      const rows = all('[data-id],[data-comment-id],[data-session-id],.comment-item,.session-item,.conversation-item');
      const exact = rows.find(e => [e.dataset.id,e.dataset.commentId,e.dataset.sessionId].includes(hint.remoteId) || props(e).some(p => [p,p.item,p.comment,p.session].some(v => v && [v.commentId,v.sessionId,v.id].map(str).includes(hint.remoteId))));
      if (exact) bind(exact, hint);
    }
  }
  if (action === 'read') return { recognized, login: false, items, message: '', empty: /暂无评论消息|暂无评论|暂无私信|暂无聊天/.test(body) };
  if (!target) throw new Error('缺少回复目标');
  const page = window as any;
  const bound = all('[data-mp-inbox-id]').filter(e => e.dataset.mpInboxId === target.remoteId && visible(e));
  if (action === 'locate') {
    if (bound.length !== 1) return { located: false, ready: false, message: '未能唯一定位原消息，可在打开的平台页面中核对并回复' };
    const row = bound[0]; row.scrollIntoView({ block: 'center' });
    if (kind === 'comment') {
      const buttons = [...row.querySelectorAll<HTMLElement>('button,a,span,div')].filter(e => visible(e) && clean(e.innerText) === '回复');
      buttons.sort((a,b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      if (!buttons.length) return { located: true, ready: false, message: '该评论没有可用回复入口' };
      (buttons[0].closest<HTMLElement>('button,a') || buttons[0]).click();
    } else row.click();
    await pause(650);
    let editor: HTMLElement | undefined;
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidates = (kind === 'comment' ? [...row.querySelectorAll<HTMLElement>('textarea,[contenteditable=true]')] : all('textarea,[contenteditable=true]')).filter(visible);
      editor = candidates.find(e => {
        if (platform === 'baijiahao') return e.matches('textarea.rc-textarea');
        if (platform === 'douyin' && kind === 'private') return !e.closest('[class*="ai-"]');
        if (kind === 'comment') return (e.getAttribute('placeholder') || '').includes(target.author) || (platform === 'xiaohongshu' && e.matches('textarea.comment-input'));
        return !e.closest('[class*="search"],[class*="assistant"],[class*="ai-input"]');
      });
      if (editor) break; await pause(350);
    }
    if (!editor) return { located: true, ready: false, message: '平台尚未提供可用回复框，请在会话页面查看限制说明' };
    const placeholder=editor.getAttribute('placeholder')||'';
    if(kind==='comment'&&placeholder&&/回复|@/.test(placeholder)&&!placeholder.includes(target.author))return {located:true,ready:false,message:'平台回复对象与所选评论不一致，已停止'};
    const scope = kind === 'comment' ? (editor.closest<HTMLElement>('.comment-input__wrapper,[class*="reply-input"],[class*="input-container"]') || editor.parentElement!) : (editor.closest<HTMLElement>('[class*="chatmsg-editor"],[class*="chat-input"],[class*="input-area"],[class*="editor-wrapper"],[class*="send-message"],[class*="input-container"]') || editor.parentElement?.parentElement || editor.parentElement!);
    page.__mpInboxReply = { id: target.remoteId, row, editor, scope, author: target.author, filled: '' };
    return { located: true, ready: true, message: '已定位原会话，回复将发送给 ' + target.author };
  }
  const prepared = page.__mpInboxReply;
  if (action === 'history') {
    const selectors = platform === 'baijiahao' ? '.chatmsg-wrapper' : platform === 'xiaohongshu' ? '[class*="xhs-im-msg"],[class*="message-item"]' : '[class*="message-content"],[class*="msg-content"]';
    const messages = all(selectors).filter(visible).map(e => clean(e.innerText)).filter(t => t && t.length < 4000);
    return { messages: [...new Set(messages)].slice(-50) };
  }
  if (!prepared || prepared.id !== target.remoteId || !prepared.editor.isConnected || !visible(prepared.editor)) throw new Error('回复窗口已变化，请重新选择消息');
  const editor = prepared.editor as HTMLElement, doc = editor.ownerDocument, realm = doc.defaultView!;
  if (action === 'fill') {
    editor.focus();
    if (editor.matches('textarea,input')) {
      const prototype = editor.tagName === 'TEXTAREA' ? (realm as any).HTMLTextAreaElement.prototype : (realm as any).HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(editor, text);
      editor.dispatchEvent(new (realm as any).Event('input', { bubbles: true }));
      editor.dispatchEvent(new (realm as any).Event('change', { bubbles: true }));
    } else {
      const range = doc.createRange(); range.selectNodeContents(editor); const selection = doc.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      doc.execCommand('insertText', false, text);
    }
    prepared.filled = text;
    return { filled: true };
  }
  if (action === 'send') {
    const actual = editor.matches('textarea,input') ? (editor as HTMLInputElement).value : editor.innerText;
    if (!text.trim() || prepared.filled !== text || clean(actual) !== clean(text)) throw new Error('回复输入内容未核对通过，未发送');
    if (prepared.sent) throw new Error('本次回复已点击发送，请先核对结果');
    let buttons = [...(prepared.scope as HTMLElement).querySelectorAll<HTMLElement>('button,[role=button],div,span')].filter(e => visible(e) && /^(发送|确认|回复)$/.test(clean(e.innerText)) && !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true' && !/disabled/i.test(e.className));
    buttons.sort((a,b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    if (!buttons.length) throw new Error('平台发送按钮不可用，未发送');
    prepared.sent = true;
    (buttons[0].closest<HTMLElement>('button,[role=button]') || buttons[0]).click();
    return { clicked: true };
  }
  return { recognized, items };
}
