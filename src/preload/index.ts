import { contextBridge, ipcRenderer } from "electron";
import type { InboxData, InboxKind } from '../shared/inbox';
import type {
  AccountInput,
  AccountSelections,
  BrowserBounds,
  ContentType,
  PublishDraft,
} from "../shared/types";
contextBridge.exposeInMainWorld("multiPublish", {
  getData: () => ipcRenderer.invoke("data:get"),
  getVersion: () => ipcRenderer.invoke("app:version"),
  getInbox: () => ipcRenderer.invoke('inbox:get'),
  syncInbox: (accountId?: string) => ipcRenderer.invoke('inbox:sync',accountId),
  setInboxSettings: (patch: Partial<InboxData['settings']>) => ipcRenderer.invoke('inbox:settings',patch),
  updateInboxEntry: (id: string, patch: {unread?:boolean;replyDraft?:string;resolveUncertain?:boolean}) => ipcRenderer.invoke('inbox:update',id,patch),
  markInboxRead: () => ipcRenderer.invoke('inbox:read-all'),
  openInboxEntry: (id: string) => ipcRenderer.invoke('inbox:open',id),
  openInboxChannel: (accountId: string, kind: InboxKind) => ipcRenderer.invoke('inbox:channel',accountId,kind),
  replyInbox: (id: string, text: string) => ipcRenderer.invoke('inbox:reply',id,text),
  onInboxChanged: (callback: () => void) => { const listener=()=>callback();ipcRenderer.on('inbox:changed',listener);return ()=>ipcRenderer.removeListener('inbox:changed',listener); },
  onInboxShow: (callback: () => void) => { const listener=()=>callback();ipcRenderer.on('inbox:show',listener);return ()=>ipcRenderer.removeListener('inbox:show',listener); },
  getRecovery: () => ipcRenderer.invoke("data:recovery"),
  addAccount: (x: AccountInput) => ipcRenderer.invoke("account:add", x),
  removeAccount: (id: string) => ipcRenderer.invoke("account:remove", id),
  setAccountSelection: (type: ContentType, accountIds: string[]) =>
    ipcRenderer.invoke("account:selection", type, accountIds),
  showBrowser: (id: string, target?: "home" | "publish") =>
    ipcRenderer.invoke("browser:show", id, target),
  hideBrowser: () => ipcRenderer.invoke("browser:hide"),
  closeBrowser: (id: string) => ipcRenderer.invoke("browser:close", id),
  setBrowserBounds: (b: BrowserBounds) =>
    ipcRenderer.invoke("browser:bounds", b),
  browserNavigate: (a: "back" | "forward" | "reload" | "home", id: string) =>
    ipcRenderer.invoke("browser:navigate", a, id),
  pickFiles: (k: "video" | "images" | "cover") =>
    ipcRenderer.invoke("file:pick", k),
  extractCover: (videoPath: string) =>
    ipcRenderer.invoke("video:cover", videoPath).then((result) => {
      if (!result?.ok) throw new Error(result?.error || "封面提取失败");
      return { path: result.path, dataUrl: result.dataUrl };
    }),
  createPublish: (d: Omit<PublishDraft, "id" | "createdAt">) =>
    ipcRenderer.invoke("publish:create", d),
  autoPublish: (draftId: string) => ipcRenderer.invoke("publish:auto", draftId),
  openTask: (id: string) => ipcRenderer.invoke("task:open", id),
  retryTask: (id: string) => ipcRenderer.invoke("task:retry", id),
  completeTask: (id: string) => ipcRenderer.invoke("task:complete", id),
  failTask: (id: string, reason: string) =>
    ipcRenderer.invoke("task:fail", id, reason),
  onDataChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("data:changed", listener);
    return () => ipcRenderer.removeListener("data:changed", listener);
  },
});
