import { app, BrowserWindow, Menu, nativeImage, Notification, Tray } from 'electron';
import type { InboxManager } from './inbox-manager';

export class InboxTray {
  private tray: Tray;
  private explained = false;
  constructor(private win: BrowserWindow, private inbox: InboxManager, private isQuitting: () => boolean) {
    const bitmap=Buffer.alloc(32*32*4);
    for(let y=0;y<32;y++)for(let x=0;x<32;x++){
      const p=(y*32+x)*4,inside=(x-15.5)**2+(y-15.5)**2<240;
      const letter=inside&&y>=8&&y<=24&&(x>=7&&x<=10||x>=22&&x<=25||y<=17&&Math.abs(x-(7+(y-8)))<=2||y<=17&&Math.abs(x-(25-(y-8)))<=2);
      bitmap[p]=letter?255:238;bitmap[p+1]=letter?255:106;bitmap[p+2]=letter?255:45;bitmap[p+3]=inside?255:0;
    }
    this.tray=new Tray(nativeImage.createFromBitmap(bitmap,{width:32,height:32}));
    this.tray.on('double-click',()=>this.show());
    this.tray.on('click',()=>this.show());
    win.on('close',event=>{
      if(this.isQuitting())return;
      event.preventDefault();
      if(!this.inbox.get().settings.closeToTray){app.quit();return;}
      win.hide();
      if(!this.explained&&Notification.isSupported()){this.explained=true;new Notification({title:'MultiPublish 已在后台运行',body:'有新消息会提醒你。双击右下角托盘图标打开，右键选择“退出”可完全关闭。'}).show();}
    });
    this.refresh();
  }
  show(inbox=false){if(this.win.isDestroyed())return;if(this.win.isMinimized())this.win.restore();this.win.show();this.win.focus();if(inbox)this.win.webContents.send('inbox:show');}
  refresh(){const count=this.inbox.get().entries.filter(e=>e.unread).length;this.tray.setToolTip('MultiPublish · '+count+' 条未读消息');this.tray.setContextMenu(Menu.buildFromTemplate([{label:'打开消息中心（'+count+'）',click:()=>this.show(true)},{label:'打开主窗口',click:()=>this.show()},{type:'separator'},{label:'退出',click:()=>app.quit()}]));}
  destroy(){this.tray.destroy();}
}
