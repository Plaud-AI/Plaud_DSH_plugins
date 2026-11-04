import { SocketModeClient } from '@slack/socket-mode'

/**
 * Socket Mode 连接管理：只负责连接状态与事件转发，业务过滤在上层。
 *
 * 用 SDK 自带的重连（指数退避在库内实现），这里只暴露状态供 slack_status
 * 诊断，避免自己再写一套退避逻辑。
 */

export type SocketState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnecting' | 'disconnected'

/** 一条从 Socket Mode 收到的原始事件。 */
export interface SocketEventPayload {
  /** envelope 的确认函数；不调用的话 Slack 会重投。 */
  ack?: () => Promise<void>
  /** events_api 里的内层事件。 */
  event?: unknown
  body?: unknown
}

/** 连接句柄。 */
export interface SocketHandle {
  state(): SocketState
  attempts(): number
  received(): number
  dispose(): void
}

export interface SocketOptions {
  /** 收到事件时调用（已做 ack）。 */
  onEvent(payload: unknown): void
  /** 诊断日志，绝不包含令牌。 */
  onLog(message: string): void
}

/** 启动 Socket Mode；appToken 必须是 xapp- 前缀。 */
export function startSocketMode(appToken: string, options: SocketOptions): SocketHandle {
  const client = new SocketModeClient({ appToken, autoReconnectEnabled: true })
  let state: SocketState = 'connecting'
  let attempts = 0
  let received = 0
  let disposed = false

  const setState = (next: SocketState): void => {
    state = next
    options.onLog(`Socket Mode 状态：${next}`)
  }

  client.on('connecting', () => {
    attempts += 1
    setState('connecting')
  })
  client.on('connected', () => setState('connected'))
  client.on('authenticated', () => options.onLog('Socket Mode 已认证'))
  client.on('reconnecting', () => {
    attempts += 1
    setState('reconnecting')
  })
  client.on('disconnecting', () => setState('disconnecting'))
  client.on('disconnected', () => setState('disconnected'))
  client.on('error', (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    options.onLog(`Socket Mode 错误：${message}`)
  })

  const handle = (payload: unknown): void => {
    received += 1
    const shaped = payload as SocketEventPayload
    if (typeof shaped.ack === 'function') {
      void shaped.ack().catch(() => {
        options.onLog('Socket Mode ack 失败')
      })
    }
    try {
      options.onEvent(payload)
    } catch (error) {
      options.onLog(`Socket Mode 事件处理失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  client.on('message', handle)
  client.on('app_mention', handle)

  void client.start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    options.onLog(`Socket Mode 启动失败：${message}`)
    setState('disconnected')
  })

  return {
    state: () => state,
    attempts: () => attempts,
    received: () => received,
    dispose: () => {
      if (disposed) return
      disposed = true
      void client.disconnect().catch(() => {
        options.onLog('Socket Mode 断开时出错')
      })
    },
  }
}
