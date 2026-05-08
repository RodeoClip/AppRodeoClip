import { LogEvent } from '../types';
import { supabase } from './supabaseClient';

class LoggingService {
  private queue: LogEvent[] = [];

  log(event: string, data?: Record<string, any>) {
    const logEntry: LogEvent = {
      event,
      timestamp: Date.now(),
      data,
    };
    
    this.queue.push(logEntry);
    
    // Simulate sending to PostHog/Supabase
    console.groupCollapsed(`[Analytics] ${event}`);
    console.log(data);
    console.groupEnd();
  }

  // Simulate flushing logs to backend
  async flush() {
    if (this.queue.length === 0) return;
    const batch = [...this.queue];
    this.queue = [];
    try {
      const payload = batch.map(e => ({ event: e.event, data: e.data || null, ts: new Date(e.timestamp) }));
      await supabase.from('app_logs').insert(payload);
      console.log(`Flushed ${batch.length} logs to Supabase.`);
    } catch (err) {
      console.warn('Failed to flush logs to Supabase, fallback console.', err);
      console.log(`Flushed ${batch.length} logs to server.`);
    }
  }
}

export const logger = new LoggingService();
