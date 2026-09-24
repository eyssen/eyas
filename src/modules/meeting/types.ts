// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface Transcript {
  segments: Array<{
    speaker: string
    text: string
    startTime: number
    endTime: number
  }>
  language: string
}

export interface MeetingSummary {
  memo: string
  keyPoints: string[]
  decisions: string[]
}

export interface ActionItem {
  description: string
  assignee?: string
  deadline?: Date
  priority?: 'high' | 'medium' | 'low'
}

export interface MeetingProvider {
  id: string
  connect(): Promise<void>
  getTranscript(meetingId: string): Promise<Transcript>
  getSummary(meetingId: string): Promise<MeetingSummary>
  getActionItems(meetingId: string): Promise<ActionItem[]>
}

export interface MeetingListItem {
  id: string
  title: string
  date: string
  duration: number
  participants: string[]
}
