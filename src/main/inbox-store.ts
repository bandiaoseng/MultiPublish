import { app } from 'electron';
import { PersistentJsonStore } from './persistent-store';
import { newInbox, parseInbox } from './inbox-core';
import type { InboxData } from '../shared/inbox';

export class InboxStore extends PersistentJsonStore<InboxData> {
  constructor() { super({ directory: app.getPath('userData'), fileName: 'multipublish-inbox.json', empty: newInbox(), parse: parseInbox }); }
}
