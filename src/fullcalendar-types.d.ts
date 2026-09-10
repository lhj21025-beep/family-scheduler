import type { EventApi } from '@fullcalendar/core'

declare module '@fullcalendar/core' {
  export interface EventResizeDoneArg {
    event: EventApi
  }
}
