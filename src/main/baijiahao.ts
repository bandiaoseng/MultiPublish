import type { PublishDraft, TaskStatus } from '../shared/types';

// Endpoint and control research: dreammis/social-auto-upload (MIT).
// This adapter uses MultiPublish's existing Electron account partition; no Python runtime.
export const BAIJIAHAO_HOME = 'https://baijiahao.baidu.com/builder/rc/home';
export const BAIJIAHAO_PUBLISH = 'https://baijiahao.baidu.com/builder/rc/edit?type=videoV2';

export function validateBaijiahaoDraft(draft: Pick<PublishDraft, 'type' | 'title'>) {
  if (draft.type !== 'video') throw new Error('百家号当前仅接入视频发布，请取消图文任务中的百家号账号');
  const title = draft.title.trim();
  const length = Array.from(title).length;
  if (length < 9 || length > 30) throw new Error('百家号视频标题需为 9～30 个字，请调整标题后再发布（不会自动改写或截断）');
  return title;
}

export function baijiahaoLoginState(url: string, text: string, hasLoginUI: boolean) {
  let workspace = false;
  try {
    const parsed = new URL(url);
    workspace = parsed.hostname === 'baijiahao.baidu.com' && /^\/builder\/rc\//.test(parsed.pathname);
  } catch { /* a loading page is not a signed-in workspace */ }
  const challenge = /百度安全验证|请完成安全验证|拖动滑块|注册\/登录百家号|扫码登录|密码登录/.test(text);
  const loggedIn = workspace && !hasLoginUI && !challenge && /内容管理|发布视频|发布作品|创作中心|选择封面|总阅读|粉丝总数|数据概览/.test(text);
  return { loggedIn, pending: !loggedIn && (hasLoginUI || challenge || /login|passport/.test(url) || text.trim().length < 20) };
}

// Kept self-contained so the compiled function can run in the page's isolated DOM context.
export function readBaijiahaoPage() {
  const visible = (e: Element | null): e is HTMLElement => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const text = document.body?.innerText || '';
  const titleEditor = [...document.querySelectorAll<HTMLElement>('[contenteditable="true"][class*="contentEditable"], [class*="contentEditable"][contenteditable], input[placeholder*="标题"], textarea[placeholder*="标题"]')].find(visible);
  const title = titleEditor instanceof HTMLInputElement || titleEditor instanceof HTMLTextAreaElement ? titleEditor.value : titleEditor?.innerText || '';
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('button,[role="button"],[data-testid="publish-btn"]')].filter(visible);
  const publish = buttons.find(e => e.dataset.testid === 'publish-btn') || buttons.find(e => /^(发布|立即发布)$/.test(e.textContent?.trim() || ''));
  const dialogs = [...document.querySelectorAll('[role="dialog"],.cheetah-modal-wrap,.cheetah-modal')].filter(visible);
  const percentages = [...text.matchAll(/(?:^|\s)(\d{1,3})\s*%/g)].map(m => Number(m[1]));
  const busy = /正在上传|上传中|转码中|正在转码|文件解析中/.test(text) || percentages.some(n => n < 100);
  const failed = /视频上传失败|上传失败|转码失败|发布失败/.test(text);
  const challenge = /百度安全验证|请完成安全验证|拖动滑块|注册\/登录百家号|扫码登录|密码登录/.test(text) || [...document.querySelectorAll('iframe[src*="passport.baidu"],iframe[src*="wappass.baidu"]')].some(visible);
  const successNodes = [...document.querySelectorAll('.cheetah-message-success,.cheetah-notification-notice-success,[role="status"]')].filter(visible);
  const success = successNodes.some(e => /发布成功|提交成功/.test(e.textContent || '')) || (/\/builder\/rc\/clue/.test(location.pathname) && /发布成功|提交成功/.test(text));
  const error = [...document.querySelectorAll('.cheetah-message-error,.cheetah-message-warning,[role="alert"]')].filter(visible).map(e => (e.textContent || '').trim()).filter(Boolean).join('；');
  const cover = [...document.querySelectorAll<HTMLImageElement>('[data-testid="cover-preview"] img,.cover-preview img')].some(e => visible(e) && !dialogs.some(root=>root.contains(e)) && e.naturalWidth > 50 && e.naturalHeight > 30);
  const videoReady = [...document.querySelectorAll<HTMLVideoElement>('video')].some(e => Number.isFinite(e.duration) && e.duration > 0 && e.readyState >= 1);
  const declaration = document.querySelector<HTMLInputElement>('input[placeholder="请选择创作声明"]');
  const aiDeclared = /含AI生成内容/.test(declaration?.value || declaration?.parentElement?.innerText || '');
  return { title, hasEditor: !!titleEditor, busy, percentages, failed, challenge, success, error, cover, videoReady, aiDeclared,
    uploaded: /上传完成|上传成功|视频上传成功|转码完成/.test(text),
    publishEnabled: !!publish && !publish.disabled && publish.getAttribute('aria-disabled') !== 'true' && !String(publish.className).includes('disabled'),
    dialogOpen: dialogs.length > 0, url: location.href };
}

