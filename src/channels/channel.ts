import type { AccessRequest } from '../core/types.js'

export interface NotificationChannel {
  sendApprovalRequest(request: AccessRequest): Promise<string>
  waitForResponse(messageId: string, timeoutMs: number): Promise<'approved' | 'denied' | 'timeout'>
  sendNotification(message: string): Promise<void>
}
