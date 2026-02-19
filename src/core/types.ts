export interface AccessRequest {
  uuid: string
  requester: string
  justification: string
  durationMs: number
  secretName: string
}
