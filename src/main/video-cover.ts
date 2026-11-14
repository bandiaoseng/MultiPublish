import type { Platform } from '../shared/types';

export const customCoverPlatforms = ['douyin', 'kuaishou', 'xiaohongshu', 'weixin', 'baijiahao'] as const;
export type CoverPlatform = typeof customCoverPlatforms[number];
export type CoverVariant = 'default' | 'portrait' | 'landscape';
export interface CoverSnapshot {
  dialogs: number;
  preview: string[];
  modalPreview: string[];
  busy: boolean;
  error: string;
  login: boolean;
  uploaded: boolean;
  portrait: boolean;
  landscape: boolean;
  separateEntries?: boolean;
  entryBusy?: boolean;
}
export interface CoverIO {
  read(variant: CoverVariant): Promise<CoverSnapshot>;
  action(kind: 'open' | 'tab' | 'uploadTab' | 'confirm', variant: CoverVariant): Promise<boolean>;
  upload(file: string, variant: CoverVariant): Promise<void>;
  uploadConfirmed(): boolean;
  sleep(ms: number): Promise<void>;
  now(): number;
}
const changed = (before: string[], after: string[]) => after.some(value => !before.includes(value));

/** Fail closed: a file chooser event or a closed dialog alone never proves a saved cover. */
export async function setCustomVideoCover(io: CoverIO, platform: CoverPlatform, file: string) {
  const initial = await io.read('default');
  if (initial.login) throw new Error('需要本人完成平台登录或验证');
  const variants: CoverVariant[] = platform==='baijiahao'
    ? [...(initial.landscape?['landscape' as const]:[]),...(initial.portrait?['portrait' as const]:[])]
    : platform === 'douyin' && initial.separateEntries ? ['portrait','landscape'] : platform === 'weixin'
    ? [...(initial.portrait ? ['portrait' as const] : []), ...(initial.landscape ? ['landscape' as const] : [])]
    : ['default'];
  if (!variants.length) variants.push('default');
  const evidence = new Set<string>();
  for (const variant of variants) {
    let before = await io.read(variant);
    const entryDeadline=io.now()+90000;
    while(before.entryBusy&&io.now()<entryDeadline){await io.sleep(750);before=await io.read(variant);}
    if(before.entryBusy)throw new Error('平台封面预览仍在生成，已停止提交视频，请稍后再试');
    if (!await io.action('open', variant)) throw new Error('未找到自选封面编辑入口');
    let opened = await io.read(variant);
    for (let i = 0; !opened.dialogs && i < 20; i++) { await io.sleep(250); opened = await io.read(variant); }
    if (!opened.dialogs) throw new Error('封面编辑窗口未打开');
    // The new XHS editor asynchronously initializes its video frame canvas.
    // Uploading before that initialization completes lets it overwrite our image.
    if(platform==='xiaohongshu'||platform==='baijiahao')await io.sleep(4000);
    const tabs: CoverVariant[] = platform === 'douyin' && !initial.separateEntries && opened.portrait && opened.landscape ? ['portrait', 'landscape'] : [variant];
    for (const tab of tabs) {
      if (tabs.length > 1 && !await io.action('tab', tab)) throw new Error('未找到横竖封面切换控件');
      await io.action('uploadTab', tab);
      await io.sleep(300);
      const beforeUpload = await io.read(tab);
      await io.upload(file, tab);
      const deadline = io.now() + 90000;
      let stable = 0;
      let lastPreview = '';
      while (io.now() < deadline) {
        await io.sleep(500);
        const state = await io.read(tab);
        if (state.login || state.error) throw new Error(state.error || '平台要求本人完成安全验证');
        const fingerprint = state.modalPreview.join('|');
        const applied = changed(beforeUpload.modalPreview, state.modalPreview) || (!beforeUpload.uploaded && state.uploaded);
        stable = applied && !state.busy && fingerprint === lastPreview ? stable + 1 : 0;
        lastPreview = fingerprint;
        if (stable >= 2) break;
      }
      if (stable < 2) throw new Error('自选封面上传未确认完成，已停止提交视频');
    }
    const deadline = io.now() + 45000;
    let saved = false;
    let lastClickAt = 0;
    while (io.now() < deadline) {
      const state = await io.read(variant);
      if (state.login || state.error) throw new Error(state.error || '平台要求本人完成安全验证');
      if (!state.dialogs) {
        if (changed(before.preview, state.preview) && (platform !== 'kuaishou' || io.uploadConfirmed())) {
          state.preview.filter(value=>!before.preview.includes(value)).forEach(value=>evidence.add(value));
          saved = true; break;
        }
      } else if (!state.busy && io.now() - lastClickAt >= 1500) {
        if (await io.action('confirm', variant)) lastClickAt = io.now();
      }
      await io.sleep(500);
    }
    if (!saved) throw new Error('封面保存后预览未更新，已停止提交视频');
  }
  return { ok: true, variants, evidence:[...evidence], message: '自选封面已上传并保存' };
}