function editBaijiahaoFields(title: string, description: string) {
  const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const set = (e: HTMLElement, value: string) => {
    e.focus();
    if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) {
      const proto = e instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(e, value);
    } else {
      const range = document.createRange(); range.selectNodeContents(e);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      document.execCommand('insertText', false, value);
      // Lexical already receives the native input generated by insertText.
      // Dispatching a second insertText input duplicates the title.
      e.blur();return;
    }
    e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
    e.blur();
  };
  const editor = [...document.querySelectorAll<HTMLElement>('[contenteditable="true"][class*="contentEditable"], [class*="contentEditable"][contenteditable], input[placeholder*="标题"], textarea[placeholder*="标题"]')].find(visible);
  if (!editor) return false;
  set(editor, title);
  const desc = [...document.querySelectorAll<HTMLElement>('textarea[placeholder*="简介"],textarea[placeholder*="描述"],input[placeholder*="简介"]')].find(visible);
  if (desc && description) set(desc, description);
  return true;
}

function clickBaijiahaoControl(action: 'cover' | 'upload' | 'confirm' | 'declaration' | 'ai' | 'publish') {
  const visible = (e: Element): e is HTMLElement => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"],.cheetah-modal-wrap')].filter(visible);
  const scope = dialogs.at(-1) || document;
  const textMatch = (root: ParentNode, names: string[]) => [...root.querySelectorAll<HTMLElement>('button,[role="button"],[role="tab"],label,span,div')]
    .filter(visible).filter(e => names.includes((e.textContent || '').trim()))
    .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
  let target: HTMLElement | undefined;
  if (action === 'cover') target = [...document.querySelectorAll<HTMLElement>('[data-testid="select-cover"],[data-testid="cover-preview"]')].find(visible) || textMatch(document, ['选择封面', '设置封面', '修改封面', '更换封面']);
  if (action === 'upload') target = textMatch(scope, ['上传', '本地上传', '上传图片']);
  if (action === 'confirm' && dialogs.length) target = textMatch(scope, ['确定', '确认', '完成']);
  if (action === 'declaration') target = [...document.querySelectorAll<HTMLElement>('input[placeholder="请选择创作声明"]')].find(visible);
  if (action === 'ai' && dialogs.length) target = textMatch(scope, ['含AI生成内容']);
  if (action === 'publish' && !dialogs.length) target = [...document.querySelectorAll<HTMLElement>('[data-testid="publish-btn"]')].find(visible) || textMatch(document, ['发布', '立即发布']);
  if (!target || (target as HTMLButtonElement).disabled || target.getAttribute('aria-disabled') === 'true' || String(target.className).includes('disabled')) return false;
  target.scrollIntoView({ block: 'center' }); target.click(); return true;
}

