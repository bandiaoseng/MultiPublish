import assert from 'node:assert/strict';
import test from 'node:test';
import { baijiahaoLoginState, publishBaijiahao, validateBaijiahaoDraft } from './baijiahao.ts';
import type { BaijiahaoIO, BaijiahaoSnapshot } from './baijiahao.ts';
import type { PublishDraft } from '../shared/types';

const draft: PublishDraft = { id: 'local-test', type: 'video', title: '这是一个百家号发布测试标题', description: '', topics: [], mediaPaths: ['video.mp4'], coverPath: 'cover.jpg', accountIds: [], createdAt: '' };
function harness(options: { challenge?: boolean; noUpload?: boolean; noCover?: boolean; ambiguous?: boolean; clickThrows?: boolean } = {}) {
  let time = 0;
  const clicks: string[] = [], files: string[] = [];
  const state: BaijiahaoSnapshot = { title: '', hasEditor: false, busy: false, percentages: [], failed: false, challenge: !!options.challenge, success: false, error: '', cover: false, videoReady: false, uploaded: false, aiDeclared: false, publishEnabled: true, dialogOpen: false, url: 'https://baijiahao.baidu.com/builder/rc/edit?type=videoV2' };
  const io: BaijiahaoIO = {
    now: () => time, sleep: async ms => { time += ms; }, progress: async () => {},
    snapshot: async () => ({...state}),
    fill: async title => { state.title = title; return true; },
    applyCover:async()=>{files.push('cover');if(options.noCover)throw new Error('封面未确认');state.cover=true;},
    setFile: async kind => {
      files.push(kind);
      if (kind === 'video') { state.hasEditor = true; state.busy = !!options.noUpload; state.uploaded = !options.noUpload; }
      if (kind === 'cover' && !options.noCover) state.cover = true;
    },
    click: async action => {
      clicks.push(action);
      if (action === 'cover' || action === 'declaration') state.dialogOpen = true;
      if (action === 'confirm') state.dialogOpen = false;
      if (action === 'ai') state.aiDeclared = true;
      if (action === 'publish') {
        if (options.clickThrows) throw new Error('页面跳转导致连接中断');
        state.url = 'https://baijiahao.baidu.com/builder/rc/content';
        state.success = !options.ambiguous;
      }
      return true;
    },
  };
  return {io, clicks, files};
}

test('requires a real Baijiahao workspace, not just a Baidu login or empty page', () => {
  assert.equal(baijiahaoLoginState('https://passport.baidu.com/', '内容管理', false).loggedIn, false);
  assert.equal(baijiahaoLoginState('https://baijiahao.baidu.com/builder/theme/bjh/login', '内容管理', false).loggedIn, false);
  assert.equal(baijiahaoLoginState('https://baijiahao.baidu.com/builder/rc/home', '', false).loggedIn, false);
  assert.equal(baijiahaoLoginState('https://baijiahao.baidu.com/builder/rc/home', '内容管理 发布视频', false).loggedIn, true);
  assert.equal(baijiahaoLoginState('https://baijiahao.baidu.com/builder/rc/home', '内容管理 百度安全验证', false).loggedIn, false);
});
test('title validation rejects instead of silently inventing or truncating text', () => {
  assert.throws(() => validateBaijiahaoDraft({...draft, title: '太短'}), /9～30/);
  assert.throws(() => validateBaijiahaoDraft({...draft, title: '字'.repeat(31)}), /9～30/);
  assert.throws(() => validateBaijiahaoDraft({...draft, type: 'image_text'}), /仅接入视频/);
  assert.equal(validateBaijiahaoDraft(draft), draft.title);
});
test('normal submission uses cover, submits once and does not assert AI authorship', async () => {
  const h = harness(); const result = await publishBaijiahao(h.io, draft);
  assert.equal(result.status, 'success'); assert.deepEqual(h.files, ['video', 'cover']);
  assert.equal(h.clicks.filter(x => x === 'publish').length, 1); assert.equal(h.clicks.includes('ai'), false);
});
test('AI declaration is applied only when explicitly selected', async () => {
  const h = harness(); assert.equal((await publishBaijiahao(h.io, {...draft, baijiahaoAiGenerated: true})).status, 'success');
  assert.ok(h.clicks.includes('ai'));
});
test('login/security challenge stops before uploading', async () => {
  const h = harness({challenge: true}); assert.equal((await publishBaijiahao(h.io, draft)).status, 'manual_required'); assert.deepEqual(h.files, []);
});
test('upload timeout never falls through to publishing', async () => {
  const h = harness({noUpload: true}); assert.equal((await publishBaijiahao(h.io, draft)).status, 'manual_required'); assert.equal(h.clicks.includes('publish'), false);
});
test('missing confirmed cover never falls through to publishing', async () => {
  const h = harness({noCover: true}); assert.equal((await publishBaijiahao(h.io, draft)).status, 'manual_required'); assert.equal(h.clicks.includes('publish'), false);
});
test('redirect alone is not success and never triggers a second click', async () => {
  const h = harness({ambiguous: true}); assert.equal((await publishBaijiahao(h.io, draft)).status, 'manual_required'); assert.equal(h.clicks.filter(x => x === 'publish').length, 1);
});
test('connection error after clicking is an ambiguous result, not a retry signal', async () => {
  const h = harness({clickThrows: true}); const result = await publishBaijiahao(h.io, draft);
  assert.match(result.message, /提交结果待核对/); assert.equal(h.clicks.filter(x => x === 'publish').length, 1);
});
