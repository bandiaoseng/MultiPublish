import { app, BrowserWindow, Notification, session } from 'electron';
import type { Account } from '../shared/types';
import type { InboxCandidate, InboxData, InboxEntry, InboxKind, InboxOpenResult, InboxReplyResult } from '../shared/inbox';
import { InboxStore } from './inbox-store';
import { beginReply, finishReply, inboxChannelId, mergeInbox, recoverReplies } from './inbox-core';
import { inboxFromResponses, inboxUrls, isInboxReadResponse, matchesInboxReply, validInboxUrl, type InboxResponse } from './inbox-adapters';
import { inboxPage } from './inbox-page';
import { collectInbox } from './inbox-collect';
// Match the existing publisher without importing or initializing its upload machinery.
const chromeUserAgent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<never>((_,reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
interface InboxWindow { win: BrowserWindow; responses: InboxResponse[]; sends: Array<{at:number;ok:boolean}>; pending: Set<Promise<void>>; url: string; armed?: {text:string;ids:string[]} }

export class InboxManager {
  readonly store = new InboxStore();
  private windows = new Map<string, InboxWindow>();
  private jobs = new Map<string, Promise<any>>();
  private due = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private removed = new Set<string>();
  private notifications = new Set<Notification>();
  constructor(private accounts: () => Account[], private changed: () => void, private focus: () => void) {}
  async load() { await this.store.load(); await this.store.update(recoverReplies); await this.reconcile(); }
  get() { const data = this.store.get(), ids = new Set(this.accounts().map(a => a.id)); data.entries = data.entries.filter(e => ids.has(e.accountId)); data.channels = data.channels.filter(c => ids.has(c.accountId)); return data; }
  private async reconcile() {
    await this.store.update(data => {
      for (const account of this.accounts()) for (const kind of ['comment','private'] as const) if (!data.channels.some(c => c.accountId === account.id && c.kind === kind)) {
        const url = inboxUrls[account.platform]?.[kind];
        data.channels.push({ accountId: account.id, kind, status: url ? 'waiting' : 'unavailable', detail: url ? '等待首次同步' : account.platform === 'kuaishou' ? '快手创作者网页版暂未提供可用私信入口' : '此平台尚未接入消息中心' });
      }
    });
  }
  start() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => { void this.tick(); }, 2000);
    setTimeout(() => { void this.tick(); }, 4000);
  }
  private async tick() {
    if (this.stopped || !this.store.get().settings.enabled || this.jobs.size >= 2) return;
    for (const account of this.accounts()) for (const kind of ['comment','private'] as const) {
      const key = inboxChannelId(account.id,kind);
      if (this.jobs.size >= 2) return;
      if (inboxUrls[account.platform]?.[kind] && !this.jobs.has(key) && !this.windows.get(key)?.win.isVisible() && (this.due.get(key) || 0) <= Date.now()) void this.poll(account,kind).catch(() => undefined);
    }
  }
  private exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.jobs.get(key) || Promise.resolve();
    const job = previous.catch(() => undefined).then(()=>{if(this.stopped)throw new Error('软件正在退出');return operation()});
    this.jobs.set(key,job);
    void job.finally(() => { if (this.jobs.get(key) === job) this.jobs.delete(key); }).catch(() => undefined);
    return job;
  }
  async sync(accountId?: string) {
    await this.reconcile();
    const tasks = this.accounts().filter(a => !accountId || a.id === accountId).flatMap(account => (['comment','private'] as const).filter(kind => inboxUrls[account.platform]?.[kind]).map(kind => ({account,kind})));
    let index = 0;
    await Promise.all([0,1].map(async () => { while(index < tasks.length && !this.stopped) { const task = tasks[index++]; const key = inboxChannelId(task.account.id,task.kind); if (this.windows.get(key)?.win.isVisible()) continue; await (this.jobs.get(key) || this.poll(task.account,task.kind)).catch(() => undefined); } }));
    return this.get();
  }
  private async window(account: Account, kind: InboxKind): Promise<InboxWindow> {
    if(this.stopped||this.removed.has(account.id))throw new Error('账号已移除或软件正在退出');
    const key = inboxChannelId(account.id,kind), existing = this.windows.get(key);
    if (existing && !existing.win.isDestroyed()) return existing;
    const win = new BrowserWindow({ show:false, width:1300, height:900, title: account.name + ' · ' + (kind === 'comment' ? '评论' : '私信'), autoHideMenuBar:true,
      webPreferences:{ session: session.fromPartition('persist:account-'+account.id), nodeIntegration:false, contextIsolation:true, sandbox:true, backgroundThrottling:false } });
    const wc = win.webContents;
    wc.setUserAgent(chromeUserAgent); wc.setAudioMuted(true);
    wc.setWindowOpenHandler(({url}) => { if (validInboxUrl(account.platform,url)) void wc.loadURL(url); return {action:'deny'}; });
    win.on('close', e => { if (!this.stopped) { e.preventDefault(); win.hide(); this.due.set(key,Date.now()+15000); } });
    const state: InboxWindow = {win,responses:[],sends:[],pending:new Set(),url:''}; this.windows.set(key,state);
    await wc.loadURL('about:blank'); wc.debugger.attach('1.3');
    await timeout(wc.debugger.sendCommand('Network.enable'),5000,'消息页面调试连接超时');
    const requests = new Map<string, {path:string;query:Record<string,string>;outgoing:boolean;status?:number}>();
    wc.debugger.on('message', (_event,method,p) => {
      if (method === 'Network.requestWillBeSent') {
        let url: URL; try { url = new URL(p.request.url); } catch { return; }
        const allowed = /(^|\.)(douyin\.com|kuaishou\.com|xiaohongshu\.com|weixin\.qq\.com|baidu\.com)$/.test(url.hostname);
        if (!allowed) return;
        const outgoing=!!state.armed&&matchesInboxReply(url.pathname,p.request.method,p.request.postData||'',state.armed.text,state.armed.ids);
        if (isInboxReadResponse(url.pathname) || outgoing) {
          const query: Record<string,string> = {};
          for (const name of ['photoId','aweme_id','item_id']) if(url.searchParams.has(name)) query[name] = url.searchParams.get(name)!;
          try { const body = JSON.parse(p.request.postData || '{}'); if (body.photoId) query.photoId = String(body.photoId); } catch { /* form or binary body is not retained */ }
          requests.set(p.requestId,{path:url.pathname,query,outgoing});
        }
      }
      if(method==='Network.responseReceived'&&requests.has(p.requestId))requests.get(p.requestId)!.status=p.response.status;
      if (method === 'Network.loadingFinished' && requests.has(p.requestId)) {
        const request = requests.get(p.requestId)!; requests.delete(p.requestId);
        const job = (async () => { try {
          const raw = await timeout(wc.debugger.sendCommand('Network.getResponseBody',{requestId:p.requestId}),5000,'响应读取超时');
          if(raw.base64Encoded || raw.body.length > 3000000) return;
          const data = (JSON.parse as any)(raw.body, (_key:string,value:any,context:any) => typeof value === 'number' && !Number.isSafeInteger(value) && context?.source ? context.source : value);
          if (isInboxReadResponse(request.path)) { state.responses.push({...request,data,at:Date.now()}); if(state.responses.length>150)state.responses.shift(); }
          else if(request.outgoing) { const code = data.status_code ?? data.errno ?? data.error_code ?? data.errCode ?? data.code; const ok = !!request.status&&request.status>=200&&request.status<300&&(data.result === 1 || (code !== undefined && Number(code) === 0 && data.success !== false) || (data.code === 200 && data.message === 'success')); state.sends.push({at:Date.now(),ok}); if(state.sends.length>30)state.sends.shift(); }
        } catch { /* Binary SDK acknowledgements remain uncertain, never guessed successful. */ } })();
        state.pending.add(job); void job.finally(() => state.pending.delete(job));
      }
      if (method === 'Network.loadingFailed') requests.delete(p.requestId);
    });
    return state;
  }
  private async navigate(state: InboxWindow, account: Account, kind: InboxKind, url?: string) {
    const target = url || inboxUrls[account.platform]?.[kind]; if (!target || !validInboxUrl(account.platform,target)) throw new Error('该平台没有可用消息入口');
    state.responses=[]; state.url=target;
    await timeout(state.win.webContents.loadURL(target).catch(error => { if (!String(error).includes('ERR_ABORTED')) throw error; }),25000,'平台页面加载超时');
    await sleep(3500);
    const body = await this.page(state,'read',account,kind);
    if (body.login) throw new Error('LOGIN_REQUIRED: 平台要求重新登录，请在助手内打开账号完成验证');
  }
  private page(state: InboxWindow, action: Parameters<typeof inboxPage>[0], account: Account, kind: InboxKind, hints: InboxCandidate[] = [], target?: InboxEntry, text = ''): Promise<any> {
    const args = JSON.stringify([action,account.platform,kind,hints,target || null,text]);
    return timeout(state.win.webContents.executeJavaScript('('+inboxPage.toString()+')(...'+args+')'),20000,'平台消息页面响应超时');
  }
  private poll(account: Account, kind: InboxKind) {
    const key = inboxChannelId(account.id,kind);
    return this.exclusive(key,async () => {
      if (this.stopped||this.removed.has(account.id)) return;
      this.due.set(key,Date.now()+this.store.get().settings.intervalSeconds*1000);
      await this.channel(account.id,kind,'syncing','正在检查新消息');
      try {
        const state = await this.window(account,kind);
        await this.navigate(state,account,kind);
        const known = this.get().entries.filter(e => e.accountId === account.id && e.kind === kind).map(e => e.remoteId);
        let collected: any = {recognized:false,items:[]}, collectError = '';
        if (kind === 'comment' && ['douyin','kuaishou','baijiahao','weixin'].includes(account.platform) || account.platform === 'weixin' && kind === 'private') {
          try { collected = await timeout(state.win.webContents.executeJavaScript('('+collectInbox.toString()+')(...'+JSON.stringify([account.platform,kind,known])+')'),75000,'评论历史同步超时'); } catch(error) { collectError = String(error); }
        }
        await timeout(Promise.allSettled([...state.pending]),7000,'消息响应等待超时');
        const network = inboxFromResponses(account.platform,kind,state.responses);
        let dom = await this.page(state,'read',account,kind,network.items);
        for(let retry=0;retry<5&&!network.recognized&&!dom.recognized&&!collected.recognized;retry++){await sleep(1000);dom=await this.page(state,'read',account,kind,inboxFromResponses(account.platform,kind,state.responses).items);}
        const freshNetwork = inboxFromResponses(account.platform,kind,state.responses);
        const candidates = new Map<string,InboxCandidate>();
        for (const item of [...freshNetwork.items,...dom.items,...collected.items]) candidates.set(item.remoteId,item);
        if (!freshNetwork.recognized && !dom.recognized && !collected.recognized && !dom.empty) throw new Error(collectError || '尚未读到可确认的消息列表，请打开平台页面检查登录或访问状态');
        if(this.stopped||this.removed.has(account.id))return;
        let newIds: string[] = [];
        await this.store.update(data => { newIds = mergeInbox(data,account,kind,[...candidates.values()]); const channel=data.channels.find(c=>c.accountId===account.id&&c.kind===kind)!; channel.detail=collected.limited?'已同步部分记录，历史较多；可在平台查看完整历史':collectError?'已读取当前页面，跨作品检查未完成，请手动刷新重试':''; if(collectError)channel.status='error'; });
        this.changed();
        if (newIds.length && this.store.get().settings.notifications) this.notify(account,kind,newIds.length);
      } catch(error) {
        if(this.stopped||this.removed.has(account.id))return;
        const message = error instanceof Error ? error.message : String(error), login = message.includes('LOGIN_REQUIRED');
        await this.channel(account.id,kind,login?'login_required':'error',login?'平台要求重新登录，账号数据仍保留':message.replace(/^Error:\s*/, '').slice(0,160));
        this.due.set(key,Date.now()+(login?300000:120000));
      }
    });
  }
  private async channel(accountId: string, kind: InboxKind, status: InboxData['channels'][number]['status'], detail: string) {
    await this.store.update(data => { let channel=data.channels.find(c=>c.accountId===accountId&&c.kind===kind);if(!channel){channel={accountId,kind,status,detail};data.channels.push(channel)}Object.assign(channel,{status,detail,lastAttempt:Date.now()}); }); this.changed();
  }
  private notify(account: Account, kind: InboxKind, count: number) {
    if (!Notification.isSupported()) return;
    const notice = new Notification({ title:'MultiPublish · 新'+(kind==='comment'?'评论':'私信'), body:account.name+' 有 '+count+' 条新消息，点击查看', silent:false });
    notice.on('click',this.focus); notice.on('close',()=>this.notifications.delete(notice));this.notifications.add(notice);notice.show();
  }
  async settings(patch: Partial<InboxData['settings']>) {
    if(!patch||typeof patch!=='object')throw new Error('设置无效');
    await this.store.update(data=>{for(const key of ['enabled','notifications','closeToTray'] as const)if(typeof patch[key]==='boolean')data.settings[key]=patch[key]!;if(typeof patch.intervalSeconds==='number'&&[60,90,120,300].includes(patch.intervalSeconds))data.settings.intervalSeconds=patch.intervalSeconds;});this.changed();return this.get();
  }
  async updateEntry(id: string, patch: { unread?: boolean; replyDraft?: string; resolveUncertain?: boolean }) {
    await this.store.update(data=>{const e=data.entries.find(e=>e.id===id);if(!e)throw new Error('消息不存在');if(typeof patch.unread==='boolean')e.unread=patch.unread;if(typeof patch.replyDraft==='string')e.replyDraft=patch.replyDraft.slice(0,2000);if(patch.resolveUncertain&&e.replyStatus==='uncertain')e.replyStatus='none';});this.changed();return this.get();
  }
  async markAllRead() { await this.store.update(data=>{for(const e of data.entries)e.unread=false});this.changed();return this.get(); }
  private target(id: string) { const entry=this.get().entries.find(e=>e.id===id),account=this.accounts().find(a=>a.id===entry?.accountId);if(!entry||!account)throw new Error('消息或账号已不存在');return {entry,account}; }
  async open(id: string): Promise<InboxOpenResult> {
    const {entry,account}=this.target(id),key=inboxChannelId(account.id,entry.kind);
    return this.exclusive(key,async()=>{const state=await this.window(account,entry.kind);await this.navigate(state,account,entry.kind,entry.sourceUrl);const hints=inboxFromResponses(account.platform,entry.kind,state.responses).items;const result=await this.page(state,'locate',account,entry.kind,[...hints,entry],entry);state.win.show();state.win.focus();await this.updateEntry(id,{unread:false});return result;});
  }
  async openChannel(accountId: string, kind: InboxKind) {
    const account=this.accounts().find(a=>a.id===accountId);if(!account)throw new Error('账号不存在');
    const key=inboxChannelId(accountId,kind);return this.exclusive(key,async()=>{const state=await this.window(account,kind);try{await this.navigate(state,account,kind)}finally{state.win.show();state.win.focus()}});
  }
  async reply(id: string, text: string): Promise<InboxReplyResult> {
    const {entry,account}=this.target(id),key=inboxChannelId(account.id,entry.kind);
    await this.store.update(data=>{beginReply(data,id,text)});this.changed();
    return this.exclusive(key,async()=>{
      let attempted=false;
      try {
        if(account.platform==='baijiahao'&&entry.kind==='private'&&text.length>200)throw new Error('百家号私信每条最多 200 字');
        const state=await this.window(account,entry.kind);await this.navigate(state,account,entry.kind,entry.sourceUrl);
        const hints=inboxFromResponses(account.platform,entry.kind,state.responses).items;
        const located=await this.page(state,'locate',account,entry.kind,[...hints,entry],entry);
        if(!located.ready)throw new Error(located.message || '无法准确定位回复对象，请在助手内打开会话回复');
        await this.page(state,'fill',account,entry.kind,[],entry,text);await sleep(250);
        const start=Date.now(); attempted=true;state.armed={text,ids:[entry.remoteId,entry.threadId,entry.authorId]};
        await this.page(state,'send',account,entry.kind,[],entry,text);
        for(let i=0;i<20;i++){await sleep(500);if(state.sends.some(s=>s.at>=start&&s.ok)){state.armed=undefined;await this.store.update(data=>finishReply(data,id,text,'sent'));this.changed();this.due.set(key,Date.now()+10000);return {status:'sent',message:'平台已确认回复发送成功'};}}
        state.armed=undefined;await this.store.update(data=>finishReply(data,id,text,'uncertain'));this.changed();return {status:'uncertain',message:'已尝试发送，尚未收到明确确认，请打开原会话核对后再操作'};
      } catch(error) {
        const current=this.windows.get(key);if(current)current.armed=undefined;
        await this.store.update(data=>{if(attempted)finishReply(data,id,text,'uncertain');else {const item=data.entries.find(e=>e.id===id);if(item)item.replyStatus='none';}});this.changed();
        if(attempted)return {status:'uncertain',message:'发送结果待核对，请先打开原会话确认，避免重复发送'};
        throw error;
      }
    });
  }
  async testPrepare(id:string) {
    if(!app.getPath('userData').includes('\\work\\inbox\\')||process.env.MULTIPUBLISH_INBOX_QA!=='1')throw new Error('仅允许隔离诊断');
    const {entry,account}=this.target(id),state=await this.window(account,entry.kind);
    await this.navigate(state,account,entry.kind,entry.sourceUrl);
    const network=inboxFromResponses(account.platform,entry.kind,state.responses);
    const prepared=await this.page(state,'locate',account,entry.kind,[...network.items,entry],entry);
    const controls=await state.win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('textarea,[contenteditable=true],button')).filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,cls:String(e.className),text:(e.innerText||'').slice(0,40),placeholder:e.getAttribute('placeholder')}))`);
    return {prepared,controls,screenshot:(await state.win.webContents.capturePage()).toPNG()};
  }
  async removeAccount(accountId:string) {
    this.removed.add(accountId);
    for(const kind of ['comment','private'] as const){const key=inboxChannelId(accountId,kind),state=this.windows.get(key);if(state&&!state.win.isDestroyed())state.win.destroy();this.windows.delete(key);this.due.delete(key);}
    await Promise.allSettled([...this.jobs].filter(([key])=>key.startsWith(accountId+':')).map(([,job])=>job));
    await this.store.update(data=>{data.entries=data.entries.filter(e=>e.accountId!==accountId);data.channels=data.channels.filter(c=>c.accountId!==accountId)});this.changed();
  }
  async destroy() {
    this.stopped=true;if(this.timer)clearInterval(this.timer);
    for(const notice of this.notifications)notice.close();this.notifications.clear();
    for(const {win} of this.windows.values())if(!win.isDestroyed())win.destroy();this.windows.clear();
    await timeout(Promise.allSettled([...this.jobs.values()]),20000,'正在保存消息记录').catch(()=>undefined);
    await this.store.update(()=>{});
    await Promise.allSettled(this.accounts().map(a=>{const s=session.fromPartition('persist:account-'+a.id);return Promise.all([s.cookies.flushStore(),s.flushStorageData()])}));
  }
}
