import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginReply, finishReply, mergeInbox, newInbox, recoverReplies, parseInbox } from './inbox-core.ts';
const account = { id: 'one', platform: 'douyin' as const, name: 'test', createdAt: '', loginStatus: 'logged_in' as const };
const candidate = { remoteId: '1234567890123456789', threadId: 't', authorId: 'u', author: '用户', text: '你好', context: '视频', sourceUrl: 'https://creator.douyin.com/', direction: 'incoming' as const };
test('首次导入不通知，重复同步不重复提醒，账号隔离', () => {
  const data = newInbox();
  assert.deepEqual(mergeInbox(data, account, 'comment', [candidate], 1), []);
  assert.deepEqual(mergeInbox(data, account, 'comment', [candidate], 2), []);
  assert.equal(data.entries.length, 1);
  mergeInbox(data, { ...account, id: 'two' }, 'comment', [candidate], 3);
  assert.equal(data.entries.length, 2);
  assert.notEqual(data.entries[0].id, data.entries[1].id);
  assert.equal(mergeInbox(data, account, 'comment', [{ ...candidate, remoteId: 'new' }], 4).length, 1);
  assert.equal(data.entries[2].unread, true);
});
test('私信新内容重新变为未读，自己发送的更新不弹提醒，相对时间不重复提示', () => {
  const data = newInbox(); mergeInbox(data, account, 'private', [candidate], 1);
  assert.equal(mergeInbox(data, account, 'private', [{ ...candidate, timeLabel: '2分钟前' }], 2).length, 0);
  assert.equal(mergeInbox(data, account, 'private', [{ ...candidate, text: '新问题' }], 3).length, 1);
  data.entries[0].unread = false;
  assert.equal(mergeInbox(data, account, 'private', [{ ...candidate, text: '我的回答', direction: 'outgoing' }], 4).length, 0);
  assert.equal(data.entries[0].unread, false);
});
test('局部或空同步不会抹掉历史和回复草稿', () => {
  const data = newInbox(); mergeInbox(data, account, 'comment', [candidate], 1);
  data.entries[0].replyDraft = '稍后回复';
  mergeInbox(data, account, 'comment', [], 2);
  assert.equal(data.entries[0].replyDraft, '稍后回复');
});
test('回复并发、结果不确定和崩溃恢复防止重复发送', () => {
  const data = newInbox(); mergeInbox(data, account, 'comment', [candidate]);
  const id = data.entries[0].id;
  beginReply(data, id, '收到'); assert.throws(() => beginReply(data, id, '重复'), /正在发送/);
  recoverReplies(data); assert.equal(data.entries[0].replyStatus, 'uncertain');
  assert.throws(() => beginReply(data, id, '重复'), /待核对/);
  finishReply(data, id, '收到', 'sent');
  assert.equal(data.entries[0].replies.length, 1); assert.equal(data.entries[0].unread, false);
});
test('设置解析限制轮询频率，损坏记录不静默接受', () => {
  const data = newInbox(); data.settings.intervalSeconds = 1;
  assert.equal(parseInbox(data).settings.intervalSeconds, 60);
  assert.throws(() => parseInbox({ schema: 1 }), /无效/);
});