export function supportsCustomCover(platform: Platform): platform is CoverPlatform {
  return customCoverPlatforms.includes(platform as CoverPlatform);
}

// Serialized into a platform frame. Only visible cover controls are eligible.
export function coverPageAction(platform: CoverPlatform, variant: CoverVariant, action: string, token: string) {
  const visible = (el: Element | null): el is HTMLElement => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const text = (el: Element) => (el.textContent || '').trim().replace(/\s+/g, '');
  const disabled = (el: HTMLElement) => {
    const button = el.closest('button,[aria-disabled]') as HTMLElement | null;
    return !!(el as HTMLButtonElement).disabled || !!(button as HTMLButtonElement | null)?.disabled || el.getAttribute('aria-disabled') === 'true' || button?.getAttribute('aria-disabled') === 'true' || /(?:^|[-_ ])disabled(?:$|[-_ ])/.test(el.className + ' ' + (button?.className || ''));
  };
  const allDialogs = Array.from(document.querySelectorAll('[role="dialog"],.dy-creator-content-modal,.semi-modal-content,.d-modal,.ant-modal,.weui-desktop-dialog,.cheetah-modal-wrap,.cheetah-modal-content')).filter(visible);
  const dialogs = allDialogs.filter(el => /封面|裁剪|确认应用|确定完成/.test(text(el)));
  const innerDialogs = dialogs.filter(el => !dialogs.some(other => other !== el && el.contains(other)));
  const active = innerDialogs.at(-1) || dialogs.at(-1);
  const inDialog = (el: Element) => dialogs.some(root => root.contains(el));
  const rootsByPlatform = {
    douyin: '[class*="cover-"]',
    kuaishou: '[class*="cover"],[class*="Cover"]',
    xiaohongshu: '.upload-cover,.cover-plugin-preview,[class*="cover-preview"]',
    weixin: variant === 'portrait' ? '.vertical-cover-wrap' : variant === 'landscape' ? '.horizontal-cover-wrap' : '.vertical-cover-wrap,.horizontal-cover-wrap,.cover-set-inner',
    baijiahao:'[data-testid="cover-preview"],.cover-preview',
  };
  let previewRoots = Array.from(document.querySelectorAll(rootsByPlatform[platform])).filter(el => visible(el) && !inDialog(el));
  const baijiahaoControls=platform==='baijiahao'?[...previewRoots]:[];
  if(platform==='baijiahao'&&variant!=='default')previewRoots=previewRoots.filter(el=>{const r=el.getBoundingClientRect();return variant==='portrait'?r.height>r.width:r.width>=r.height});
  if(platform==='xiaohongshu'){
    const actual=Array.from(document.querySelectorAll('.cover-plugin-preview .default,.upload-cover')).filter(el=>visible(el)&&!inDialog(el));
    if(actual.length)previewRoots=actual;
  }
  const douyinControls = Array.from(document.querySelectorAll('[class*="coverControl"]')).filter(el=>visible(el)&&!inDialog(el));
  if (platform === 'douyin' && variant !== 'default') previewRoots = douyinControls.filter(el=>(variant === 'portrait' ? /竖封面/ : /横封面/).test(text(el)));
  if (!previewRoots.length) previewRoots = Array.from(document.querySelectorAll('[class*="cover"],[class*="Cover"]')).filter(el => visible(el) && !inDialog(el));
  const hash = (str: string) => { let n = 2166136261; for (let i = 0; i < str.length; i++) n = Math.imul(n ^ str.charCodeAt(i), 16777619); return (n >>> 0).toString(16); };
  const signatures = (roots: Element[]) => [...new Set(roots.flatMap(root => [root, ...root.querySelectorAll('img,canvas,[style]')]).filter(visible).flatMap(el => {
    if (el.tagName === 'IMG') {const img=el as HTMLImageElement;return img.complete && img.naturalWidth > 20 ? [hash(img.currentSrc || img.src)] : [];}
    if (el.tagName === 'CANVAS') {const canvas=el as HTMLCanvasElement;try { return canvas.width > 20 ? [hash(canvas.toDataURL())] : []; } catch { return []; } }
    const bg = getComputedStyle(el).backgroundImage;
    return bg && bg !== 'none' ? [hash(bg)] : [];
  }))];
  const modalText = dialogs.map(el => el.innerText).join('\n');
  const state: CoverSnapshot = {
    dialogs: dialogs.length, preview: signatures(previewRoots), modalPreview: signatures(dialogs),
    busy: /上传中|正在上传|图片处理中|正在处理图片|[1-9][0-9]?%/.test(modalText) && !/上传成功|上传完成|100%/.test(modalText),
    error: (modalText.match(/(?:上传失败|图片处理失败|不支持该格式|图片大小超出|图片尺寸不符合)[^\n]*/) || [''])[0],
    login: /\/login(?:[/?]|$)|\/auth(?:[/?]|$)/.test(location.pathname) || /请完成安全验证|扫码登录|密码登录/.test(document.body.innerText),
    uploaded: /清空上传|重新上传封面|图片上传成功|封面上传成功/.test(modalText),
    portrait: platform==='baijiahao'?baijiahaoControls.some(el=>{const r=el.getBoundingClientRect();return r.height>r.width}):platform === 'weixin' ? Array.from(document.querySelectorAll('.vertical-cover-wrap')).some(visible) : /设置竖封面/.test(modalText),
    landscape: platform==='baijiahao'?baijiahaoControls.some(el=>{const r=el.getBoundingClientRect();return r.width>=r.height}):platform === 'weixin' ? Array.from(document.querySelectorAll('.horizontal-cover-wrap')).some(visible) : /设置横封面/.test(modalText),
    separateEntries: platform === 'douyin' && douyinControls.some(el=>/竖封面/.test(text(el))) && douyinControls.some(el=>/横封面/.test(text(el))),
    entryBusy:platform==='weixin'&&previewRoots.some(root=>Array.from(root.querySelectorAll('.vertical-mask-layer,.horizontal-mask-layer')).some(visible)),
  };
  if (action === 'read') return { state };
  if(action==='images')return {state,images:[...new Set(previewRoots.flatMap(root=>[root,...root.querySelectorAll('img,canvas,[style]')]).filter(visible).flatMap(el=>{
    if(el.tagName==='IMG'){const img=el as HTMLImageElement;return img.complete&&img.naturalWidth>20?[img.currentSrc||img.src]:[];}
    if(el.tagName==='CANVAS'){const canvas=el as HTMLCanvasElement;try{return canvas.width>20?[canvas.toDataURL()]:[]}catch{return[]}}
    const match=getComputedStyle(el).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/);return match?[match[1]]:[];
  }))].slice(0,8)};
  if (action === 'dismissGuide') {
    const guides = Array.from(document.querySelectorAll('.shepherd-element,.d-modal,.semi-modal-content,.weui-desktop-dialog,[class*="guide"],[class*="Guide"]')).filter(el=>visible(el)&&/视频可以PK封面啦|视频预览功能|新手引导|修改视频的描述和封面/.test(el.innerText));
    for (const guide of guides) {
      const button = Array.from(guide.querySelectorAll('button,span,div')).find(el=>visible(el)&&/^(我知道了|知道了|跳过)$/.test(text(el)));
      if (button) { (button as HTMLElement).click(); return { state, found:true }; }
    }
    return {state,found:false};
  }
  const byText = (root: Element, labels: string[]) => Array.from(root.querySelectorAll('button,[role="button"],[role="tab"],a,span,div')).filter(el => visible(el) && !disabled(el) && labels.includes(text(el))).sort((a,b) => Number(!a.matches('button,[role="button"],[role="tab"],a'))-Number(!b.matches('button,[role="button"],[role="tab"],a')) || a.getBoundingClientRect().width*a.getBoundingClientRect().height - b.getBoundingClientRect().width*b.getBoundingClientRect().height)[0] as HTMLElement | undefined;
  let target: HTMLElement | undefined;
  if (action === 'open') {
    target = previewRoots.find(el => /upload-cover|vertical-cover-wrap|horizontal-cover-wrap|cover-set-inner/.test(el.className)) as HTMLElement | undefined;
    if(platform==='weixin'&&target)target=byText(target,['编辑','选择封面'])||target;
    if(platform==='baijiahao')target=previewRoots.find(el=>!!el.querySelector('img,canvas')) as HTMLElement|undefined;
    if (platform === 'xiaohongshu') {
      target = Array.from(document.querySelectorAll('.upload-cover,.cover-plugin-preview .default')).find(el=>visible(el)&&!inDialog(el)) as HTMLElement | undefined;
      if(target)target=byText(target,['编辑封面'])||target;
    }
    if (!target && platform === 'douyin') {
      target = previewRoots.filter(el => el.querySelector('img,canvas')).sort((a,b) => a.getBoundingClientRect().width*a.getBoundingClientRect().height-b.getBoundingClientRect().width*b.getBoundingClientRect().height)[0] as HTMLElement | undefined;
      if (target) target = byText(target,['编辑封面']) || target;
    }
    target ||= byText(document.body, ['编辑封面','选择封面','设置封面','更换封面','封面设置']);
    if (platform === 'kuaishou' && target && text(target) === '封面设置') target = target.parentElement?.nextElementSibling?.querySelector('div') as HTMLElement || target;
    target ||= previewRoots.find(el => !!el.querySelector('img')) as HTMLElement | undefined;
  } else if (action === 'tab' && active) target = byText(active, [variant === 'portrait' ? '设置竖封面' : '设置横封面']);
  else if (action === 'uploadTab' && active) target = byText(active, ['上传封面','本地上传']);
  else if (action === 'confirm' && active) target = byText(active, ['确定','确认','完成','保存','确认应用','仍然完成']);
  else if (action === 'input' && active) {
    let inputs = Array.from(active.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter(el => !el.disabled && visible(el.parentElement) && !/video/i.test(el.accept) && (!el.accept || /image|png|jpe?g|webp/i.test(el.accept)));
    if (platform === 'douyin') {
      const actual = inputs.filter(el => el.closest('.semi-upload')?.querySelector('.semi-upload-drag-area-main-text'));
      inputs = actual.length ? actual : inputs.filter(el => !/生成参考图|AI参考图/.test(el.parentElement?.innerText || ''));
      const ordinary = inputs.filter(el => !el.className.includes('-replace'));
      if (ordinary.length) inputs = ordinary;
    }
    if (platform === 'weixin') {
      const scoped = inputs.filter(el => !!el.closest('.single-cover-uploader-wrap'));
      if (scoped.length) inputs = scoped;
    }
    target = inputs.at(-1);
  }
  if (!target || (action !== 'input' && (!visible(target) || disabled(target)))) return { state, found: false };
  target.setAttribute('data-multipublish-cover-control', token);
  if (action !== 'input') target.scrollIntoView({ block: 'center' });
  const r = target.getBoundingClientRect();
  return { state, found: true, x: r.x+r.width/2, y: r.y+r.height/2, token };
}
