export type Platform =
  | "douyin"
  | "kuaishou"
  | "xiaohongshu"
  | "toutiao"
  | "weixin"
  | "bilibili"
  | "qqmedia"
  | "baijiahao";
export type LoginStatus = "checking" | "logged_in" | "logged_out";
export interface Account {
  id: string;
  platform: Platform;
  name: string;
  remark?: string;
  createdAt: string;
  lastOpenedAt?: string;
  loginStatus: LoginStatus;
}
export type ContentType = "video" | "image_text";
export type AccountSelections = Partial<Record<ContentType, string[]>>;
export type DouyinSyncTarget = "toutiao" | "fanqie" | "dongchedi";
export type TaskStatus =
  | "pending"
  | "opening"
  | "uploading"
  | "publishing"
  | "manual_required"
  | "success"
  | "failed";
export interface PublishDraft {
  id: string;
  type: ContentType;
  title: string;
  description: string;
  topics: string[];
  mediaPaths: string[];
  coverPath?: string;
  /** 百家号专用横版副本；其他平台继续使用 coverPath。 */
  baijiahaoCoverPath?: string;
  accountIds: string[];
  /** 抖音/小红书/视频号发布时勾选“声明原创” */
  declareOriginal?: boolean;
  /** 仅在用户主动勾选时设置百家号 AI 声明。 */
  baijiahaoAiGenerated?: boolean;
  /** 抖音发布时同步发送到的平台（需已在抖音绑定对应账号） */
  douyinSyncTargets?: DouyinSyncTarget[];
  createdAt: string;
}
export interface PublishTask {
  id: string;
  draftId: string;
  accountId: string;
  platform: Platform;
  title: string;
  status: TaskStatus;
  message: string;
  createdAt: string;
  updatedAt: string;
}
export interface AppData {
  accounts: Account[];
  drafts: PublishDraft[];
  tasks: PublishTask[];
  accountSelections: AccountSelections;
}
export interface AccountInput {
  platform: Platform;
}
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
