/**
 * 收件箱：只保留最近的若干条消息，避免无人消费时无界增长。
 *
 * 只保存判断所需的最小字段，且按频道白名单过滤——白名单外（含私聊）一律
 * 不入队，避免把无关内容的正文留在进程内存里。
 */

export interface InboxMessage {
  ts: string
  channel: string;
  channelType: string
  user: string
  text: string
  threadTs?: string
}

const DEFAULT_CAPACITY = 200

/** 定长后进先出队列：满时丢弃最旧的一条。 */
export class InboxQueue {
  private readonly capacity: number;
  private messages: InboxMessage[] = [];

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  /** 入队；返回当前队列长度。 */
  push(message: InboxMessage): number {
    this.messages.push(message);
    while (this.messages.length > this.capacity) this.messages.shift();
    return this.messages.length;
  }

  /** 取走符合条件的最多 limit 条（从旧到新）。 */
  take(limit: number, channel?: string): InboxMessage[] {
    const wanted = limit > 0 ? limit : 1;
    const picked: InboxMessage[] = [];
    const rest: InboxMessage[] = [];
    for (const message of this.messages) {
      const matches = channel === undefined || message.channel === channel;
      if (matches && picked.length < wanted) picked.push(message);
      else rest.push(message);
    }
    this.messages = rest;
    return picked;
  }

  /** 当前长度。 */
  get size(): number {
    return this.messages.length;
  }
}
