import { LogEvent } from '../types';

class LoggingService {
  log(event: string, data?: Record<string, any>) {
    console.groupCollapsed(`[Analytics] ${event}`);
    console.log(data);
    console.groupEnd();
  }

  async flush() {}
}

export const logger = new LoggingService();
