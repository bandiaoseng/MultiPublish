import type {
  AccountInput,
  AppData,
  BrowserBounds,
  ContentType,
  PublishDraft,
} from "../../shared/types";
import type { InboxData, InboxKind, InboxOpenResult, InboxReplyResult } from '../../shared/inbox';
declare global {
  interface Window {
    multiPublish: {
      getData(): Promise<AppData>;
      getVersion(): Promise<string>;
      getInbox(): Promise<InboxData>;
      syncInbox(accountId?: string): Promise<InboxData>;
      setInboxSettings(patch: Partial<InboxData['settings']>): Promise<InboxData>;
      updateInboxEntry(id: string, patch: {unread?:boolean;replyDraft?:string;resolveUncertain?:boolean}): Promise<InboxData>;
      markInboxRead(): Promise<InboxData>;
      openInboxEntry(id: string): Promise<InboxOpenResult>;
      openInboxChannel(accountId: string, kind: InboxKind): Promise<void>;
      replyInbox(id: string, text: string): Promise<InboxReplyResult>;
      onInboxChanged(callback: () => void): () => void;
      onInboxShow(callback: () => void): () => void;
      getRecovery(): Promise<{
        recovered: boolean;
        source: "primary" | "backup" | "temporary" | "empty";
        warning?: string;
      }>;
      addAccount(x: AccountInput): Promise<AppData>;
      removeAccount(id: string): Promise<AppData>;
      setAccountSelection(
        type: ContentType,
        accountIds: string[],
      ): Promise<AppData>;
      showBrowser(id: string, target?: "home" | "publish"): Promise<void>;
      hideBrowser(): Promise<void>;
      closeBrowser(id: string): Promise<void>;
      setBrowserBounds(b: BrowserBounds): Promise<void>;
      browserNavigate(
        a: "back" | "forward" | "reload" | "home",
        id: string,
      ): Promise<void>;
      pickFiles(k: "video" | "images" | "cover"): Promise<string[]>;
      extractCover(
        videoPath: string,
      ): Promise<{ path: string; dataUrl: string } | undefined>;
      createPublish(
        d: Omit<PublishDraft, "id" | "createdAt">,
      ): Promise<AppData>;
      autoPublish(draftId: string): Promise<AppData>;
      openTask(id: string): Promise<AppData>;
      retryTask(id: string): Promise<AppData>;
      completeTask(id: string): Promise<AppData>;
      failTask(id: string, reason: string): Promise<AppData>;
      onDataChanged(callback: () => void): () => void;
    };
  }
}
export {};
