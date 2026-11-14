import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Empty, Input, Select, Space, Switch, Tag, Tooltip, message } from 'antd';
import { BellOutlined, CheckOutlined, CommentOutlined, MailOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import type { Account } from '../../shared/types';
import type { InboxData, InboxEntry } from '../../shared/inbox';
import { platformMap } from '../../shared/platforms';
import './inbox.css';

const statusName = { waiting:'待同步',syncing:'同步中',ready:'已连接',login_required:'需登录',unavailable:'暂不可用',error:'需检查' };
const date = (timestamp?: number) => timestamp ? new Date(timestamp).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
export function Inbox({ accounts, data }: {accounts: Account[]; data?: InboxData}) {
  const [accountId,setAccountId]=useState('all'),[filter,setFilter]=useState('unread'),[query,setQuery]=useState(''),[selected,setSelected]=useState<string>(),[draft,setDraft]=useState(''),[refreshing,setRefreshing]=useState(false),[sending,setSending]=useState(false),[opening,setOpening]=useState(false);
  const draftTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const pendingDraft=useRef<{id:string;text:string}|null>(null);
  const entry=data?.entries.find(e=>e.id===selected);
  const unread=data?.entries.filter(e=>e.unread).length||0;
  const visible=useMemo(()=>[...(data?.entries||[])].filter(e=>(accountId==='all'||e.accountId===accountId)&&(filter==='all'||filter==='unread'&&e.unread||filter==='comment'&&e.kind==='comment'||filter==='private'&&e.kind==='private'||filter==='replied'&&e.replyStatus==='sent')&&(!query||[e.author,e.text,e.context].join(' ').toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>(b.timestamp||b.updatedAt)-(a.timestamp||a.updatedAt)),[data,accountId,filter,query]);
  useEffect(()=>{setDraft(entry?.replyDraft||'');},[selected]);
  const report=(error:unknown)=>message.error(error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': Error: /,''):String(error));
  const settings=(patch:Partial<InboxData['settings']>)=>window.multiPublish.setInboxSettings(patch).catch(report);
  function saveDraft(){if(draftTimer.current)clearTimeout(draftTimer.current);const pending=pendingDraft.current;pendingDraft.current=null;if(pending)void window.multiPublish.updateInboxEntry(pending.id,{replyDraft:pending.text}).catch(report);}
  useEffect(()=>()=>saveDraft(),[]);
  async function choose(item:InboxEntry){saveDraft();setSelected(item.id);if(item.unread)await window.multiPublish.updateInboxEntry(item.id,{unread:false}).catch(report);}
  function changeDraft(text:string){setDraft(text);if(draftTimer.current)clearTimeout(draftTimer.current);if(entry){pendingDraft.current={id:entry.id,text};draftTimer.current=setTimeout(saveDraft,400);}}
  async function send(){if(!entry||!draft.trim()||sending)return;if(draftTimer.current)clearTimeout(draftTimer.current);setSending(true);try{const result=await window.multiPublish.replyInbox(entry.id,draft);if(result.status==='sent'){setDraft('');message.success(result.message)}else message.warning(result.message,8);}catch(error){report(error)}finally{setSending(false)}}
  async function open(){if(!entry)return;setOpening(true);try{const result=await window.multiPublish.openInboxEntry(entry.id);if(!result.located)message.info(result.message,6);}catch(error){report(error)}finally{setOpening(false)}}
  return <div className="inbox-shell">
    <aside className="inbox-sidebar">
      <div className="inbox-heading"><BellOutlined/><strong>消息中心</strong><Badge count={unread} overflowCount={999}/></div>
      <div className="inbox-filter-list">{[
        ['unread','未读消息',<MailOutlined/>],['all','全部消息',<CommentOutlined/>],['comment','视频评论',<CommentOutlined/>],['private','私信会话',<MailOutlined/>],['replied','已回复',<CheckOutlined/>],
      ].map(([id,label,icon])=><button key={String(id)} className={filter===id?'active':''} onClick={()=>setFilter(String(id))}>{icon}{label}</button>)}</div>
      <div className="inbox-account-label">账号连接</div>
      <button className={'inbox-account-filter '+(accountId==='all'?'active':'')} onClick={()=>setAccountId('all')}>全部账号</button>
      {accounts.map(account=><div className="inbox-account" key={account.id}>
        <button className={'inbox-account-filter '+(accountId===account.id?'active':'')} onClick={()=>setAccountId(account.id)}><i style={{background:platformMap[account.platform].color}}>{platformMap[account.platform].name.slice(0,1)}</i><span>{account.name}<small>{platformMap[account.platform].name}</small></span><Badge count={data?.entries.filter(e=>e.accountId===account.id&&e.unread).length||0}/></button>
        <div className="inbox-channel-tags">{(['comment','private'] as const).map(kind=>{const channel=data?.channels.find(c=>c.accountId===account.id&&c.kind===kind);return <Tooltip key={kind} title={channel?.detail||(channel?.lastSuccess?'上次同步 '+date(channel.lastSuccess):'等待同步')}><button disabled={channel?.status==='unavailable'} onClick={()=>window.multiPublish.openInboxChannel(account.id,kind).catch(report)}><Tag color={channel?.status==='ready'?'green':channel?.status==='syncing'?'blue':channel?.status==='error'||channel?.status==='login_required'?'orange':undefined}>{kind==='comment'?'评论':'私信'} · {statusName[channel?.status||'waiting']}</Tag></button></Tooltip>})}</div>
      </div>)}
      <div className="inbox-running-note">电脑联网、软件运行时自动检查。关闭主窗口可留在托盘继续提醒；电脑休眠或退出软件后暂停。</div>
    </aside>
    <section className="inbox-main">
      <div className="inbox-toolbar">
        <Input.Search allowClear placeholder="搜索用户、消息或视频标题" value={query} onChange={e=>setQuery(e.target.value)} style={{maxWidth:320}}/>
        <Space><Button icon={<ReloadOutlined/>} loading={refreshing} onClick={async()=>{setRefreshing(true);try{await window.multiPublish.syncInbox(accountId==='all'?undefined:accountId)}catch(error){report(error)}finally{setRefreshing(false)}}}>立即检查</Button><Button disabled={!unread} onClick={()=>window.multiPublish.markInboxRead().catch(report)}>全部已读</Button></Space>
      </div>
      <div className="inbox-settings">
        <label>自动检查 <Switch size="small" checked={data?.settings.enabled} onChange={enabled=>settings({enabled})}/></label>
        <Select size="small" value={data?.settings.intervalSeconds||90} onChange={intervalSeconds=>settings({intervalSeconds})} options={[60,90,120,300].map(n=>({value:n,label:n+' 秒'}))}/>
        <label>桌面提醒 <Switch size="small" checked={data?.settings.notifications} onChange={notifications=>settings({notifications})}/></label>
        <label>关闭后留在托盘 <Switch size="small" checked={data?.settings.closeToTray} onChange={closeToTray=>settings({closeToTray})}/></label>
        <span>首次导入历史消息不弹窗</span>
      </div>
      <div className="inbox-columns">
        <div className="inbox-list">
          <div className="inbox-list-count">{visible.length} 条{filter==='unread'?'未读消息':'消息'}</div>
          {visible.map(item=><button key={item.id} onClick={()=>void choose(item)} className={'inbox-message '+(selected===item.id?'selected ':'')+(item.unread?'unread':'')}>
            <div className="inbox-message-title"><strong>{item.author}</strong><time>{date(item.timestamp)||item.timeLabel||date(item.receivedAt)}</time></div>
            <div className="inbox-message-text">{item.text}</div>
            <div className="inbox-message-meta"><span style={{color:platformMap[item.platform].color}}>{platformMap[item.platform].name} · {item.kind==='comment'?'评论':item.context==='群聊'?'群聊':'私信'}</span>{item.unread&&<Badge status="processing"/>}{item.replyStatus==='sent'&&<span className="inbox-replied">已回复</span>}{item.replyStatus==='uncertain'&&<Tag color="orange">待核对</Tag>}</div>
          </button>)}
          {!visible.length&&<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filter==='unread'?'当前没有未读消息，可切换“全部消息”查看历史':'暂无消息；连接异常时请检查左侧账号状态'}/>}
        </div>
        <div className="inbox-detail">{entry?<>
          <div className="inbox-detail-heading"><div><strong>{entry.author}</strong><p>{platformMap[entry.platform].name} · {accounts.find(a=>a.id===entry.accountId)?.name} · {entry.kind==='comment'?'评论':'私信'}</p></div><Button loading={opening} onClick={()=>void open()}>在助手内查看原会话</Button></div>
          {entry.context&&<div className="inbox-context">{entry.kind==='comment'?'关联作品：':''}{entry.context}</div>}
          <div className="inbox-conversation"><div className="inbox-bubble"><div>{entry.text}</div><small>{date(entry.timestamp)||entry.timeLabel}</small></div>
            {entry.replies.map((reply,index)=><div key={index} className="inbox-bubble mine"><div>{reply.text}</div><small>{date(reply.at)} · {reply.status==='sent'?'平台已确认':'结果待核对'}</small></div>)}
          </div>
          {entry.replyStatus==='uncertain'&&<Alert type="warning" showIcon message="上一条回复结果待核对" description={<span>请先打开原会话确认是否已经发送，避免重复回复。<Button type="link" onClick={()=>window.multiPublish.updateInboxEntry(entry.id,{resolveUncertain:true}).catch(report)}>我已核对，解除发送限制</Button></span>}/>}
          <div className="inbox-composer"><Input.TextArea value={draft} onChange={e=>changeDraft(e.target.value)} placeholder={'回复 '+entry.author+'，填写后点击发送'} autoSize={{minRows:4,maxRows:8}} maxLength={entry.platform==='baijiahao'&&entry.kind==='private'?200:2000} showCount disabled={sending}/><div className="inbox-composer-footer"><span>回复使用这条消息所属的账号。平台有额外限制时可在原会话中处理。</span><Button type="primary" icon={<SendOutlined/>} loading={sending||entry.replyStatus==='sending'} disabled={!draft.trim()||entry.replyStatus==='uncertain'} onClick={()=>void send()}>发送回复</Button></div></div>
        </>:<div className="inbox-detail-empty"><CommentOutlined/><h3>选择一条消息查看并回复</h3><p>消息按原平台、原账号发送，发布功能和登录数据继续沿用。</p></div>}</div>
      </div>
    </section>
  </div>;
}