export type BaijiahaoSnapshot = ReturnType<typeof readBaijiahaoPage>;
export interface BaijiahaoIO {
  snapshot(): Promise<BaijiahaoSnapshot>;
  setFile(kind: 'video' | 'cover', file: string): Promise<void>;
  applyCover(file:string):Promise<void>;
  fill(title: string, description: string): Promise<boolean>;
  click(action: Parameters<typeof clickBaijiahaoControl>[0]): Promise<boolean>;
  progress(status: TaskStatus, message: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export async function publishBaijiahao(io: BaijiahaoIO, draft: PublishDraft) {
  let submitted = false;
  const manual = (message: string) => ({ status: 'manual_required' as const, message });
  const snapshot = async () => {
    const s = await io.snapshot();
    if (s.challenge) throw new Error('百家号要求登录或安全验证，请打开该账号的官方后台由本人处理');
    if (s.failed || s.error) throw new Error(s.error || '百家号返回上传或发布失败');
    return s;
  };
  const until = async (check: (s: BaijiahaoSnapshot) => boolean, timeout: number, reason: string) => {
    const end = io.now() + timeout;
    while (io.now() < end) { const s = await snapshot(); if (check(s)) return s; await io.sleep(1500); }
    throw new Error(reason);
  };
  try {
    const title = validateBaijiahaoDraft(draft);
    if (!draft.coverPath) throw new Error('百家号需要横版封面，请选择封面后重试');
    await snapshot();
    await io.progress('uploading', '百家号：正在选择视频并等待上传完成');
    await io.setFile('video', draft.mediaPaths[0]);
    await until(s => s.hasEditor, 180000, '百家号标题编辑器未出现，页面可能已改版');
    const description = [draft.description, draft.topics.map(t => '#' + t.replace(/^#/, '')).join(' ')].filter(Boolean).join('\n');
    if (!await io.fill(title, description)) throw new Error('百家号标题填写失败');
    let sawProgress = false, quiet = 0;
    await until(s => {
      if (s.busy) { sawProgress = true; quiet = 0; return false; }
      if (s.uploaded || (sawProgress && s.publishEnabled)) quiet++; else quiet = 0;
      return quiet >= 2;
    }, 600000, '百家号上传尚未确认完成，已停止发布，请到官方后台检查');
    await io.progress('uploading', '百家号：正在上传并确认横、竖封面');
    await io.applyCover(draft.coverPath);
    if (draft.baijiahaoAiGenerated) {
      if (!await io.click('declaration')) throw new Error('未找到百家号创作声明入口，无法应用你选择的 AI 声明');
      await io.sleep(1000);
      if (!await io.click('ai')) throw new Error('未找到“含AI生成内容”选项');
      await io.sleep(500); await io.click('confirm'); await io.sleep(800);
      await until(s => s.aiDeclared && !s.dialogOpen, 10000, '百家号 AI 声明未确认生效，请人工检查');
    }
    const ready = await until(s => s.publishEnabled && !s.busy && !s.dialogOpen && s.cover, 30000, '百家号发布按钮未就绪，请检查必填信息');
    if (ready.title.trim() !== title) throw new Error('百家号实际标题与所填标题不一致，已停止发布');
    if (ready.success) throw new Error('页面存在旧的成功提示，请重新打开百家号发布页核对');
    await io.progress('publishing', '百家号：提交一次，等待平台确认');
    // Mark ambiguous outcomes conservatively: never automatically repeat the submission.
    submitted = true;
    if (!await io.click('publish')) return manual('百家号发布按钮未能点击，请在官方后台检查');
    const end = io.now() + 60000;
    while (io.now() < end) {
      const s = await snapshot();
      if (s.success) return { status: 'success' as const, message: '百家号已明确提示提交成功；审核及公开状态请在平台内容管理中核对' };
      await io.sleep(1500);
    }
    return manual('百家号已尝试提交，但未收到明确成功提示。请先核对内容管理，避免重复发布');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return manual((submitted ? '提交结果待核对，请勿直接重试：' : '') + reason);
  }
}

export function electronBaijiahaoIO(wc: Electron.WebContents, setFile: BaijiahaoIO['setFile'], progress: BaijiahaoIO['progress']): BaijiahaoIO {
  let coverEvidence:string[]=[];
  return {
    snapshot: () => wc.executeJavaScript('(' + readBaijiahaoPage.toString() + ')()'),
    fill: (title, description) => wc.executeJavaScript('(' + editBaijiahaoFields.toString() + ')(' + JSON.stringify(title) + ',' + JSON.stringify(description) + ')'),
    click: async action => {
      if(action==='publish'){
        const {verifyVideoCover}=await import('./video-cover-electron');
        if(!await verifyVideoCover(wc,'baijiahao',coverEvidence))throw new Error('百家号封面在提交前发生变化，已停止发布');
      }
      return wc.executeJavaScript('(' + clickBaijiahaoControl.toString() + ')(' + JSON.stringify(action) + ')');
    },
    applyCover:async file=>{const {applyVideoCover}=await import('./video-cover-electron');const result=await applyVideoCover(wc,'baijiahao',file);coverEvidence=result.evidence;},
    setFile, progress, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), now: Date.now,
  };
}
