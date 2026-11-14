import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AppData, PublishDraft } from '../shared/types';

// Explicit offline QA only; prevents publication even if a regression reaches autoPublish.
export async function runCoverRegression(window: BrowserWindow) {
  const profile = app.getPath('userData');
  if (!profile.includes('\\work\\')) throw new Error('封面回归测试仅允许隔离的 work 目录');
  const video = process.env.MULTIPUBLISH_FIXTURE_VIDEO!;
  const portrait = process.env.MULTIPUBLISH_FIXTURE_COVER!;
  const landscape = process.env.MULTIPUBLISH_FIXTURE_LANDSCAPE!;
  if (!video || !portrait || !landscape) throw new Error('缺少封面测试素材');
  const js = async <T = unknown>(code: string): Promise<T> => {
    const result = await window.webContents.executeJavaScript(`(async()=>{
      try{return {ok:true,value:await (${code})};}catch(error){return {ok:false,error:String(error)};}
    })()`);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const hash = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const beforeHash = await hash(portrait);
  let publishCalls = 0;
  ipcMain.removeHandler('publish:auto');
  ipcMain.handle('publish:auto', () => { publishCalls++; throw new Error('离线测试禁止发布'); });
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }));
  const initial = await js<AppData>(`(async()=>{
    for(const platform of ['douyin','kuaishou','xiaohongshu','weixin','baijiahao']) await window.multiPublish.addAccount({platform});
    return await window.multiPublish.getData();
  })()`);
  const accountIds = initial.accounts.map(a => a.id);
  const create = async (coverPath?: string) => {
    const draft = { type: 'video', title: '磷酸二氢钾搭配本地测试', description: '', topics: [], mediaPaths: [video], coverPath, accountIds };
    const saved = await js<AppData>(`window.multiPublish.createPublish(${JSON.stringify(draft)})`);
    const result = saved.drafts[0];
    if (saved.tasks.filter(t => t.draftId === result.id).length !== accountIds.length) throw new Error('未生成全部平台任务');
    if (JSON.stringify(saved.accounts) !== JSON.stringify(initial.accounts)) throw new Error('账号数据被改动');
    if (coverPath && result.coverPath !== coverPath) throw new Error('其他平台封面被覆盖');
    return result;
  };
  const assertLandscape = (draft: PublishDraft) => {
    if (!draft.baijiahaoCoverPath || draft.baijiahaoCoverPath === draft.coverPath) throw new Error('未单独生成百家号封面');
    if (!draft.baijiahaoCoverPath.startsWith(profile + path.sep)) throw new Error('封面未保存到隔离目录');
    const size = nativeImage.createFromPath(draft.baijiahaoCoverPath).getSize();
    if (size.width !== 1280 || size.height !== 720) throw new Error('百家号封面尺寸错误');
  };
  const portraitDraft = await create(portrait);
  assertLandscape(portraitDraft);
  const landscapeDraft = await create(landscape);
  if (landscapeDraft.baijiahaoCoverPath !== landscape) throw new Error('横版封面被重新处理');
  const square = path.join(profile, 'square.png');
  await fs.writeFile(square, nativeImage.createFromPath(landscape).resize({ width: 500, height: 500 }).toPNG());
  assertLandscape(await create(square));
  assertLandscape(await create());
  if (await hash(portrait) !== beforeHash) throw new Error('原始封面文件被改动');

  const invalid = path.join(profile, 'invalid.jpg');
  await fs.writeFile(invalid, 'not an image');
  for (const [file, expected] of [[invalid, '无法读取'], [path.join(profile, 'missing.jpg'), '不存在']]) {
    const before = await js<AppData>('window.multiPublish.getData()');
    let rejected = false;
    try { await create(file); } catch (error) { rejected = String(error).includes(expected); }
    if (!rejected) throw new Error('无效封面没有给出准确报错');
    const after = await js<AppData>('window.multiPublish.getData()');
    if (after.tasks.length !== before.tasks.length || after.drafts.length !== before.drafts.length) throw new Error('无效封面创建了部分任务');
  }

  // Reproduce the failed submit in the real renderer, with file dialogs stubbed locally.
  ipcMain.removeHandler('file:pick');
  ipcMain.handle('file:pick', (_, kind) => [kind === 'video' ? video : invalid]);
  window.webContents.send('data:changed');
  await pause(300);
  const click = async (label: string, selector = 'button') => js(`(() => {
    const item=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(b=>b.textContent.trim()===${JSON.stringify(label)});
    if(!item)throw new Error('测试按钮未找到：'+${JSON.stringify(label)});item.click();
  })()`);
  await click('视频发布', '[role="menuitem"]');
  await pause(300);
  await click('选择本地视频');
  for (let i = 0; i < 100; i++) {
    if (await js<boolean>(`!!document.querySelector('img[alt="自动提取的视频封面"]')`)) break;
    if (i === 99) throw new Error('回归测试首帧提取超时');
    await pause(200);
  }
  await click('选择封面');
  await pause(300);
  await js(`(() => {const el=document.querySelector('#title');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'磷酸二氢钾搭配本地测试');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(100);
  await click('一键发布');
  let sawError = false;
  for (let i = 0; i < 40; i++) {
    if (await js<boolean>(`document.body.innerText.includes('封面图片无法读取')`)) { sawError = true; break; }
    await pause(100);
  }
  if (!sawError) throw new Error('未复现界面中的封面读取报错');
  await pause(700);
  const clean = await js<boolean>(`!document.querySelector('.ant-message-loading') && !Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('一键发布'))?.disabled`);
  if (!clean) throw new Error('失败后加载提示或按钮没有恢复');
  if (publishCalls !== 0) throw new Error('失败后错误启动了发布');
  return { portraitMixedBatch: true, originalCoverPreserved: true, landscapeUnchanged: true, squarePadded: true, videoFramePadded: true, invalidAndMissingRejected: true, spinnerClearedOnFailure: true, actualPublishCalls: publishCalls, convertedPreview: portraitDraft.baijiahaoCoverPath };
}
